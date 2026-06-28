<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Raw daily snapshot of one race's kill window in one world. Pruned to ~30 days. */
class KillDaily extends Model
{
    protected $table = 'kill_daily';

    protected $fillable = [
        'world_id', 'race_id', 'snapshot_date',
        'day_players_killed', 'day_killed',
        'week_players_killed', 'week_killed',
    ];

    protected function casts(): array
    {
        return ['snapshot_date' => 'date'];
    }
}
