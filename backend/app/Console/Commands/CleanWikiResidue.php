<?php

namespace App\Console\Commands;

use App\Models\Entry;
use App\Models\EntryTranslation;
use App\Support\Wikitext;
use Illuminate\Console\Command;

/**
 * Scrubs leftover TibiaWiki template markup out of already-imported content.
 * Older importer passes let half-captured `{{Template}}` calls through, so some
 * entries carry a description that is literally "}}" (Falcon Greaves, Cobra
 * Boots, …), an unterminated "{{TransportList | | |" tail on travelling NPCs, or
 * a spawn location cut off at "{{Mapper Coords|…".
 *
 * Three passes, each surgical:
 *  - translations: the prose sections, blanked to NULL when pure residue;
 *  - meta.location: the textual spawn location shown next to the map button;
 *  - meta.abilities: entries whose name/damage is mangled beyond repair are
 *    dropped — `tibia:backfill-abilities` re-imports them cleanly.
 *
 *   php artisan tibia:clean-wiki-residue --dry-run
 *   php artisan tibia:clean-wiki-residue
 */
class CleanWikiResidue extends Command
{
    /** The translated prose sections that can carry imported markup. */
    private const FIELDS = ['overview', 'canon', 'interpretations', 'theories', 'research_gaps'];

    protected $signature = 'tibia:clean-wiki-residue
        {--dry-run : Show what would change without writing}';

    protected $description = 'Strip leftover wiki template markup ("}}", unterminated {{Template) from imported entry text and meta';

    private bool $dryRun = false;

    public function handle(): int
    {
        $this->dryRun = (bool) $this->option('dry-run');

        $this->cleanTranslations();
        $this->cleanMeta();

        return self::SUCCESS;
    }

    /** Pass 1 — the five prose sections of every translation. */
    private function cleanTranslations(): void
    {
        $cleaned = 0;
        $emptied = 0;
        $rows = [];

        EntryTranslation::query()
            ->where(function ($q) {
                foreach (self::FIELDS as $field) {
                    $q->orWhere($field, 'like', '%{{%')->orWhere($field, 'like', '%}}%');
                }
            })
            ->with('entry:id,slug')
            ->chunkById(200, function ($translations) use (&$cleaned, &$emptied, &$rows) {
                foreach ($translations as $translation) {
                    $changes = [];
                    foreach (self::FIELDS as $field) {
                        $before = $translation->{$field};
                        if (! self::hasResidue($before)) {
                            continue;
                        }
                        $after = self::scrub($before);
                        if ($after === $before) {
                            continue;
                        }
                        $changes[$field] = $after;
                        if ($after === null) {
                            $emptied++;
                        }
                    }

                    if (! $changes) {
                        continue;
                    }

                    $cleaned++;
                    $rows[] = [
                        $translation->entry?->slug ?? "#{$translation->entry_id}",
                        $translation->locale->value,
                        implode(', ', array_keys($changes)),
                    ];
                    if (! $this->dryRun) {
                        $translation->forceFill($changes)->save();
                    }
                }
            });

        $this->report('Text sections', ['slug', 'locale', 'cleaned sections'], $rows);
        $this->info(sprintf(
            '%s%d translation rows cleaned · %d sections emptied to NULL.',
            $this->dryRun ? '[dry-run] ' : '',
            $cleaned,
            $emptied,
        ));
    }

    /** Pass 2 — meta.location prose and unsalvageable meta.abilities rows. */
    private function cleanMeta(): void
    {
        $cleaned = 0;
        $droppedAbilities = 0;
        $rows = [];

        Entry::query()->select('id', 'slug', 'meta')->chunkById(300, function ($entries) use (&$cleaned, &$droppedAbilities, &$rows) {
            foreach ($entries as $entry) {
                $meta = $entry->meta ?? [];
                $touched = [];

                if (self::hasResidue($meta['location'] ?? null)) {
                    $after = self::scrub($meta['location']);
                    if ($after === null) {
                        unset($meta['location']);
                    } else {
                        $meta['location'] = $after;
                    }
                    $touched[] = 'location';
                }

                if (is_array($meta['abilities'] ?? null)) {
                    $kept = array_values(array_filter(
                        $meta['abilities'],
                        fn ($ability) => ! is_array($ability) || ! array_filter($ability, self::hasResidue(...)),
                    ));
                    if (count($kept) !== count($meta['abilities'])) {
                        $droppedAbilities += count($meta['abilities']) - count($kept);
                        $touched[] = 'abilities';
                        if ($kept) {
                            $meta['abilities'] = $kept;
                        } else {
                            unset($meta['abilities']);
                        }
                    }
                }

                if (! $touched) {
                    continue;
                }

                $cleaned++;
                $rows[] = [$entry->slug, implode(', ', $touched)];
                if (! $this->dryRun) {
                    $entry->forceFill(['meta' => $meta])->save();
                }
            }
        });

        $this->report('Meta', ['slug', 'cleaned keys'], $rows);
        $this->info(sprintf(
            '%s%d entries cleaned · %d mangled ability rows dropped (re-run tibia:backfill-abilities to restore them).',
            $this->dryRun ? '[dry-run] ' : '',
            $cleaned,
            $droppedAbilities,
        ));
    }

    /** True when the value is text still carrying template braces. */
    private static function hasResidue(mixed $value): bool
    {
        return is_string($value) && (str_contains($value, '{{') || str_contains($value, '}}'));
    }

    /** Scrubbed text, or null when nothing readable survived. */
    private static function scrub(string $text): ?string
    {
        return Wikitext::tidy(Wikitext::stripTemplates($text)) ?: null;
    }

    /** @param  list<list<string>>  $rows */
    private function report(string $title, array $headers, array $rows): void
    {
        if (! $rows) {
            return;
        }
        $this->newLine();
        $this->line("<fg=cyan>{$title}</>");
        $this->table($headers, array_slice($rows, 0, 40));
        if (count($rows) > 40) {
            $this->line(sprintf('  … and %d more rows (not listed).', count($rows) - 40));
        }
    }
}
