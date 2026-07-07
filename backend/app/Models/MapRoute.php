<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A community-submitted route on the interactive map: an ordered list of
 * waypoints with a name, sent in anonymously (optional author nickname + IP) to
 * be reviewed and published. Named MapRoute (not Route) to avoid colliding with
 * the Illuminate routing facade.
 */
class MapRoute extends Model
{
    protected $fillable = ['name', 'description', 'waypoints', 'connect', 'author', 'ip', 'status'];

    protected $casts = [
        'waypoints' => 'array',
    ];
}
