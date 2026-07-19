<?php

namespace App\Http\Resources;

use App\Models\Entry;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The slim item shape the gear picker renders: a name, a sprite and the stats
 * on its row. The full EntryListResource carries what the ALBUM needs — the
 * overview text, view counters, quest facets, moderation fields — which is
 * roughly half the bytes of a 120-item page and none of what a picker shows.
 *
 * `?light=1` on /api/items selects this shape. Keep the field names identical
 * to EntryListResource's so the frontend renders either one unchanged.
 *
 * @mixin Entry
 */
class ItemPickerResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $locale = app()->getLocale();
        $translation = $this->translation($locale) ?? $this->translation('en');

        return [
            'id' => $this->id,
            'slug' => $this->slug,
            'name' => $translation?->name,
            'primary_image' => $this->primary_image,
            // Only the stats a picker row shows (gearHint) plus what the set
            // maths reads back — not the whole item sheet.
            'item' => [
                'slot' => data_get($this->meta, 'equip_slot'),
                'level' => data_get($this->meta, 'level'),
                'vocations' => data_get($this->meta, 'vocations', []),
                'armor' => data_get($this->meta, 'armor'),
                'attack' => data_get($this->meta, 'attack'),
                'element_attack' => data_get($this->meta, 'element_attack'),
                'element_attack_type' => data_get($this->meta, 'element_attack_type'),
                'defense' => data_get($this->meta, 'defense'),
                'resists' => data_get($this->meta, 'resists'),
                'bonuses' => data_get($this->meta, 'bonuses'),
                'imbue_slots' => data_get($this->meta, 'imbue_slots'),
                'hands' => data_get($this->meta, 'hands'),
                'weapon_type' => data_get($this->meta, 'weapon_type'),
                'power' => data_get($this->meta, 'power'),
            ],
        ];
    }
}
