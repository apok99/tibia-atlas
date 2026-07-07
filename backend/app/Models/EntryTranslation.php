<?php

namespace App\Models;

use App\Enums\Locale;
use App\Support\ContentCache;
use Database\Factories\EntryTranslationFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The localized text of an {@see Entry}: one row per locale (es / en),
 * holding the seven editorial sections of a Tibia Atlas article.
 */
class EntryTranslation extends Model
{
    /** @use HasFactory<EntryTranslationFactory> */
    use HasFactory;

    protected $fillable = [
        'entry_id',
        'locale',
        'name',
        'overview',
        'canon',
        'interpretations',
        'theories',
        'research_gaps',
    ];

    protected function casts(): array
    {
        return [
            'locale' => Locale::class,
        ];
    }

    /** Names feed the glossary cache — invalidate it when a translation changes. */
    protected static function booted(): void
    {
        static::saved(fn () => ContentCache::bump());
        static::deleted(fn () => ContentCache::bump());
    }

    /** @return BelongsTo<Entry, $this> */
    public function entry(): BelongsTo
    {
        return $this->belongsTo(Entry::class);
    }
}
