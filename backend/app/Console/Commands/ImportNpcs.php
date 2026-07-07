<?php

namespace App\Console\Commands;

use App\Enums\EntryStatus;
use App\Enums\EntryType;
use App\Enums\Locale;
use App\Enums\SourceType;
use App\Models\Entry;
use App\Services\EntryService;
use App\Services\Import\BookTranslator;
use App\Services\Import\TibiaWikiImporter;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * Fills the NPC tab from TibiaWiki. NPCs use {{Infobox NPC}} (a template the
 * creature scraper ignores), which is why they were entirely absent — e.g. the
 * mysterious "Basilisk" NPC of the Kazordoon mines. Each page's infobox lore
 * (`notes` + `history`, plus job/location/city/race facts) is imported as a
 * bilingual NPC entry and machine-translated to Spanish in the same pass.
 *
 * Idempotent and resumable: an NPC that already has EN + ES lore AND was
 * imported from the wiki is skipped unless --refresh is given.
 *
 *   php artisan tibia:import-npcs --limit=20 --draft
 *   php artisan tibia:import-npcs                 (all, published)
 *   php artisan tibia:import-npcs --names="Basilisk"
 */
class ImportNpcs extends Command
{
    protected $signature = 'tibia:import-npcs
        {--limit=0 : Max NPCs to process (0 = all)}
        {--sleep=250 : Delay between NPCs in milliseconds}
        {--draft : Import as drafts instead of publishing}
        {--no-translate : Skip the Spanish machine-translation step}
        {--refresh : Re-import even NPCs that are already fully done}
        {--names=* : Explicit TibiaWiki titles to import instead of enumerating}';

    protected $description = 'Fill the NPC tab from TibiaWiki ({{Infobox NPC}} pages)';

    public function handle(TibiaWikiImporter $importer, BookTranslator $translator, EntryService $entries): int
    {
        $names = (array) $this->option('names');
        if ($names) {
            $titles = array_values(array_unique(array_map('trim', $names)));
        } else {
            $titles = $importer->listByTemplate('Infobox NPC', 5000);
        }

        $limit = (int) $this->option('limit');
        if ($limit > 0) {
            $titles = array_slice($titles, 0, $limit);
        }

        $publish = ! $this->option('draft');
        $translate = ! $this->option('no-translate');
        $refresh = (bool) $this->option('refresh');
        $sleepMs = (int) $this->option('sleep');

        $this->info(count($titles).' NPC pages to process'.($publish ? ' (publishing)' : ' (drafts)').'…');
        $bar = $this->output->createProgressBar(count($titles));
        $bar->start();

        $created = $updated = $skipped = $nocontent = $failed = 0;

        foreach ($titles as $title) {
            try {
                $display = $this->cleanName($title);
                [$slug, $existing] = $this->resolveSlug($display);

                // Resume: skip finished imports unless --refresh.
                if (! $refresh && $existing && ($existing->meta['imported_from'] ?? null) === 'tibiawiki') {
                    $en = $existing->translation('en');
                    $es = $existing->translations->firstWhere('locale', 'es');
                    if ($en?->canon && (! $translate || $es?->canon)) {
                        $skipped++;
                        $bar->advance();

                        continue;
                    }
                }

                $data = $importer->fetchNpcData($title);
                if ($data['params'] === []) {
                    $nocontent++;
                    $bar->advance();
                    $this->nap($sleepMs);

                    continue;
                }

                $overviewEn = $data['overview'];
                $canonEn = $data['canon'] ?: $data['overview'];
                if (max(Str::length($overviewEn ?? ''), Str::length($canonEn ?? '')) < 20) {
                    $nocontent++;
                    $bar->advance();
                    $this->nap($sleepMs);

                    continue;
                }
                $overviewEn = $overviewEn ? Str::limit($overviewEn, 600, '…') : $canonEn;

                $translations = [[
                    'locale' => Locale::English->value,
                    'name' => $display,
                    'overview' => $overviewEn,
                    'canon' => $canonEn,
                ]];

                if ($translate) {
                    $esName = $existing?->translations->firstWhere('locale', 'es')?->name ?? $display;
                    $translations[] = [
                        'locale' => Locale::Spanish->value,
                        'name' => $esName,
                        'overview' => $this->tryTranslate($translator, $overviewEn),
                        'canon' => $this->tryTranslate($translator, $canonEn),
                    ];
                }

                $meta = array_merge($existing->meta ?? [], $data['meta'], [
                    'imported_from' => 'tibiawiki',
                ]);

                $payload = [
                    'slug' => $slug,
                    'type' => EntryType::Npc->value,
                    'status' => $publish ? EntryStatus::Published->value : EntryStatus::Draft->value,
                    'primary_image' => $this->sprite($display, $existing?->primary_image),
                    'meta' => $meta,
                    'translations' => $translations,
                    'sources' => [[
                        'type' => SourceType::TibiaWiki->value,
                        'title' => 'TibiaWiki: '.$title,
                        'url' => 'https://tibia.fandom.com/wiki/'.rawurlencode(str_replace(' ', '_', $title)),
                    ]],
                ];

                if ($existing) {
                    $entries->update($existing, $payload);
                    $updated++;
                } else {
                    $entries->create($payload, null);
                    $created++;
                }
            } catch (\Throwable $e) {
                $failed++;
                $this->newLine();
                $this->warn("  {$title}: ".$e->getMessage());
            }

            $bar->advance();
            $this->nap($sleepMs);
        }

        $bar->finish();
        $this->newLine(2);
        $this->info("Done. Created {$created}, updated {$updated}, skipped {$skipped}, no-content {$nocontent}, failed {$failed}.");

        return self::SUCCESS;
    }

    private function nap(int $ms): void
    {
        if ($ms > 0) {
            usleep($ms * 1000);
        }
    }

    /** Strip the disambiguating " (NPC)" / " (Character)" suffix. */
    private function cleanName(string $title): string
    {
        return trim(preg_replace('/\s*\((NPC|Character)\)\s*$/i', '', $title) ?? $title);
    }

    /** The in-game sprite (File:<Name>.gif). */
    private function sprite(string $display, ?string $existing): ?string
    {
        $name = preg_replace('/\s*\([^)]*\)\s*$/', '', $display) ?: $display;

        return 'https://tibia.fandom.com/wiki/Special:FilePath/'.rawurlencode($name).'.gif';
    }

    /**
     * Pick a slug for the display name. If a non-NPC entry already owns the base
     * slug (e.g. the creature "Basilisk" vs the NPC "Basilisk"), suffix it.
     *
     * @return array{0: string, 1: ?Entry}
     */
    private function resolveSlug(string $display): array
    {
        $base = Str::slug($display) ?: 'npc';
        $existing = Entry::with('translations')->where('slug', $base)->first();

        if ($existing && $existing->type !== EntryType::Npc) {
            $slug = $base.'-npc';
            $existing = Entry::with('translations')->where('slug', $slug)->first();

            return [$slug, $existing];
        }

        return [$base, $existing];
    }

    private function tryTranslate(BookTranslator $translator, ?string $text): ?string
    {
        if (! $text) {
            return null;
        }
        try {
            return $translator->translate($text);
        } catch (\Throwable $e) {
            return null; // leave ES empty; tibia:translate-entries can backfill later
        }
    }
}
