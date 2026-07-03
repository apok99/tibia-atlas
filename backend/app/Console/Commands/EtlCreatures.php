<?php

namespace App\Console\Commands;

use App\Enums\EntryStatus;
use App\Enums\EntryType;
use App\Enums\Locale;
use App\Enums\SourceType;
use App\Models\Entry;
use App\Services\EntryService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Daily ETL for the official TibiaData creature catalogue (/v4/creatures).
 *
 * Runs once a day (see the scheduler in routes/console) to keep every creature
 * current and to create the ones we don't have yet:
 *
 *   • EXISTING entries → refresh the objective stats (hitpoints, experience,
 *     loot, official sprite) and FILL any empty field, but never overwrite
 *     hand-written lore or Spanish translations. Editorial work is preserved.
 *   • MISSING creatures → created as PUBLISHED entries with the official English
 *     description + full stats, so the catalogue stays complete automatically.
 *
 * Creatures are matched to existing entries by the tibia.com Library "race" slug
 * (name lowercased, non-alphanumerics stripped), which is stable across the
 * singular/plural mismatch between TibiaData ("Demons") and our lore ("Demon").
 *
 *   php artisan tibia:etl-creatures                 # sync the whole catalogue
 *   php artisan tibia:etl-creatures --limit=20      # first 20 (debugging)
 *   php artisan tibia:etl-creatures --only-missing  # only create, never update
 *   php artisan tibia:etl-creatures --dry-run       # report, write nothing
 */
class EtlCreatures extends Command
{
    protected $signature = 'tibia:etl-creatures
        {--limit=0 : Max creatures to process (0 = all)}
        {--sleep=250 : Delay between detail requests in milliseconds}
        {--only-missing : Only create missing creatures, skip updating existing}
        {--dry-run : Report what would change without writing}';

    protected $description = 'Sync the official TibiaData creature catalogue: update stats for existing entries and create the ones we are missing';

    private string $base;

    /** Element token (TibiaData) → human label used in creature meta. */
    private const ELEMENT_LABELS = [
        'physical' => 'Physical',
        'holy' => 'Holy',
        'death' => 'Death',
        'fire' => 'Fire',
        'energy' => 'Energy',
        'ice' => 'Ice',
        'earth' => 'Earth',
        'drown' => 'Drown',
        'lifedrain' => 'Life drain',
        'life drain' => 'Life drain',
        'healing' => 'Healing',
    ];

    public function handle(EntryService $entries): int
    {
        $this->base = rtrim((string) env('TIBIADATA_BASE_URL', 'https://api.tibiadata.com'), '/');
        $limit = (int) $this->option('limit');
        $sleepMs = (int) $this->option('sleep');
        $dry = (bool) $this->option('dry-run');
        $onlyMissing = (bool) $this->option('only-missing');

        // 1) Fetch the catalogue -------------------------------------------
        $list = $this->fetchCreatureList();
        if ($list === null) {
            $this->error('Failed to fetch /v4/creatures.');

            return self::FAILURE;
        }
        if ($limit > 0) {
            $list = array_slice($list, 0, $limit);
        }
        $this->info(count($list).' creatures in the TibiaData catalogue.');

        // 2) Index every existing entry by its Library race slug ------------
        $byRace = $this->indexExistingByRace();

        $created = $updated = $skipped = $failed = 0;
        $bar = $this->output->createProgressBar(count($list));
        $bar->start();

        foreach ($list as $c) {
            $race = $c['race'] ?? null;
            if (! $race) {
                $bar->advance();

                continue;
            }

            $existingId = $byRace[$race] ?? null;

            if ($existingId && $onlyMissing) {
                $skipped++;
                $bar->advance();

                continue;
            }

            $detail = $this->fetchCreatureDetail($race);
            if ($detail === null) {
                $failed++;
                $bar->advance();
                $this->throttle($sleepMs);

                continue;
            }

            try {
                if ($existingId) {
                    $did = $this->updateExisting($entries, $existingId, $detail, $c, $dry);
                    $did ? $updated++ : $skipped++;
                } else {
                    $this->createNew($entries, $detail, $c, $dry);
                    $created++;
                }
            } catch (\Throwable $e) {
                $failed++;
                $this->newLine();
                $this->warn("  {$race}: {$e->getMessage()}");
            }

            $bar->advance();
            $this->throttle($sleepMs);
        }

        $bar->finish();
        $this->newLine(2);
        $prefix = $dry ? '[dry-run] ' : '';
        $this->info("{$prefix}Created: {$created}, updated: {$updated}, skipped: {$skipped}, failed: {$failed}.");

        return self::SUCCESS;
    }

    private function throttle(int $ms): void
    {
        if ($ms > 0) {
            usleep($ms * 1000);
        }
    }

    /**
     * Fetch /v4/creatures and return the flat creature list (name/race/image).
     *
     * @return list<array<string,mixed>>|null
     */
    private function fetchCreatureList(): ?array
    {
        try {
            $resp = Http::timeout(25)->retry(3, 1000)
                ->withHeaders(['User-Agent' => 'TibiaAtlas-ETL'])
                ->get("{$this->base}/v4/creatures");

            if (! $resp->ok()) {
                return null;
            }

            return $resp->json('creatures.creature_list') ?? [];
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Fetch /v4/creature/{race} full detail; null on failure.
     *
     * @return array<string,mixed>|null
     */
    private function fetchCreatureDetail(string $race): ?array
    {
        try {
            $resp = Http::timeout(25)->retry(2, 1500)
                ->withHeaders(['User-Agent' => 'TibiaAtlas-ETL'])
                ->get("{$this->base}/v4/creature/".rawurlencode($race));

            if (! $resp->ok()) {
                return null;
            }

            $creature = $resp->json('creature');

            return is_array($creature) && ! empty($creature['race']) ? $creature : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Build a race-slug → entry-id map from every existing entry. Prefers an
     * explicit meta.tibiadata_race set by a previous run; otherwise derives the
     * race from the English name so pre-existing lore matches on the first run.
     *
     * @return array<string,int>
     */
    private function indexExistingByRace(): array
    {
        $map = [];

        $rows = DB::table('entries as e')
            ->leftJoin('entry_translations as t', function ($j) {
                $j->on('t.entry_id', '=', 'e.id')->where('t.locale', '=', 'en');
            })
            ->whereNull('e.deleted_at')
            ->get(['e.id', 'e.meta', 't.name']);

        foreach ($rows as $r) {
            $meta = $r->meta ? json_decode($r->meta, true) : [];
            if (! empty($meta['tibiadata_race'])) {
                $map[$meta['tibiadata_race']] = $r->id;
            }
            if ($r->name) {
                // Don't let a name-derived key clobber an explicit race link.
                $map[$this->libraryRace($r->name)] ??= $r->id;
            }
        }

        return $map;
    }

    /**
     * The tibia.com Library "race" slug for a name: lowercased, disambiguation
     * suffix dropped, all non-alphanumerics removed ("Minotaur Mage" → minotaurmage).
     */
    private function libraryRace(string $name): string
    {
        $name = preg_replace('/\s*\([^)]*\)/', '', $name) ?? $name;

        return strtolower(preg_replace('/[^A-Za-z0-9]/', '', $name) ?? '');
    }

    /**
     * Refresh an existing entry: overwrite objective stats, fill empty fields,
     * never touch hand-written lore. Returns true if anything changed.
     *
     * @param  array<string,mixed>  $d  creature detail
     * @param  array<string,mixed>  $c  catalogue list row
     */
    private function updateExisting(EntryService $entries, int $id, array $d, array $c, bool $dry): bool
    {
        $entry = Entry::with('translations')->find($id);
        if (! $entry) {
            return false;
        }

        $meta = $entry->meta ?? [];
        $fresh = $this->buildMeta($d, $c);

        // Objective stats from the official source are always kept current.
        $overwrite = ['hitpoints', 'experience', 'loot', 'tibiadata_race', 'tibiadata_featured'];
        // Everything else only fills a gap so it never downgrades richer data
        // (e.g. TibiaWiki's precise damage percentages) or edited values.
        foreach ($fresh as $k => $v) {
            if (in_array($k, $overwrite, true) || ! array_key_exists($k, $meta) || $meta[$k] === null || $meta[$k] === '') {
                $meta[$k] = $v;
            }
        }

        $payload = ['meta' => $meta];

        // Fill the official sprite only if we don't already have an image.
        if (empty($entry->primary_image) && ! empty($d['image_url'])) {
            $payload['primary_image'] = $d['image_url'];
        }

        // Fill the English overview/canon only when they are empty — never clobber
        // hand-written lore, and never touch the Spanish translation.
        $en = $entry->translation('en');
        $overview = $this->cleanText($d['description'] ?? '');
        $canon = $this->cleanText($d['behaviour'] ?? '');
        $tr = [];
        if ($overview && (! $en || trim((string) $en->overview) === '')) {
            $tr['overview'] = $overview;
        }
        if ($canon && (! $en || trim((string) $en->canon) === '')) {
            $tr['canon'] = $canon;
        }
        if ($tr) {
            $payload['translations'] = [array_merge(['locale' => Locale::English->value], $tr)];
        }

        $changed = $meta != ($entry->meta ?? []) || isset($payload['primary_image']) || $tr !== [];
        if (! $changed) {
            return false;
        }

        if (! $dry) {
            $entries->update($entry, $payload);
        }

        return true;
    }

    /**
     * Create a missing creature as a PUBLISHED entry with the official English
     * description and full stats.
     *
     * @param  array<string,mixed>  $d
     * @param  array<string,mixed>  $c
     */
    private function createNew(EntryService $entries, array $d, array $c, bool $dry): void
    {
        // The catalogue names creatures in the plural ("Demons"); the lore uses
        // the singular ("Demon") to match the rest of the site.
        $displayName = Str::singular(trim($d['name'] ?? $c['name'] ?? ''));
        if ($displayName === '') {
            throw new \RuntimeException('Creature has no name.');
        }

        $slug = Str::slug($displayName);
        // Safety net: if the slug is somehow taken by an entry our race index
        // missed, update it instead of colliding on the unique constraint.
        if ($existing = Entry::where('slug', $slug)->first()) {
            $this->updateExisting($entries, $existing->id, $d, $c, $dry);

            return;
        }

        $overview = $this->cleanText($d['description'] ?? '') ?: null;
        $canon = $this->cleanText($d['behaviour'] ?? '') ?: null;

        $payload = [
            'slug' => $slug,
            'type' => EntryType::Creature->value,
            'status' => EntryStatus::Published->value,
            'primary_image' => $d['image_url'] ?? null,
            'meta' => $this->buildMeta($d, $c),
            'translations' => [[
                'locale' => Locale::English->value,
                'name' => $displayName,
                'overview' => $overview,
                'canon' => $canon,
                'research_gaps' => 'Auto-imported from TibiaData — translate to Spanish and enrich the lore.',
            ]],
            'sources' => [[
                'type' => SourceType::OfficialArticle->value,
                'title' => 'Tibia Library — Creatures: '.$displayName,
                'url' => 'https://www.tibia.com/library/?subtopic=creatures&race='.rawurlencode((string) $d['race']),
            ]],
        ];

        if (! $dry) {
            $entries->create($payload);
        }
    }

    /**
     * Map a TibiaData creature detail into our creature `meta` shape.
     *
     * @param  array<string,mixed>  $d
     * @param  array<string,mixed>  $c
     * @return array<string,mixed>
     */
    private function buildMeta(array $d, array $c): array
    {
        $meta = [
            'classification' => 'Creature',
            'tibiadata_race' => $d['race'],
            'tibiadata_featured' => (bool) ($c['featured'] ?? $d['featured'] ?? false),
        ];

        if (isset($d['hitpoints']) && $d['hitpoints'] !== null) {
            $meta['hitpoints'] = (int) $d['hitpoints'];
        }
        if (isset($d['experience_points']) && $d['experience_points'] !== null) {
            $meta['experience'] = (int) $d['experience_points'];
        }

        if ($labels = $this->elementLabels($d['immune'] ?? [])) {
            $meta['immune_to'] = implode(', ', $labels);
        }
        if ($labels = $this->elementLabels($d['weakness'] ?? [])) {
            $meta['weak_to'] = implode(', ', $labels);
        }
        if ($labels = $this->elementLabels($d['strong'] ?? [])) {
            $meta['resistant_to'] = implode(', ', $labels);
        }

        if (array_key_exists('be_paralysed', $d)) {
            $meta['paralysable'] = $d['be_paralysed'] ? 'Yes' : 'No';
        }
        if (! empty($d['see_invisible'])) {
            $meta['sense_invisible'] = 'Yes';
        }
        if (array_key_exists('be_summoned', $d)) {
            $meta['summonable'] = $d['be_summoned'] ? (int) ($d['summoned_mana'] ?? 0) ?: 'Yes' : 'No';
        }
        if (array_key_exists('be_convinced', $d)) {
            $meta['convinceable'] = $d['be_convinced'] ? (int) ($d['convinced_mana'] ?? 0) ?: 'Yes' : 'No';
        }

        if (! empty($d['loot_list']) && is_array($d['loot_list'])) {
            $meta['loot'] = array_values(array_filter(array_map('trim', $d['loot_list'])));
        }

        return $meta;
    }

    /**
     * Normalise a TibiaData element array into display labels.
     *
     * @param  mixed  $elements
     * @return list<string>
     */
    private function elementLabels($elements): array
    {
        if (! is_array($elements)) {
            return [];
        }

        $labels = [];
        foreach ($elements as $el) {
            $key = strtolower(trim((string) $el));
            $labels[] = self::ELEMENT_LABELS[$key] ?? Str::ucfirst($key);
        }

        return array_values(array_unique(array_filter($labels)));
    }

    /**
     * TibiaData descriptions embed literal newlines and stray quotes; tidy them
     * into clean paragraph text.
     */
    private function cleanText(string $text): string
    {
        $text = trim($text);
        if ($text === '') {
            return '';
        }
        $text = preg_replace("/\r\n?/", "\n", $text) ?? $text;
        $text = preg_replace("/\n{3,}/", "\n\n", $text) ?? $text;

        return trim($text);
    }
}
