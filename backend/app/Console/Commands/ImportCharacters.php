<?php

namespace App\Console\Commands;

use App\Enums\EntryStatus;
use App\Enums\EntryType;
use App\Enums\Locale;
use App\Enums\SourceType;
use App\Models\Entry;
use App\Services\EntryService;
use App\Services\Import\BookTranslator;
use App\Services\Import\StubFiller;
use App\Services\Import\TibiaWikiImporter;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Fills the "Characters" tab from TibiaWiki's curated lore people: the pantheon
 * (Category:Gods) and the notable named figures of Tibian history
 * (Category:Characters). Each page's LEAD PROSE is pulled via StubFiller (clean
 * wikitext, never the infobox dump), published as a bilingual character entry,
 * and machine-translated to Spanish in the same pass.
 *
 * Idempotent and resumable: a character that already has EN + ES lore AND was
 * imported from the wiki is skipped unless --refresh is given. Existing
 * hand-authored entries (Banor, Daraman, …) get their overview/canon enriched
 * with the fuller wiki lore while their interpretations/relations are kept.
 *
 *   php artisan tibia:import-characters
 *   php artisan tibia:import-characters --limit=20 --draft
 *   php artisan tibia:import-characters --refresh --names="Banor" --names="Goshnar"
 */
class ImportCharacters extends Command
{
    private const API = 'https://tibia.fandom.com/api.php';

    private const UA = 'TibiaAtlas/1.0 (lore research project; contact: contact@tibiaatlas.test)';

    /** List pages / non-individual entries in the categories that we don't want as characters. */
    private const SKIP = ['Tibian Gods'];

    protected $signature = 'tibia:import-characters
        {--limit=0 : Max characters to process (0 = all)}
        {--sleep=300 : Delay between characters in milliseconds}
        {--draft : Import as drafts instead of publishing}
        {--no-translate : Skip the Spanish machine-translation step}
        {--refresh : Re-import even characters that are already fully done}
        {--names=* : Explicit TibiaWiki titles to import instead of the categories}';

    protected $description = 'Fill the Characters tab from TibiaWiki (gods + notable figures)';

    public function handle(
        TibiaWikiImporter $importer,
        StubFiller $filler,
        BookTranslator $translator,
        EntryService $entries,
    ): int {
        $userId = null;

        // 1) Resolve the working title list (gods are flagged as deities).
        $deities = [];
        $names = (array) $this->option('names');
        if ($names) {
            $titles = array_values(array_unique(array_map('trim', $names)));
        } else {
            $gods = $importer->listCategory('Gods', 200);
            $chars = $importer->listCategory('Characters', 200);
            $deities = array_fill_keys($gods, true);
            $titles = array_values(array_unique(array_merge($gods, $chars)));
        }

        $titles = array_values(array_filter($titles, fn ($t) => ! in_array($t, self::SKIP, true)));
        $limit = (int) $this->option('limit');
        if ($limit > 0) {
            $titles = array_slice($titles, 0, $limit);
        }

        $publish = ! $this->option('draft');
        $translate = ! $this->option('no-translate');
        $refresh = (bool) $this->option('refresh');
        $sleepMs = (int) $this->option('sleep');

        // 2) Batch-fetch a portrait image for every title up front (cheap: 50/req).
        $images = $this->fetchImages($titles);

        $this->info(count($titles).' character pages to process'.($publish ? ' (publishing)' : ' (drafts)').'…');
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

                $content = $filler->fetchContent($title);
                if ($content === null || max(Str::length($content['overview'] ?? ''), Str::length($content['canon'] ?? '')) < 80) {
                    $nocontent++;
                    $bar->advance();
                    if ($sleepMs > 0) {
                        usleep($sleepMs * 1000);
                    }

                    continue;
                }

                $overviewEn = Str::limit($content['overview'], 600, '…');
                $canonEn = $content['canon'] ?: $content['overview'];

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

                $meta = array_merge($existing->meta ?? [], [
                    'imported_from' => 'tibiawiki',
                    'character_kind' => isset($deities[$title]) ? 'deity' : 'character',
                ]);

                $payload = [
                    'slug' => $slug,
                    'type' => EntryType::Character->value,
                    'status' => $publish ? EntryStatus::Published->value : EntryStatus::Draft->value,
                    'primary_image' => $images[$title] ?? $existing?->primary_image,
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
                    $entries->create($payload, $userId);
                    $created++;
                }
            } catch (\Throwable $e) {
                $failed++;
                $this->newLine();
                $this->warn("  {$title}: ".$e->getMessage());
            }

            $bar->advance();
            if ($sleepMs > 0) {
                usleep($sleepMs * 1000);
            }
        }

        $bar->finish();
        $this->newLine(2);
        $this->info("Done. Created {$created}, updated {$updated}, skipped {$skipped}, no-content {$nocontent}, failed {$failed}.");

        return self::SUCCESS;
    }

    /** Strip the disambiguating " (Character)" suffix TibiaWiki adds to some names. */
    private function cleanName(string $title): string
    {
        return trim(preg_replace('/\s*\(Character\)\s*$/i', '', $title) ?? $title);
    }

    /**
     * Pick a slug for the display name. If a non-character entry already owns the
     * base slug (e.g. the city "Thais" vs the character "Thais"), suffix it.
     *
     * @return array{0: string, 1: ?Entry}
     */
    private function resolveSlug(string $display): array
    {
        $base = Str::slug($display) ?: 'character';
        $existing = Entry::with('translations')->where('slug', $base)->first();

        if ($existing && $existing->type !== EntryType::Character) {
            $slug = $base.'-character';
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
            return $this->fixThaian($translator->translate($text));
        } catch (\Throwable $e) {
            return null; // leave ES empty; tibia:translate-entries can backfill later
        }
    }

    /**
     * The free gtx translator mis-renders "Thaian"/"Thais" (of the city Thais)
     * as "tailandés / Tailandia" (Thai / Thailand). Normalise it to "de Thais".
     */
    private function fixThaian(string $t): string
    {
        $t = preg_replace('/\bTailandia\b/u', 'Thais', $t) ?? $t;
        $t = preg_replace('/\btailandes(?:es|as|a)\b/iu', 'de Thais', $t) ?? $t;
        $t = preg_replace('/\btailandés\b/iu', 'de Thais', $t) ?? $t;

        return preg_replace('/\bde\s+de\s+Thais\b/iu', 'de Thais', $t) ?? $t;
    }

    /**
     * Batch-fetch a portrait image (artwork preferred, sprite gif otherwise) for
     * each title using the pageimages API, 50 titles per request.
     *
     * @param  list<string>  $titles
     * @return array<string, string> title => image URL
     */
    private function fetchImages(array $titles): array
    {
        $out = [];
        foreach (array_chunk($titles, 50) as $chunk) {
            try {
                $json = Http::acceptJson()
                    ->withHeaders(['User-Agent' => self::UA])
                    ->timeout(20)
                    ->retry(2, 400, throw: false)
                    ->get(self::API, [
                        'action' => 'query',
                        'format' => 'json',
                        'prop' => 'pageimages',
                        'piprop' => 'original|thumbnail',
                        'pithumbsize' => 300,
                        'redirects' => 1,
                        'titles' => implode('|', $chunk),
                    ])->json();

                // Map any redirect-normalised titles back to the ones we asked for.
                $alias = [];
                foreach ((array) data_get($json, 'query.normalized', []) as $n) {
                    $alias[$n['to'] ?? ''] = $n['from'] ?? '';
                }
                foreach ((array) data_get($json, 'query.redirects', []) as $r) {
                    $alias[$r['to'] ?? ''] = $r['from'] ?? '';
                }

                foreach ((array) data_get($json, 'query.pages', []) as $page) {
                    $url = $page['original']['source'] ?? $page['thumbnail']['source'] ?? null;
                    if (! $url) {
                        continue;
                    }
                    $title = $page['title'] ?? '';
                    $asked = $alias[$title] ?? $title;
                    $out[$asked] = $url;
                }
            } catch (\Throwable $e) {
                // image is optional — skip this chunk on failure
            }
        }

        return $out;
    }
}
