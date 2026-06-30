<?php

namespace App\Services;

use App\Enums\EntryStatus;
use App\Models\Entry;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Owns the write-side workflow for entries: persisting an article together
 * with its bilingual translations, cited sources, and related entries inside
 * a single transaction so the editorial record never ends up half-written.
 */
class EntryService
{
    /**
     * @param  array<string, mixed>  $data
     */
    public function create(array $data, ?int $userId = null): Entry
    {
        return DB::transaction(function () use ($data, $userId) {
            $entry = Entry::create([
                'slug' => $data['slug'] ?? $this->uniqueSlug($this->firstName($data)),
                'type' => $data['type'],
                'status' => $data['status'] ?? EntryStatus::Draft->value,
                'featured' => $data['featured'] ?? false,
                'primary_image' => $data['primary_image'] ?? null,
                'meta' => $data['meta'] ?? null,
                'created_by' => $userId,
                'published_at' => ($data['status'] ?? null) === EntryStatus::Published->value ? now() : null,
            ]);

            $this->syncRelations($entry, $data);

            return $entry->load(['translations', 'sources', 'relatedEntries.translations']);
        });
    }

    /**
     * @param  array<string, mixed>  $data
     */
    public function update(Entry $entry, array $data): Entry
    {
        return DB::transaction(function () use ($entry, $data) {
            $entry->fill(Arr::only($data, [
                'slug', 'type', 'status', 'featured', 'primary_image', 'meta',
            ]));

            // Stamp publish time the first time it goes live.
            if (($data['status'] ?? null) === EntryStatus::Published->value && ! $entry->published_at) {
                $entry->published_at = now();
            }

            $entry->save();

            $this->syncRelations($entry, $data);

            return $entry->load(['translations', 'sources', 'relatedEntries.translations']);
        });
    }

    /**
     * Soft-delete an entry. The model's `deleted` event bumps the content cache.
     */
    public function delete(Entry $entry): void
    {
        $entry->delete();
    }

    /**
     * Persist nested translations / sources / related entries when provided.
     *
     * @param  array<string, mixed>  $data
     */
    protected function syncRelations(Entry $entry, array $data): void
    {
        if (isset($data['translations'])) {
            foreach ($data['translations'] as $translation) {
                $entry->translations()->updateOrCreate(
                    ['locale' => $translation['locale']],
                    Arr::only($translation, [
                        'name', 'overview', 'canon', 'interpretations', 'theories', 'research_gaps',
                    ])
                );
            }
        }

        if (isset($data['sources'])) {
            $entry->sources()->delete();
            foreach (array_values($data['sources']) as $i => $source) {
                $entry->sources()->create([
                    'type' => $source['type'],
                    'title' => $source['title'],
                    'url' => $source['url'] ?? null,
                    'note' => $source['note'] ?? null,
                    'sort' => $source['sort'] ?? $i,
                ]);
            }
        }

        if (isset($data['related_entry_ids'])) {
            $entry->relatedEntries()->sync($data['related_entry_ids']);
        }
    }

    protected function uniqueSlug(string $name): string
    {
        $base = Str::slug($name) ?: 'entry';
        $slug = $base;
        $i = 1;

        while (Entry::where('slug', $slug)->exists()) {
            $slug = "{$base}-{$i}";
            $i++;
        }

        return $slug;
    }

    /**
     * @param  array<string, mixed>  $data
     */
    protected function firstName(array $data): string
    {
        return $data['translations'][0]['name'] ?? 'entry';
    }
}
