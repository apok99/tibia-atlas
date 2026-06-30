<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The locked daily Bestiordle answer for one Tibia day. See the migration and
 * {@see \App\Http\Controllers\Api\WordleController} for how a date is resolved.
 */
class WordlePuzzle extends Model
{
    protected $fillable = ['date', 'entry_id', 'word'];

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
