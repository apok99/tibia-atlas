<?php

namespace App\Models;

use App\Http\Controllers\Api\AltarController;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The locked daily "Altar del Bestiario" answer for one Tibia day. See the
 * migration and {@see AltarController} for how a date is resolved.
 */
class AltarPuzzle extends Model
{
    protected $fillable = ['date', 'entry_id'];

    protected function casts(): array
    {
        return ['date' => 'date'];
    }

    /** @return BelongsTo<Entry, $this> */
    public function entry(): BelongsTo
    {
        return $this->belongsTo(Entry::class);
    }
}
