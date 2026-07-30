<?php

namespace App\Console\Commands;

use App\Enums\EntryStatus;
use App\Enums\EntryType;
use App\Enums\Locale;
use App\Models\Entry;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * Create the creatures that live only in the OpenTibia server (canary) and have
 * no TibiaWiki page — straight from the monster lua, no wiki round-trip. The lua
 * already carries everything that matters: hitpoints, experience, speed, blood,
 * bestiary class and the boss flag. So the entry is real the moment it lands;
 * {@see EtlMonsterCombat} then layers on the full combat profile (elements,
 * mitigation, burst) and {@see ImportSpawns} the map positions — both match the
 * new entries by name, so no extra wiring is needed.
 *
 * The one thing a lua can't give is a sprite (it only names a `lookType` outfit
 * id) or lore text, so new entries start image-less; tibia:mirror-images or the
 * TibiaData creature sync can backfill a picture later where one exists.
 *
 * Usage:
 *   php artisan tibia:import-ot-creatures --dry                 # preview
 *   php artisan tibia:import-ot-creatures --path=/var/tmp/ot-data/data-otservbr-global/monster
 *   php artisan tibia:import-ot-creatures --only="old wolf,old bear"
 */
class ImportOtCreatures extends Command
{
    protected $signature = 'tibia:import-ot-creatures
        {--path= : Monster lua root (defaults to <repo>/ot/data-otservbr-global/monster)}
        {--only= : Comma-separated monster names to limit to}
        {--dry : List what would be created without writing}';

    protected $description = 'Create OT-only creatures (no wiki page) straight from the monster luas';

    public function handle(): int
    {
        $root = (string) ($this->option('path') ?: base_path('../ot/data-otservbr-global/monster'));
        if (! is_dir($root)) {
            $this->error("Monster lua root not found: {$root}");

            return self::FAILURE;
        }

        // Everything we already document, indexed by lowercased name and by slug,
        // so we only ever create the genuinely missing ones (idempotent re-runs).
        $haveNames = Entry::where('type', 'creature')->with('translations')->get()
            ->flatMap(fn (Entry $e) => $e->translations->pluck('name'))
            ->filter()->map(fn ($n) => mb_strtolower((string) $n))->flip()->all();
        $haveSlugs = Entry::where('type', 'creature')->pluck('slug')->flip()->all();

        $only = array_filter(array_map('trim', explode(',', mb_strtolower((string) $this->option('only')))));
        $dry = (bool) $this->option('dry');

        $created = $skipped = $unnamed = 0;
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS)) as $file) {
            if ($file->getExtension() !== 'lua') {
                continue;
            }
            $src = (string) file_get_contents($file->getPathname());
            if (! preg_match('/Game\.createMonsterType\(\s*["\']([^"\']+)["\']\s*\)/', $src, $m)) {
                continue;
            }
            $name = trim($m[1]);
            if ($name === '') {
                $unnamed++;

                continue;
            }
            $lower = mb_strtolower($name);
            if ($only && ! in_array($lower, $only, true)) {
                continue;
            }
            if (isset($haveNames[$lower])) {
                $skipped++;

                continue;
            }
            // Skip the OT's internal props: summons/familiars, invulnerable puzzle
            // spawns, and numbered script variants (Zamulosh2). --only overrides
            // the filter so a deliberately-named creature can still get through.
            if (! $only && $this->isJunk($name, $file->getPathname())) {
                $skipped++;

                continue;
            }
            $slug = Str::slug($name);
            if ($slug === '' || isset($haveSlugs[$slug]) || Entry::where('slug', $slug)->exists()) {
                $skipped++;

                continue;
            }

            $rel = str_replace('\\', '/', $file->getPathname());
            $boss = str_contains($rel, '/bosses/') || (bool) preg_match('/monster\.bosstiary/i', $src);
            $meta = $this->stats($src, $boss);

            if ($dry) {
                $this->line(sprintf('  + %-30s hp=%d exp=%d%s', $name, $meta['hitpoints'] ?? 0, $meta['experience'] ?? 0, $boss ? '  [boss]' : ''));
                $created++;

                continue;
            }

            $entry = Entry::create([
                'slug' => $slug,
                'type' => EntryType::Creature->value,
                'status' => EntryStatus::Published->value,
                'primary_image' => null,
                'meta' => $meta,
            ]);
            // English name only; the Spanish view falls back to it until someone
            // translates, exactly like the TibiaData sync leaves it.
            $entry->translations()->create(['locale' => Locale::English->value, 'name' => $name]);

            $haveNames[$lower] = true;
            $haveSlugs[$slug] = true;
            $created++;
            $this->line('  + '.$name.($boss ? '  [boss]' : ''));
        }

        $this->info("Done. Created {$created}, skipped {$skipped} (already present), {$unnamed} unnamed.");
        if ($created > 0 && ! $dry) {
            $this->line('<fg=gray>Next: tibia:etl-monster-combat (combat) + tibia:import-spawns (positions) — both match by name.</>');
        }

        return self::SUCCESS;
    }

    /**
     * Is this OT monster an internal prop rather than a real creature? Summons,
     * class familiars, invulnerable puzzle spawns ("… Invu", "(imune)"), quest
     * props and numbered script variants ("Zamulosh2") all leak into the lua set
     * but have no business as published bestiary entries.
     */
    private function isJunk(string $name, string $path): bool
    {
        if (str_contains(str_replace('\\', '/', mb_strtolower($path)), '/summons/')) {
            return true;
        }

        return (bool) preg_match('/\b(summon|familiar|invu|imune|immune|prism)\b|\(imune\)|\d$/i', $name);
    }

    /**
     * Core display stats from the monster lua. The full combat profile is layered
     * on later by tibia:etl-monster-combat, so keep this to the headline numbers.
     *
     * @return array<string, mixed>
     */
    private function stats(string $src, bool $boss): array
    {
        $int = function (string $prop) use ($src): ?int {
            return preg_match('/monster\.'.$prop.'\s*=\s*(\d+)/', $src, $mm) ? (int) $mm[1] : null;
        };

        return array_filter([
            'hitpoints' => $int('health') ?? $int('maxHealth'),
            'experience' => $int('experience'),
            'speed' => $int('speed'),
            // defenses = { defense = X, armor = Y }
            'armor' => preg_match('/\barmor\s*=\s*(\d+)/', $src, $a) ? (int) $a[1] : null,
            // Bestiary class ("Demon", "Undead"…) is the display classification;
            // monster.race is the blood/corpse type, not a class.
            'classification' => preg_match('/["\']?[Cc]lass["\']?\s*=\s*["\']([^"\']+)["\']/', $src, $c) ? $c[1] : null,
            // BossRule keys on meta.rank = 'Boss'.
            'rank' => $boss ? 'Boss' : null,
            'source' => 'ot',
        ], fn ($v) => $v !== null && $v !== '');
    }
}
