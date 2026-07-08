<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A house's live rent status on one world (rented / auctioned / free), snapshotted
 * from TibiaData by tibia:etl-houses. Keyed to the map's static house pins by the
 * real Tibia `house_id`.
 */
class HouseStatus extends Model
{
    protected $table = 'house_status';

    protected $fillable = ['world', 'house_id', 'status', 'bid', 'synced_at'];

    protected $casts = [
        'house_id' => 'integer',
        'bid' => 'integer',
        'synced_at' => 'datetime',
    ];
}
