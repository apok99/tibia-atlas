<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The localized title + text of a {@see Book}: one row per locale (en / es).
 * `locale` is kept as a plain string so collection lookups by locale are exact.
 */
class BookTranslation extends Model
{
    protected $fillable = [
        'book_id',
        'locale',
        'title',
        'text',
        'blurb',
    ];

    /** @return BelongsTo<Book, $this> */
    public function book(): BelongsTo
    {
        return $this->belongsTo(Book::class);
    }
}
