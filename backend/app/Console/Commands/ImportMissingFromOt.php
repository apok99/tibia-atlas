<?php

namespace App\Console\Commands;

use App\Enums\EntryStatus;
use App\Enums\EntryType;
use App\Models\Entry;
use App\Services\Import\ItemImporter;
use App\Services\Import\TibiaWikiImporter;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * Completeness pass driven by the OT server data (the `ot/` clone): every item
 * in `data/items/items.xml` and every monster/boss lua is checked against our
 * entries, and the missing ones are imported through the existing TibiaWiki
 * importers (strict mode, so OT-internal junk — walls, corpses, arena copies —
 * is skipped when the wiki has no matching infobox page).
 *
 *   php artisan tibia:import-missing-from-ot --dry              # report only
 *   php artisan tibia:import-missing-from-ot --type=items
 *   php artisan tibia:import-missing-from-ot --type=creatures --publish
 *
 * Idempotent: already-present entries never re-import, so it can be re-run
 * after every OT data update. Bosses (luas with a `monster.bosstiary` block or
 * living under `monster/bosses/`) get `meta.rank = Boss` when the wiki infobox
 * didn't already set it. `--publish` publishes newly created creature drafts so
 * they show up in the bestiary immediately (items are catalogue-visible as
 * drafts already).
 */
class ImportMissingFromOt extends Command
{
    protected $signature = 'tibia:import-missing-from-ot
        {--ot= : OT clone root (defaults to <repo>/ot)}
        {--type=all : What to sync: items|creatures|all}
        {--limit=0 : Max NEW imports per kind this run (0 = all)}
        {--sleep=300 : Delay between wiki imports in milliseconds}
        {--publish : Publish newly imported creature drafts}
        {--dry : Diff and report, import nothing}';

    protected $description = 'Import items/creatures/bosses present in the OT server data but missing from the DB';

    /** Monster dirs that are not real huntable creatures. */
    private const SKIP_DIRS = ['familiars', 'trainers', 'traps'];

    /** Small words kept lowercase when title-casing an OT name for the wiki. */
    private const SMALL_WORDS = ['of', 'the', 'a', 'an', 'and', 'or', 'in', 'on', 'to', 'with', 'von', 'der'];

    public function handle(ItemImporter $items, TibiaWikiImporter $wiki): int
    {
        $ot = rtrim((string) ($this->option('ot') ?: base_path('../ot')), '/\\');
        $type = (string) $this->option('type');

        if (! is_dir($ot)) {
            $this->error("OT root not found: {$ot}");

            return self::FAILURE;
        }

        $ok = true;
        if (in_array($type, ['all', 'items'], true)) {
            $ok = $this->syncItems($items, $ot) && $ok;
        }
        if (in_array($type, ['all', 'creatures'], true)) {
            $ok = $this->syncCreatures($wiki, $ot) && $ok;
        }

        return $ok ? self::SUCCESS : self::FAILURE;
    }

    // ------------------------------------------------------------- items ---

    private function syncItems(ItemImporter $importer, string $ot): bool
    {
        $xmlPath = $ot.'/data/items/items.xml';
        if (! is_file($xmlPath)) {
            $this->error("items.xml not found: {$xmlPath}");

            return false;
        }

        $candidates = $this->otItemNames($xmlPath);
        $this->info(count($candidates).' pickupable item names in items.xml.');

        // Existing item entries by lowercased EN name and by slug (both slug
        // variants the importer can produce).
        $slugs = Entry::ofType('item')->pluck('slug')->flip()->all();
        $names = Entry::ofType('item')
            ->join('entry_translations as t', fn ($j) => $j->on('t.entry_id', 'entries.id')->where('t.locale', 'en'))
            ->pluck('t.name')
            ->map(fn ($n) => mb_strtolower($n))
            ->flip()
            ->all();

        $missing = [];
        foreach ($candidates as $name) {
            $slug = Str::slug($name);
            if (isset($names[$name]) || isset($slugs[$slug]) || isset($slugs[$slug.'-item'])) {
                continue;
            }
            $missing[] = $name;
        }

        $this->info(count($missing).' OT items not in the DB.');
        if ($this->option('dry')) {
            foreach (array_slice($missing, 0, 40) as $n) {
                $this->line("  - {$n}");
            }
            if (count($missing) > 40) {
                $this->line('  … and '.(count($missing) - 40).' more');
            }

            return true;
        }

        $limit = (int) $this->option('limit');
        $imported = $skipped = $failed = 0;
        foreach ($missing as $i => $name) {
            if ($limit > 0 && $imported >= $limit) {
                break;
            }
            $run = $importer->import($this->wikiTitle($name), strict: true);
            match ($run->status) {
                'success' => $imported++,
                'skipped' => $skipped++,
                default => $failed++,
            };
            if ($run->status === 'success') {
                $this->line("  + {$name}");
            }
            $this->throttle();
            if (($i + 1) % 100 === 0) {
                $this->info('  … '.($i + 1).'/'.count($missing)." checked ({$imported} imported)");
            }
        }

        $this->info("Items done: imported {$imported}, no-wiki-page {$skipped}, failed {$failed}.");

        return true;
    }

    /**
     * Distinct pickupable item names from items.xml. "Has a weight attribute"
     * is the pickupable gate — walls, fields and decorations carry none.
     *
     * @return list<string>
     */
    private function otItemNames(string $xmlPath): array
    {
        $names = [];
        $reader = new \XMLReader;
        $reader->open($xmlPath);
        $current = null;
        while ($reader->read()) {
            if ($reader->nodeType === \XMLReader::ELEMENT && $reader->name === 'item') {
                $name = trim((string) $reader->getAttribute('name'));
                $current = mb_strlen($name) >= 3 ? mb_strtolower($name) : null;
                if ($current !== null && $reader->isEmptyElement) {
                    $current = null; // no attributes → no weight → not pickupable
                }
            } elseif ($current !== null && $reader->nodeType === \XMLReader::ELEMENT && $reader->name === 'attribute') {
                if (strcasecmp((string) $reader->getAttribute('key'), 'weight') === 0) {
                    $names[$current] = true;
                    $current = null;
                }
            } elseif ($reader->nodeType === \XMLReader::END_ELEMENT && $reader->name === 'item') {
                $current = null;
            }
        }
        $reader->close();

        return array_keys($names);
    }

    // --------------------------------------------------------- creatures ---

    private function syncCreatures(TibiaWikiImporter $wiki, string $ot): bool
    {
        $root = $ot.'/data-otservbr-global/monster';
        if (! is_dir($root)) {
            $this->error("Monster lua root not found: {$root}");

            return false;
        }

        // name (lowercased) → is boss
        $monsters = [];
        $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS));
        foreach ($it as $file) {
            if ($file->getExtension() !== 'lua') {
                continue;
            }
            $rel = str_replace('\\', '/', substr((string) $file, strlen($root)));
            if (preg_match('#/(?:'.implode('|', self::SKIP_DIRS).')/#', $rel)) {
                continue;
            }
            $src = (string) file_get_contents((string) $file);
            if (! preg_match('/Game\.createMonsterType\(\s*["\']([^"\']+)["\']\s*\)/', $src, $m)) {
                continue;
            }
            $name = trim($m[1]);
            if (mb_strlen($name) < 3) {
                continue;
            }
            $boss = str_contains($rel, '/bosses/') || str_contains($src, 'monster.bosstiary');
            $key = mb_strtolower($name);
            $monsters[$key] = ($monsters[$key] ?? false) || $boss;
        }
        $this->info(count($monsters).' distinct monsters in the OT luas.');

        // Existing creatures by lowercased EN name (same matching as the
        // monster-combat ETL) and by slug.
        $slugs = Entry::where('type', 'creature')->pluck('slug')->flip()->all();
        $names = Entry::where('type', 'creature')
            ->join('entry_translations as t', fn ($j) => $j->on('t.entry_id', 'entries.id')->where('t.locale', 'en'))
            ->pluck('t.name')
            ->map(fn ($n) => mb_strtolower($n))
            ->flip()
            ->all();

        $missing = [];
        foreach ($monsters as $name => $boss) {
            if (isset($names[$name]) || isset($slugs[Str::slug($name)])) {
                continue;
            }
            $missing[$name] = $boss;
        }

        $bossCount = count(array_filter($missing));
        $this->info(count($missing).' OT monsters not in the DB ('.$bossCount.' bosses).');
        if ($this->option('dry')) {
            foreach (array_slice(array_keys($missing), 0, 60) as $n) {
                $this->line('  - '.$n.($missing[$n] ? '  [boss]' : ''));
            }
            if (count($missing) > 60) {
                $this->line('  … and '.(count($missing) - 60).' more');
            }

            return true;
        }

        $limit = (int) $this->option('limit');
        $imported = $skipped = $failed = 0;
        $i = 0;
        foreach ($missing as $name => $boss) {
            if ($limit > 0 && $imported >= $limit) {
                break;
            }
            $run = $wiki->import($this->wikiTitle($name), EntryType::Creature, strict: true);

            // Wrong case / plural / disambiguation: resolve via wiki search once.
            if ($run->status !== 'success') {
                $resolved = $wiki->resolveTitle($name);
                if ($resolved !== null && mb_strtolower($resolved) !== mb_strtolower($this->wikiTitle($name))) {
                    // Only accept a search hit that IS this monster, not a lookalike.
                    if ($this->sameCreature($name, $resolved)) {
                        $run = $wiki->import($resolved, EntryType::Creature, strict: true);
                    }
                }
            }

            match ($run->status) {
                'success' => $imported++,
                'skipped' => $skipped++,
                default => $failed++,
            };

            if ($run->status === 'success' && $run->entry_id) {
                $this->finishCreature((int) $run->entry_id, $boss);
                $this->line('  + '.$name.($boss ? '  [boss]' : ''));
            }

            $this->throttle();
            if (++$i % 100 === 0) {
                $this->info("  … {$i}/".count($missing)." checked ({$imported} imported)");
            }
        }

        $this->info("Creatures done: imported {$imported}, no-wiki-page {$skipped}, failed {$failed}.");

        return true;
    }

    /**
     * A resolved search hit counts as the same creature only when the OT name
     * matches the hit ignoring case, punctuation and a "(Creature)"-style
     * disambiguation suffix — never a fuzzy "close enough" hit.
     */
    private function sameCreature(string $otName, string $wikiTitle): bool
    {
        $norm = fn (string $s) => mb_strtolower(preg_replace('/[^a-z0-9]/i', '', preg_replace('/\s*\([^)]*\)/', '', $s) ?? $s) ?? '');

        return $norm($otName) === $norm($wikiTitle);
    }

    /** Post-import touches: boss rank from the OT data, optional publish. */
    private function finishCreature(int $entryId, bool $boss): void
    {
        $entry = Entry::find($entryId);
        if (! $entry) {
            return;
        }

        $meta = $entry->meta ?? [];
        if ($boss && empty($meta['rank'])) {
            $meta['rank'] = 'Boss';
            $entry->meta = $meta;
        }
        if ($this->option('publish') && $entry->status !== EntryStatus::Published) {
            $entry->status = EntryStatus::Published;
        }
        if ($entry->isDirty()) {
            $entry->save();
        }
    }

    // ------------------------------------------------------------ shared ---

    /** "boots of haste" → "Boots of Haste" (TibiaWiki title convention). */
    private function wikiTitle(string $name): string
    {
        $words = explode(' ', $name);
        foreach ($words as $i => $w) {
            $words[$i] = ($i > 0 && in_array($w, self::SMALL_WORDS, true))
                ? $w
                : Str::ucfirst($w);
        }

        return implode(' ', $words);
    }

    private function throttle(): void
    {
        $ms = (int) $this->option('sleep');
        if ($ms > 0) {
            usleep($ms * 1000);
        }
    }
}
