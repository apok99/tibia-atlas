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
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Fills the "Cities" tab from TibiaWiki's canonical town list. The set of towns
 * is read from the wiki "Cities" article (its == [[Town]] == headings — the
 * authoritative list of hometowns); each town page's full LEAD LORE is pulled
 * via StubFiller::fetchCityLore (clean intro prose + history, never the gameplay
 * sections), published as a bilingual city entry, and machine-translated to
 * Spanish in the same pass. Ruler / nearby places / organisations land in meta.
 *
 * Idempotent and resumable: a city that already has EN + ES lore AND was
 * imported from the wiki is skipped unless --refresh is given. The existing
 * hand-authored Thais entry gets its overview/canon enriched with the fuller
 * wiki lore while its relations/interpretations are kept.
 *
 *   php artisan tibia:import-cities
 *   php artisan tibia:import-cities --limit=5 --draft
 *   php artisan tibia:import-cities --refresh --names="Thais" --names="Carlin"
 */
class ImportCities extends Command
{
    private const API = 'https://tibia.fandom.com/api.php';

    private const UA = 'TibiaAtlas/1.0 (lore research project; contact: contact@tibiaatlas.test)';

    /** Fallback list if the wiki "Cities" article can't be parsed. */
    private const FALLBACK = [
        'Dawnport', 'Rookgaard', "Ab'Dendriel", 'Carlin', 'Kazordoon', 'Thais',
        'Venore', 'Ankrahmun', 'Darashia', 'Edron', 'Farmine', 'Gray Beach',
        'Issavi', 'Liberty Bay', 'Port Hope', 'Rathleton', 'Roshamuul',
        'Svargrond', 'Yalahar',
    ];

    protected $signature = 'tibia:import-cities
        {--limit=0 : Max cities to process (0 = all)}
        {--sleep=300 : Delay between cities in milliseconds}
        {--draft : Import as drafts instead of publishing}
        {--no-translate : Skip the Spanish machine-translation step}
        {--refresh : Re-import even cities that are already fully done}
        {--names=* : Explicit TibiaWiki titles to import instead of the wiki list}';

    protected $description = 'Fill the Cities tab from TibiaWiki (all canonical towns + their lore)';

    public function handle(
        StubFiller $filler,
        BookTranslator $translator,
        EntryService $entries,
    ): int {
        $userId = null;

        $names = (array) $this->option('names');
        $titles = $names
            ? array_values(array_unique(array_map('trim', $names)))
            : $this->resolveTownList();

        $limit = (int) $this->option('limit');
        if ($limit > 0) {
            $titles = array_slice($titles, 0, $limit);
        }

        $publish = ! $this->option('draft');
        $translate = ! $this->option('no-translate');
        $refresh = (bool) $this->option('refresh');
        $sleepMs = (int) $this->option('sleep');

        // Batch-fetch a header image (artwork/screenshot) for every town up front.
        $images = $this->fetchImages($titles);

        $this->info(count($titles).' city pages to process'.($publish ? ' (publishing)' : ' (drafts)').'…');
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

                $content = $filler->fetchCityLore($title);
                if ($content === null) {
                    $nocontent++;
                    $bar->advance();
                    if ($sleepMs > 0) {
                        usleep($sleepMs * 1000);
                    }

                    continue;
                }

                $overviewEn = $content['overview'];
                $canonEn = $content['canon'];

                $translations = [[
                    'locale'   => Locale::English->value,
                    'name'     => $display,
                    'overview' => $overviewEn,
                    'canon'    => $canonEn,
                ]];

                if ($translate) {
                    $esName = $existing?->translations->firstWhere('locale', 'es')?->name ?? $display;
                    $translations[] = [
                        'locale'   => Locale::Spanish->value,
                        'name'     => $esName,
                        'overview' => $this->tryTranslate($translator, $overviewEn),
                        'canon'    => $this->tryTranslate($translator, $canonEn),
                    ];
                }

                $meta = array_merge($existing->meta ?? [], $content['meta'], [
                    'imported_from' => 'tibiawiki',
                ]);

                $payload = [
                    'slug'          => $slug,
                    'type'          => EntryType::City->value,
                    'status'        => $publish ? EntryStatus::Published->value : EntryStatus::Draft->value,
                    'primary_image' => $images[$title] ?? $existing?->primary_image,
                    'meta'          => $meta,
                    'translations'  => $translations,
                    'sources'       => [[
                        'type'  => SourceType::TibiaWiki->value,
                        'title' => 'TibiaWiki: '.$title,
                        'url'   => 'https://tibia.fandom.com/wiki/'.rawurlencode(str_replace(' ', '_', $title)),
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

    /**
     * The canonical town list = the == [[Town]] == headings on the wiki "Cities"
     * article. Falls back to a hardcoded list if the page can't be fetched.
     *
     * @return list<string>
     */
    private function resolveTownList(): array
    {
        try {
            $json = Http::acceptJson()
                ->withHeaders(['User-Agent' => self::UA])
                ->timeout(20)
                ->retry(2, 400, throw: false)
                ->get(self::API, [
                    'action' => 'parse', 'format' => 'json',
                    'page' => 'Cities', 'prop' => 'wikitext', 'redirects' => 1,
                ])->json();

            $wikitext = $json['parse']['wikitext']['*'] ?? '';
            if (preg_match_all('/^==+\s*\[\[([^\]|]+)/m', $wikitext, $m) && $m[1]) {
                $towns = array_values(array_unique(array_map('trim', $m[1])));
                if (count($towns) >= 10) {
                    return $towns;
                }
            }
        } catch (\Throwable $e) {
            $this->warn('Could not read the wiki Cities list, using the fallback set: '.$e->getMessage());
        }

        return self::FALLBACK;
    }

    /** Strip a disambiguating "(City)" suffix some titles carry. */
    private function cleanName(string $title): string
    {
        return trim(preg_replace('/\s*\((?:City|Town)\)\s*$/i', '', $title) ?? $title);
    }

    /**
     * Pick a slug for the town. If a non-city entry already owns the base slug
     * (e.g. the character "Thais" vs the city), suffix it.
     *
     * @return array{0: string, 1: ?Entry}
     */
    private function resolveSlug(string $display): array
    {
        $base = Str::slug($display) ?: 'city';
        $existing = Entry::with('translations')->where('slug', $base)->first();

        if ($existing && $existing->type !== EntryType::City) {
            $slug = $base.'-city';
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
     * Batch-fetch a header image for each title via the pageimages API.
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
                        'pithumbsize' => 600,
                        'redirects' => 1,
                        'titles' => implode('|', $chunk),
                    ])->json();

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
