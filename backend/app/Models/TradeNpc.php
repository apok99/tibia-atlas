<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A merchant NPC as parsed from the OT server data by tibia:etl-npc-shops:
 * its map spawn tiles, the lore entry it links to (when one exists) and the
 * shop offers hanging off it. Fully derived — rebuilt on every ETL run.
 */
class TradeNpc extends Model
{
    protected $fillable = ['name', 'entry_id', 'city', 'spawns', 'currency'];

    protected $casts = [
        'entry_id' => 'integer',
        'spawns' => 'array',
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
