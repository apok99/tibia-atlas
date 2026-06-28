<?php

namespace App\Models;

use App\Enums\SourceType;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A cited source backing an {@see Entry}. Central to the editorial rule:
 * "never invent sources" — every canonical claim should point here.
 */
class Source extends Model
{
    /** @use HasFactory<\Database\Factories\SourceFactory> */
    use HasFactory;

    protected $fillable = [
        'entry_id',
        'type',
        'title',
        'url',
        'note',
        'sort',
    ];

    protected function casts(): array
    {
        return [
            'type' => SourceType::class,
        ];
    }

    /** @return BelongsTo<Entry, $this> */
    public function entry(): BelongsTo
    {
        return $this->belongsTo(Entry::class);
    }
}
