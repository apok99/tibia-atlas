<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One item a merchant NPC trades, with the real server prices. `buy` is what
 * the player pays to buy from the NPC; `sell` is what the NPC pays the player.
 * Derived from the OT npc luas — rebuilt by tibia:etl-npc-shops.
 */
class NpcOffer extends Model
{
    protected $fillable = ['trade_npc_id', 'item_entry_id', 'buy', 'sell'];

    protected $casts = [
        'trade_npc_id' => 'integer',
        'item_entry_id' => 'integer',
        'buy' => 'integer',
        'sell' => 'integer',
    ];

    /** @return BelongsTo<TradeNpc, $this> */
    public function npc(): BelongsTo
    {
        return $this->belongsTo(TradeNpc::class, 'trade_npc_id');
    }

    /** @return BelongsTo<Entry, $this> */
    public function item(): BelongsTo
    {
        return $this->belongsTo(Entry::class, 'item_entry_id');
    }
}
