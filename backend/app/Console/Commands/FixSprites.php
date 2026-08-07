<?php

namespace App\Console\Commands;

use App\Models\Entry;
use App\Support\ContentCache;
use App\Support\KillStatsCache;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Repairs entries that were given somebody else's sprite.
 *
 * TibiaWiki names a sprite after the FULL page title, disambiguation included:
 * "Avalanche (Creature)" → File:Avalanche (Creature).gif, whereas
 * File:Avalanche.gif is the *rune*. The importer used to strip the parenthesis
 * before building the image URL, so ~37 creatures ended up showing the item /
 * NPC / other-version icon that happens to share their name (Avalanche wearing
 * the rune, Football the ball, every "(Nostalgia)" variant the modern sprite…).
 *
 * The importer now asks the page which files it actually uses
 * (TibiaWikiImporter::spriteName), so new imports are correct; this command
 * fixes the rows already in the database.
 *
 * For every entry whose name ends in "(…)" and whose `meta.origin_image` points
 * at a DIFFERENT file, we ask the wiki whether File:<full name>.gif exists. Only
 * then do we repoint the entry — a quest that deliberately borrows a reward's
 * icon ("Grave Danger Quest" → Skull Staff.gif) has no file of its own and is
 * left untouched.
 *
 * Repointing puts the fandom URL back into `primary_image`, which is exactly
 * what `tibia:mirror-images` looks for; it is chained automatically so the new
 * sprite is self-hosted in one go.
 *
 *   php artisan tibia:fix-sprites
 *   php artisan tibia:fix-sprites --dry-run     # report, write nothing
 *   php artisan tibia:fix-sprites --type=all    # not just creatures
 *   php artisan tibia:fix-sprites --no-mirror   # repoint only, mirror later
 */
class FixSprites extends Command
{
    protected $signature = 'tibia:fix-sprites
        {--type=creature : Entry type to audit ("all" for every type)}
        {--dry-run : List what would change without writing}
        {--no-mirror : Skip the tibia:mirror-images run afterwards}';

    protected $description = 'Give disambiguated entries ("Avalanche (Creature)") their own wiki sprite instead of the same-named item\'s';

    private const API = 'https://tibia.fandom.com/api.php';

    private const UA = 'TibiaAtlas/1.0 (lore research project; contact: contact@tibiaatlas.test)';

    private const FILEPATH = 'https://tibia.fandom.com/wiki/Special:FilePath/';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $type = (string) $this->option('type');

        $query = Entry::query()->with('translations');
        if ($type !== 'all') {
            $query->where('type', $type);
        }

        // Candidates: a disambiguated English name whose current image is a
        // fandom file that isn't named after the page.
        $candidates = [];
        foreach ($query->get() as $entry) {
            $name = $entry->translations->firstWhere('locale', 'en')?->name;
            if (! $name || ! preg_match('/\)$/', $name)) {
                continue;
            }

            $origin = $entry->meta['origin_image'] ?? $entry->primary_image;
            $current = $this->fandomFile($origin);
            if ($current === null || $this->same($current, $name.'.gif')) {
                continue;
            }

            $candidates[$name] = $entry;
        }

        if (empty($candidates)) {
            $this->info('Every entry already uses its own sprite. Nothing to do.');

            return self::SUCCESS;
        }

        $this->info('Checking '.count($candidates).' disambiguated name(s) against TibiaWiki…');

        $existing = $this->existingFiles(array_keys($candidates));
        $changed = [];

        foreach ($candidates as $name => $entry) {
            if (! in_array($this->normalise($name.'.gif'), $existing, true)) {
                continue; // no sprite of its own — borrowed image is intentional
            }

            $origin = self::FILEPATH.rawurlencode($name).'.gif';
            $was = $this->fandomFile($entry->meta['origin_image'] ?? $entry->primary_image);
            $changed[] = [$entry->slug, $was, $name.'.gif'];

            if ($dryRun) {
                continue;
            }

            $meta = $entry->meta ?? [];
            $meta['origin_image'] = $origin;
            unset($meta['image_mirror_failed']);
            $entry->meta = $meta;
            // Back to the off-site URL so tibia:mirror-images re-downloads it.
            $entry->primary_image = $origin;
            $entry->saveQuietly();
        }

        if (empty($changed)) {
            $this->info('All borrowed images checked out as intentional. Nothing to do.');

            return self::SUCCESS;
        }

        $this->table(['slug', 'sprite (was)', 'sprite (now)'], $changed);
        $this->info(($dryRun ? 'Would repoint ' : 'Repointed ').count($changed).' sprite(s).');

        if (! $dryRun && ! $this->option('no-mirror')) {
            $this->call('tibia:mirror-images');
        }

        if (! $dryRun) {
            // Rows are saved quietly (a sprite swap is not a content edit), so the
            // cached payloads that embed primary_image — entry pages, the boss
            // watch list — have to be invalidated by hand.
            ContentCache::bump();
            KillStatsCache::bump();
        }

        return self::SUCCESS;
    }

    /**
     * The `File:` base name a fandom image URL points at, or null when the URL
     * isn't a wiki file link (tibia.com library art, direct CDN uploads…).
     */
    private function fandomFile(?string $url): ?string
    {
        if (! is_string($url) || ! Str::startsWith($url, self::FILEPATH)) {
            return null;
        }

        return rawurldecode(Str::after($url, self::FILEPATH));
    }

    /** File names are case- and underscore-insensitive on MediaWiki. */
    private function normalise(string $file): string
    {
        return strtolower(str_replace('_', ' ', $file));
    }

    private function same(string $a, string $b): bool
    {
        return $this->normalise($a) === $this->normalise($b);
    }

    /**
     * Which of these names have a `File:<name>.gif` on the wiki, normalised.
     * Batched — the API takes up to 50 titles per query.
     *
     * @param  list<string>  $names
     * @return list<string>
     */
    private function existingFiles(array $names): array
    {
        $found = [];

        foreach (array_chunk($names, 40) as $chunk) {
            $response = Http::acceptJson()
                ->withHeaders(['User-Agent' => self::UA])
                ->timeout(20)
                ->retry(2, 300, throw: false)
                ->get(self::API, [
                    'action' => 'query',
                    'format' => 'json',
                    'titles' => collect($chunk)->map(fn ($n) => 'File:'.$n.'.gif')->implode('|'),
                ]);

            if ($response->failed()) {
                $this->warn('TibiaWiki lookup failed for a batch; those entries are left alone.');

                continue;
            }

            foreach ($response->json('query.pages', []) as $page) {
                if (! isset($page['missing'])) {
                    $found[] = $this->normalise(Str::after($page['title'], 'File:'));
                }
            }
        }

        return $found;
    }
}
