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
            // Flag boss creatures (meta.rank = 'Boss') without hydrating the whole
            // meta JSON — the map's Boss Watch uses it to let players search/follow
            // any boss, even the ones with no recent kill-stat "heat".
            ->selectRaw("CASE WHEN meta->>'rank' = 'Boss' THEN 1 ELSE 0 END as is_boss")
            // How the boss enters the world (Raid/Unique/Unblockable/Triggered/…) —
            // a JSON list, since a boss can carry several at once. Powers the Boss
            // Watch's per-spawntype tabs. Null for non-bosses / not-yet-backfilled.
            // Keep the raw JSON (->), not text (->>), so the transformer decodes the
            // array rather than a stringified "[...]".
            ->selectRaw("meta->'spawn_type' as spawn_type")
            ->with(['translations' => fn ($q) => $q->select('id', 'entry_id', 'locale', 'name')])
            ->get();
    }
}
