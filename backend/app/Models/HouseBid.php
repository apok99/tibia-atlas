<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * One observation of a live auction bid, appended by tibia:etl-houses whenever
 * the bid CHANGES (house_status only keeps the current value). This is what the
 * per-house price chart draws.
 */
class HouseBid extends Model
{
    protected $table = 'house_bids';

    public $timestamps = false;

    protected $fillable = ['world', 'house_id', 'bid', 'time_left', 'observed_at'];

    protected $casts = [
        'house_id' => 'integer',
        'bid' => 'integer',
        'observed_at' => 'datetime',
    ];
}
