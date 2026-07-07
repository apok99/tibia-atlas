<?php

namespace App\Http\Resources;

use App\Enums\EntryType;
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
            // Quest progression facets — let the quests index group cards by
            // recommended level and show region/access without a full load.
            'recommended_level' => data_get($this->meta, 'recommended_level'),
            'region' => data_get($this->meta, 'region'),
            'access' => data_get($this->meta, 'access'),
            // Item stats — null for non-items. Powers the album sections, the
            // collection progress, and the loadout configurator.
            'item' => $this->type === EntryType::Item ? [
                'category' => data_get($this->meta, 'item_category'),
                'object_class' => data_get($this->meta, 'object_class'),
                'slot' => data_get($this->meta, 'equip_slot'),
                'vocations' => data_get($this->meta, 'vocations', []),
                'level' => data_get($this->meta, 'level'),
                'attack' => data_get($this->meta, 'attack'),
                'element_attack' => data_get($this->meta, 'element_attack'),
                'element_attack_type' => data_get($this->meta, 'element_attack_type'),
                'atk_mod' => data_get($this->meta, 'atk_mod'),
                'hit_mod' => data_get($this->meta, 'hit_mod'),
                'defense' => data_get($this->meta, 'defense'),
                'defense_mod' => data_get($this->meta, 'defense_mod'),
                'armor' => data_get($this->meta, 'armor'),
                'bonuses' => data_get($this->meta, 'bonuses'),
                'resists' => data_get($this->meta, 'resists'),
                'power' => data_get($this->meta, 'power'),
                'weight' => data_get($this->meta, 'weight'),
                'hands' => data_get($this->meta, 'hands'),
                'weapon_type' => data_get($this->meta, 'weapon_type'),
                'damage_range' => data_get($this->meta, 'damage_range'),
                'damage_type' => data_get($this->meta, 'damage_type'),
                'imbue_slots' => data_get($this->meta, 'imbue_slots'),
            ] : null,
            'reviewed' => (bool) $this->reviewed,
            'reviewed_at' => $this->reviewed_at?->toIso8601String(),
            'available_locales' => $this->relationLoaded('translations')
                ? $this->translations->pluck('locale')->map(fn ($l) => $l->value)->values()
                : null,
            'published_at' => $this->published_at?->toIso8601String(),
        ];
    }
}
