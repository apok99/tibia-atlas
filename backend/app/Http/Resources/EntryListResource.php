<?php

namespace App\Http\Resources;

use App\Models\Entry;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Lightweight shape for index/listing and search results.
 *
 * @mixin Entry
 */
class EntryListResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $locale = app()->getLocale();
        $translation = $this->translation($locale);

        return [
            'id' => $this->id,
            'slug' => $this->slug,
            'type' => $this->type->value,
            'status' => $this->status->value,
            'featured' => $this->featured,
            'primary_image' => $this->primary_image,
            'locale' => $translation?->locale->value,
            'name' => $translation?->name,
            'overview' => $translation?->overview,
            // Popularity: all-time counter + (when present) the trailing-window
            // count attached by the trending endpoint. `boss`/`difficulty` let
            // listing cards show a "Boss" badge / difficulty without a full load.
            'view_count' => (int) ($this->view_count ?? 0),
            'trend_views' => isset($this->trend_views) ? (int) $this->trend_views : null,
            'boss' => data_get($this->meta, 'rank') === 'Boss',
            'difficulty' => data_get($this->meta, 'difficulty'),
            'reviewed' => (bool) $this->reviewed,
            'reviewed_at' => $this->reviewed_at?->toIso8601String(),
            'available_locales' => $this->relationLoaded('translations')
                ? $this->translations->pluck('locale')->map(fn ($l) => $l->value)->values()
                : null,
            'published_at' => $this->published_at?->toIso8601String(),
        ];
    }
}
