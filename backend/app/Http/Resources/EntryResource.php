<?php

namespace App\Http\Resources;

use App\Models\Entry;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Full article shape. Serves the requested locale's text but always exposes
 * which locales exist, so the frontend can offer a content-language switch.
 *
 * @mixin Entry
 */
class EntryResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $locale = app()->getLocale();
        $translation = $this->translation($locale);

        // Keep the large spawn array out of `meta` (and the stat block); expose
        // it as dedicated top-level fields for the interactive map instead.
        $meta = $this->meta ?? [];
        $spawns = $meta['spawns'] ?? [];
        $spawnCount = $meta['spawn_count'] ?? count($spawns);
        unset($meta['spawns'], $meta['spawn_count']);

        return [
            'id' => $this->id,
            'slug' => $this->slug,
            'type' => $this->type->value,
            'type_label' => $this->type->labels()[$locale] ?? $this->type->labels()['en'],
            'status' => $this->status->value,
            'featured' => $this->featured,
            'primary_image' => $this->primary_image,
            'meta' => $meta,

            // Creature spawn points as absolute game coordinates [x, y, z],
            // for plotting hunting spots on the map.
            'spawns' => array_map(
                fn ($s) => ['x' => $s[0], 'y' => $s[1], 'z' => $s[2]],
                is_array($spawns) ? $spawns : []
            ),
            'spawn_count' => $spawnCount,

            // Resolved content for the active locale.
            'locale' => $translation?->locale->value,
            'name' => $translation?->name,
            'content' => [
                'overview' => $translation?->overview,
                'canon' => $translation?->canon,
                'interpretations' => $translation?->interpretations,
                'theories' => $translation?->theories,
                'research_gaps' => $translation?->research_gaps,
            ],

            // Which locales are actually available for this entry.
            'available_locales' => $this->translations->pluck('locale')
                ->map(fn ($l) => $l->value)->values(),

            'sources' => SourceResource::collection($this->whenLoaded('sources')),
            'related' => EntryListResource::collection($this->whenLoaded('relatedEntries')),

            // Items this creature drops (reverse-resolved from item drop lists);
            // present only on creature detail responses.
            'loot' => $this->when(! is_null($this->loot), fn () => $this->loot),

            'published_at' => $this->published_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
