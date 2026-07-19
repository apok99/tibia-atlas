<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A route-bug report submitted from the interactive map: the two endpoints a
 * visitor routed between, an optional description of what looked wrong, and a
 * snapshot of the computed itinerary. Anonymous (IP only, no accounts). Read
 * back with `php artisan tibia:route-reports` to triage and fix routing.
 */
class RouteReport extends Model
{
    protected $fillable = [
        'from_x', 'from_y', 'from_floor', 'from_label',
        'to_x', 'to_y', 'to_floor', 'to_label',
        'note', 'plan', 'total_tiles', 'partial',
        'hash', 'view_floor', 'lang', 'ip', 'status',
    ];

    protected $casts = [
        'plan' => 'array',
        'partial' => 'boolean',
    ];
}
