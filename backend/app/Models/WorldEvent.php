<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A single live-world event feeding the map's news ticker (a house changed
 * status, etc.), produced by tibia:etl-houses. Generic by design: `type` names
 * the event, `ref_id`/`title`/`town` locate it, `meta` carries the specifics.
 */
class WorldEvent extends Model
{
    protected $table = 'world_events';

    protected $fillable = ['world', 'type', 'ref_id', 'title', 'town', 'meta', 'occurred_at'];

    protected $casts = [
        'ref_id' => 'integer',
        'meta' => 'array',
        'occurred_at' => 'datetime',
    ];
}
