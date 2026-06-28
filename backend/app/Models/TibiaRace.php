<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A killable race/creature/boss as reported by killstatistics. */
class TibiaRace extends Model
{
    protected $fillable = ['name', 'entry_id'];

    /** Lore entry this race maps to (matched by EN name), if any. */
    /** @return BelongsTo<Entry, $this> */
    public function entry(): BelongsTo
    {
        return $this->belongsTo(Entry::class);
    }
}
