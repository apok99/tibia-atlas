<?php

namespace App\Console\Commands;

use App\Models\Entry;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Mirror every external entry sprite onto our own public disk so the site never
 * hotlinks tibia.fandom.com / wikia at render time.
 *
 * Entry images live in a single column (`entries.primary_image`); everything
 * else (loot, kill-stats, glossary, map, og:image, JSON-LD) derives from it, so
 * mirroring at the source fixes every consumer with no frontend change.
 *
 * For each entry whose `primary_image` still points off-site we:
 *   1. download the original (kept in `meta.origin_image` for repair/audit),
 *   2. store it content-addressed at `sprites/<ab>/<sha1>.gif` on the public
 *      disk (sha1 of the ORIGIN URL → identical sprites dedupe, sharded so the
 *      folder never holds 11k files), and
 *   3. rewrite `primary_image` to the absolute URL of the mirrored copy.
 *
 * Idempotent and resumable: an entry already pointing at `/storage/sprites/` is
 * skipped, and a file already on disk is not re-downloaded. New imports/ETL keep
 * writing fandom URLs; the scheduled run (routes/console.php) mirrors the gaps.
 * A download that fails leaves the original URL in place (so the image still
 * renders from fandom) and flags `meta.image_mirror_failed` so a later run — or
 * `--retry-failed` — can try again.
 *
 *   php artisan tibia:mirror-images                 # mirror everything not yet local
 *   php artisan tibia:mirror-images --limit=50      # first 50 (debugging)
 *   php artisan tibia:mirror-images --retry-failed  # also retry past failures
 *   php artisan tibia:mirror-images --refresh       # re-download even if present
 *   php artisan tibia:mirror-images --dry-run       # report, write nothing
 */
class MirrorImages extends Command
{
    protected $signature = 'tibia:mirror-images
        {--limit=0 : Max entries to process (0 = all)}
        {--sleep=100 : Delay between downloads in milliseconds}
        {--retry-failed : Also re-attempt entries flagged image_mirror_failed}
        {--refresh : Re-download even if the mirrored file already exists}
        {--dry-run : Report what would change without writing}';

    protected $description = 'Download external entry sprites (fandom/wikia) onto our public disk and repoint primary_image at the local copy';

    /** A primary_image already pointing here is considered mirrored. */
    private const LOCAL_MARKER = '/storage/sprites/';

    public function handle(): int
    {
        $limit = (int) $this->option('limit');
        $sleep = max(0, (int) $this->option('sleep')) * 1000; // ms → µs
        $retryFailed = (bool) $this->option('retry-failed');
        $refresh = (bool) $this->option('refresh');
        $dryRun = (bool) $this->option('dry-run');

        $disk = Storage::disk('public');

        $query = Entry::query()
            ->whereNotNull('primary_image')
            ->where('primary_image', 'not like', '%'.self::LOCAL_MARKER.'%');

        // By default leave known-bad URLs alone (avoid hammering 404s every run);
        // --retry-failed opts back in.
        if (! $retryFailed) {
            $query->where(function ($q) {
                $q->whereNull('meta->image_mirror_failed')
                    ->orWhere('meta->image_mirror_failed', false);
            });
        }

        $total = (clone $query)->count();
        if ($total === 0) {
            $this->info('Nothing to mirror — every entry image is already local.');

            return self::SUCCESS;
        }

        $this->info(($dryRun ? '[dry-run] ' : '')."Mirroring up to {$total} entry image(s)…");

        $done = $downloaded = $reused = $failed = 0;

        $query->orderBy('id')->chunkById(200, function ($entries) use (
            $disk, $limit, $sleep, $refresh, $dryRun, &$done, &$downloaded, &$reused, &$failed
        ) {
            foreach ($entries as $entry) {
                if ($limit > 0 && $done >= $limit) {
                    return false; // stop chunking
                }
                $done++;

                $origin = $entry->meta['origin_image'] ?? $entry->primary_image;
                if (! is_string($origin) || ! Str::startsWith($origin, ['http://', 'https://'])) {
                    continue;
                }

                // Content-addressed by the ORIGIN url so identical sprites dedupe.
                // Extension is decided by the ACTUAL content-type once downloaded
                // (fandom serves webp behind a .gif url) so nginx sends the right
                // Content-Type — matters for og:image unfurlers, not just <img>.
                $hash = sha1($origin);
                $dir = 'sprites/'.substr($hash, 0, 2);

                $existing = $refresh ? null : $this->existingMirror($disk, $dir, $hash);

                if ($existing !== null) {
                    $path = $existing;
                    $reused++;
                } elseif ($dryRun) {
                    $downloaded++; // would download

                    continue;
                } else {
                    $fetched = $this->fetch($origin);
                    if ($fetched === null) {
                        $failed++;
                        $this->flagFailed($entry, $origin);

                        continue;
                    }
                    $path = $dir.'/'.$hash.'.'.$fetched['ext'];
                    $disk->put($path, $fetched['bytes']);
                    $downloaded++;
                    if ($sleep > 0) {
                        usleep($sleep);
                    }
                }

                $meta = $entry->meta ?? [];
                $meta['origin_image'] = $origin;
                unset($meta['image_mirror_failed']);

                // Absolute URL on our own host ({MEDIA_URL}/storage/…) — consumers
                // already expect an absolute primary_image, so nothing else changes.
                $entry->primary_image = $disk->url($path);
                $entry->meta = $meta;
                $entry->saveQuietly(); // no need to bump content caches for a mirror
            }

            return true;
        });

        $this->newLine();
        $this->info(sprintf(
            '%sProcessed %d — downloaded %d, reused %d, failed %d.',
            $dryRun ? '[dry-run] ' : '', $done, $downloaded, $reused, $failed
        ));

        if ($failed > 0) {
            $this->warn("{$failed} image(s) could not be fetched; originals left in place. Re-run with --retry-failed later.");
        }

        return self::SUCCESS;
    }

    /**
     * Locate an already-mirrored file for this hash across the known extensions,
     * or null. Avoids re-downloading without listing the whole shard directory.
     *
     * @param  \Illuminate\Contracts\Filesystem\Filesystem  $disk
     */
    private function existingMirror($disk, string $dir, string $hash): ?string
    {
        foreach (self::EXTENSIONS as $ext) {
            $path = $dir.'/'.$hash.'.'.$ext;
            if ($disk->exists($path)) {
                return $path;
            }
        }

        return null;
    }

    /** Content-type → file extension for the formats fandom/wikia actually serve. */
    private const EXTENSIONS = ['gif', 'png', 'webp', 'jpg'];

    private const TYPE_EXT = [
        'image/gif' => 'gif',
        'image/png' => 'png',
        'image/webp' => 'webp',
        'image/jpeg' => 'jpg',
        'image/jpg' => 'jpg',
    ];

    /**
     * Download an image via the system `curl` (follows redirects and passes the
     * fandom CDN, which 403s PHP/Guzzle's TLS fingerprint). Returns the raw bytes
     * and the extension for the ACTUAL content-type, or null on any failure /
     * non-image response.
     *
     * @return array{bytes: string, ext: string}|null
     */
    private function fetch(string $url): ?array
    {
        // Fandom 403-blocks the Special:FilePath redirect endpoint for datacenter
        // IPs, while api.php and the static.wikia.nocookie.net CDN stay open.
        // Resolve FilePath links to their real CDN URL via the API first, so the
        // actual download hits the reachable host.
        $url = $this->resolveFandomUrl($url) ?? $url;

        $tmp = tempnam(sys_get_temp_dir(), 'sprite_');
        if ($tmp === false) {
            return null;
        }

        try {
            $res = Process::timeout(40)->run([
                'curl', '-sS', '-L', '--fail', '--max-time', '30',
                '-A', 'TibiaAtlas-ImageMirror',
                '-H', 'Accept: image/avif,image/webp,image/gif,image/png,image/*,*/*',
                '-o', $tmp,
                '-w', '%{http_code} %{content_type}',
                $url,
            ]);

            if (! $res->successful()) {
                return null;
            }

            [$code, $type] = array_pad(explode(' ', trim($res->output()), 2), 2, '');
            $type = strtolower(trim(explode(';', $type)[0]));
            $bytes = @file_get_contents($tmp) ?: '';

            // Require a 2xx, a mapped image content-type, and a non-empty body —
            // guards against error pages or unexpected formats served with 200.
            $ext = self::TYPE_EXT[$type] ?? null;
            if ($code[0] !== '2' || $ext === null || $bytes === '') {
                return null;
            }

            return ['bytes' => $bytes, 'ext' => $ext];
        } catch (\Throwable) {
            return null;
        } finally {
            @unlink($tmp);
        }
    }

    /**
     * Resolve a fandom `Special:FilePath/<File>` link to its direct
     * static.wikia.nocookie.net URL via the MediaWiki imageinfo API, or null
     * when the URL isn't a FilePath link / the lookup fails (caller keeps the
     * original). Uses the same system-curl transport as the downloads.
     */
    private function resolveFandomUrl(string $url): ?string
    {
        if (! preg_match('#^https?://tibia\.fandom\.com/wiki/Special:FilePath/(.+)$#i', $url, $m)) {
            return null;
        }
        $file = rawurldecode($m[1]);

        try {
            $api = 'https://tibia.fandom.com/api.php?action=query&format=json&prop=imageinfo&iiprop=url&titles='
                .rawurlencode('File:'.$file);
            $res = Process::timeout(25)->run([
                'curl', '-sS', '--fail', '--max-time', '20',
                '-A', 'TibiaAtlas-ImageMirror', $api,
            ]);
            if (! $res->successful()) {
                return null;
            }
            $pages = json_decode($res->output(), true)['query']['pages'] ?? [];
            foreach ($pages as $page) {
                $direct = $page['imageinfo'][0]['url'] ?? null;
                if (is_string($direct) && $direct !== '') {
                    return $direct;
                }
            }
        } catch (\Throwable) {
            // fall through — caller downloads the original URL
        }

        return null;
    }

    /** Record that this origin URL couldn't be fetched (skipped by default next run). */
    private function flagFailed(Entry $entry, string $origin): void
    {
        $meta = $entry->meta ?? [];
        $meta['origin_image'] = $origin;
        $meta['image_mirror_failed'] = true;
        $entry->meta = $meta;
        $entry->saveQuietly();
    }
}
