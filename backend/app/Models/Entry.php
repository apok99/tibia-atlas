<?php

namespace App\Models;

use App\Enums\EntryStatus;
use App\Enums\EntryType;
use App\Support\ContentCache;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A single lore subject (creature, character, city, …) documented in Tibia Atlas.
 * Textual content lives in {@see EntryTranslation} (one row per locale).
 */
class Entry extends Model
{
    /** @use HasFactory<\Database\Factories\EntryFactory> */
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'slug',
        'type',
        'status',
        'featured',
        'primary_image',
        'meta',
        'created_by',
        'published_at',
        'reviewed',
        'reviewed_at',
    ];

    protected function casts(): array
    {
        return [
            'type' => EntryType::class,
            'status' => EntryStatus::class,
            'featured' => 'boolean',
            'meta' => 'array',
            'published_at' => 'datetime',
            'reviewed' => 'boolean',
            'reviewed_at' => 'datetime',
        ];
    }

    /** Invalidate the public content caches (glossary, facets) on any change. */
    protected static function booted(): void
    {
        static::saved(fn () => ContentCache::bump());
        static::deleted(fn () => ContentCache::bump());
    }

    public function getRouteKeyName(): string
    {
        return 'slug';
    }

    // ---- Relationships -------------------------------------------------

    /** @return HasMany<EntryTranslation, $this> */
    public function translations(): HasMany
    {
        return $this->hasMany(EntryTranslation::class);
    }

    /** @return HasMany<Source, $this> */
    public function sources(): HasMany
    {
        return $this->hasMany(Source::class)->orderBy('sort');
    }

    /** @return BelongsTo<User, $this> */
    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * Entries this entry links to (related characters, cities, creatures…).
     *
     * @return BelongsToMany<Entry, $this>
     */
    public function relatedEntries(): BelongsToMany
    {
        return $this->belongsToMany(Entry::class, 'entry_relations', 'entry_id', 'related_entry_id')
            ->withPivot('relation_type')
            ->withTimestamps();
    }

    // ---- Scopes --------------------------------------------------------

    /** @param Builder<Entry> $query */
    public function scopePublished(Builder $query): void
    {
        $query->where('status', EntryStatus::Published);
    }

    /** @param Builder<Entry> $query */
    public function scopeOfType(Builder $query, EntryType|string $type): void
    {
        $query->where('type', $type instanceof EntryType ? $type->value : $type);
    }

    // ---- Helpers -------------------------------------------------------

    /**
     * Return the translation for a locale, falling back to any available one.
     */
    public function translation(string $locale): ?EntryTranslation
    {
        return $this->translations->firstWhere('locale', $locale)
            ?? $this->translations->first();
    }
}
