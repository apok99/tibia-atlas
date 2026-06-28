<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Audit record of an attempt to import lore from an external source
 * (e.g. TibiaWiki). Stores the raw payload so imports stay traceable.
 */
class ImportRun extends Model
{
    protected $fillable = [
        'source',
        'query',
        'status',
        'entry_id',
        'payload',
        'message',
        'triggered_by',
    ];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
        ];
    }

    /** @return BelongsTo<Entry, $this> */
    public function entry(): BelongsTo
    {
        return $this->belongsTo(Entry::class);
    }
}
