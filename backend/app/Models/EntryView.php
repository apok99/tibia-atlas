<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A single deduplicated page view of an {@see Entry}. Used to compute both the
 * all-time popularity counter and the rolling "trending" window.
 */
class EntryView extends Model
{
    protected $fillable = ['entry_id', 'visitor'];

    /** @return BelongsTo<Entry, $this> */
    public function entry(): BelongsTo
    {
        return $this->belongsTo(Entry::class);
    }
}
