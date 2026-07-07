<?php

namespace App\Queries\Entry;

use App\Models\Entry;
use Illuminate\Support\Collection;

/**
 * Lightweight read for the auto-linking glossary: every published entry with
 * just the columns the payload needs (id/slug/type + per-locale names).
 */
class GlossaryQuery
{
    /**
     * @return Collection<int, Entry>
     */
    public function publishedNames(): Collection
    {
        return Entry::published()
            ->select('id', 'slug', 'type', 'primary_image')
            ->with(['translations' => fn ($q) => $q->select('id', 'entry_id', 'locale', 'name')])
            ->get();
    }
}
