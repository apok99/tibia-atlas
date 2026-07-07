<?php

namespace App\Console\Commands;

use App\Models\Entry;
use App\Services\Import\ItemImporter;
use Illuminate\Console\Command;

/**
 * Re-fetches TibiaWiki infobox stats for existing items and backfills the meta
 * keys the loadout configurator scores gear with but older imports never
 * captured: `item_subcategory` (Bows vs Crossbows), `bonuses` (skill attribs
 * like "magic level +2"), `resists` (elemental protection %) and the modern
 * weapon modifiers `atk_mod` / `hit_mod`. Surgical: ONLY those keys are
 * rewritten; lore, translations, status and images are never touched — safe to
 * run over published, hand-edited items.
 *
 * Wikitext is batch-fetched (50 pages per API call), so the full equipment
 * catalogue (~1.8k items) takes ~40 requests.
 *
 *   php artisan tibia:backfill-item-stats --dry-run
 *   php artisan tibia:backfill-item-stats               # all equippable items
 *   php artisan tibia:backfill-item-stats --only=yalahari-mask
 */
class BackfillItemStats extends Command
{
    /** The meta keys this backfill owns (copied fresh, removed when gone). */
    private const KEYS = [
        'item_subcategory', 'bonuses', 'resists', 'atk_mod', 'hit_mod', 'charges',
        'element_attack', 'element_attack_type',
    ];

    protected $signature = 'tibia:backfill-item-stats
        {--limit=0 : Max items to process (0 = all)}
        {--sleep=300 : Milliseconds to wait between wiki batch requests}
        {--only= : Only this item slug}
        {--dry-run : Show what would change without writing}';

    protected $description = 'Backfill meta stat keys (subcategory, bonuses, resists, atk/hit mods) from TibiaWiki without touching lore';

    public function handle(ItemImporter $importer): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $limit = (int) $this->option('limit');
        $sleep = (int) $this->option('sleep');
        $only = $this->option('only');

        $query = Entry::where('type', 'item')
            ->whereRaw("jsonb_exists(meta, 'equip_slot')")
            ->with('translations');
        if ($only) {
            $query = Entry::where('type', 'item')->where('slug', $only)->with('translations');
        }
        $entries = $query->orderBy('id')->get();
        if ($limit > 0) {
            $entries = $entries->take($limit);
        }

        $updated = 0;
        $missing = 0;
        $rows = [];

        foreach ($entries->chunk(50) as $chunk) {
            // One title per entry (EN name = wiki title); fetched as one call.
            $byTitle = [];
            foreach ($chunk as $entry) {
                $title = $entry->translations->firstWhere('locale', 'en')?->name ?: $entry->slug;
                $byTitle[$title] = $entry;
            }

            $texts = $importer->fetchWikitextBatch(array_keys($byTitle));

            foreach ($byTitle as $title => $entry) {
                $parsed = isset($texts[$title]) ? $importer->parseObjectWikitext($texts[$title]) : null;
                if ($parsed === null) {
                    $missing++;
                    $this->line("  <fg=yellow>skip</> {$entry->slug} (no object infobox)");

                    continue;
                }

                $meta = $entry->meta ?? [];
                $changes = [];
                foreach (self::KEYS as $key) {
                    $fresh = $parsed['meta'][$key] ?? null;
                    $before = $meta[$key] ?? null;
                    if ($before == $fresh) {
                        continue;
                    }
                    $changes[$key] = [$before, $fresh];
                    if ($fresh !== null && $fresh !== [] && $fresh !== '') {
                        $meta[$key] = $fresh;
                    } else {
                        unset($meta[$key]);
                    }
                }

                if ($changes) {
                    $updated++;
                    $rows[] = [$entry->slug, implode(', ', array_keys($changes))];
                    if (! $dryRun) {
                        $entry->forceFill(['meta' => $meta])->save();
                    }
                }
            }

            $this->line(sprintf('  batch done — %d updated so far', $updated));
            if ($sleep > 0) {
                usleep($sleep * 1000);
            }
        }

        if ($rows) {
            $this->newLine();
            $this->table(['slug', 'changed keys'], array_slice($rows, 0, 40));
        }

        $this->info(sprintf(
            '%sProcessed %d · %s %d · %d without infobox.',
            $dryRun ? '[dry-run] ' : '',
            $entries->count(),
            $dryRun ? 'would update' : 'updated',
            $updated,
            $missing,
        ));

        return self::SUCCESS;
    }
}
