<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * An NPC as parsed from the OT server data by tibia:etl-npc-shops: its map
 * spawn tiles, the lore entry it links to (when one exists) and — for
 * merchants — the shop offers hanging off it. Shopless NPCs (quest givers,
 * bankers, captains…) are kept too so the map search can locate them;
 * `is_merchant` tells the two apart. Fully derived — rebuilt on every ETL run.
 */
class TradeNpc extends Model
{
    protected $fillable = ['name', 'entry_id', 'city', 'spawns', 'currency', 'is_merchant'];

    protected $casts = [
        'entry_id' => 'integer',
        'spawns' => 'array',
        'is_merchant' => 'boolean',
    ];

    /** @return HasMany<NpcOffer, $this> */
    public function offers(): HasMany
    {
        return $this->hasMany(NpcOffer::class);
    }

    /** @return BelongsTo<Entry, $this> */
    public function entry(): BelongsTo
    {
        return $this->belongsTo(Entry::class);
    }
}
