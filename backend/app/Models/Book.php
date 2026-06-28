<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A readable in-game Tibia book, transcribed from TibiaWiki. The localized
 * title and text live in {@see BookTranslation} (one row per locale).
 */
class Book extends Model
{
    protected $fillable = [
        'slug',
        'booktype',
        'author',
        'location',
        'location_group',
        'source_url',
        'char_len',
        'is_lore_important',
    ];

    protected function casts(): array
    {
        return [
            'char_len' => 'integer',
            'is_lore_important' => 'boolean',
        ];
    }

    /** @return HasMany<BookTranslation, $this> */
    public function translations(): HasMany
    {
        return $this->hasMany(BookTranslation::class);
    }

    /**
     * The translation for a locale, falling back to English (the books are
     * originally English in-game content) when that locale isn't available yet.
     */
    public function translation(string $locale): ?BookTranslation
    {
        $rows = $this->translations;

        return $rows->firstWhere('locale', $locale)
            ?? $rows->firstWhere('locale', 'en')
            ?? $rows->first();
    }
}
