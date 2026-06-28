<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Per-month rollup (sum of daily windows). Powers monthly/annual charts. */
class KillMonthly extends Model
{
    protected $table = 'kill_monthly';

    protected $fillable = [
        'world_id', 'race_id', 'period',
        'players_killed', 'killed', 'days_counted',
    ];

    protected function casts(): array
    {
        return ['period' => 'date'];
    }
}
