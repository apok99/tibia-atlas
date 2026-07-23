<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A completed house auction: the last bid the house carried before it flipped to
 * `rented`, which is what it sold for. Recorded by tibia:etl-houses; feeds the
 * price index (median paid per town over time).
 */
class HouseSale extends Model
{
    protected $table = 'house_sales';

    public $timestamps = false;

    protected $fillable = ['world', 'house_id', 'town', 'size', 'rent', 'price', 'sold_at'];

    protected $casts = [
        'house_id' => 'integer',
        'size' => 'integer',
        'rent' => 'integer',
        'price' => 'integer',
        'sold_at' => 'datetime',
    ];
}
