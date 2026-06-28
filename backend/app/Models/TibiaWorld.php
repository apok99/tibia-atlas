<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** A Tibia game world, refreshed each ETL run from /v4/worlds. */
class TibiaWorld extends Model
{
    protected $fillable = [
        'name', 'location', 'pvp_type', 'game_world_type',
        'status', 'players_online', 'last_synced_at',
    ];

    protected function casts(): array
    {
        return [
            'players_online' => 'integer',
            'last_synced_at' => 'datetime',
        ];
    }

    /** @return HasMany<KillDaily, $this> */
    public function dailyKills(): HasMany
    {
        return $this->hasMany(KillDaily::class, 'world_id');
    }
}
