import { useCallback, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'tibia_atlas_collection'

/** slug → item category, so per-category progress works fully offline. */
type CollectionMap = Record<string, string>

/** Read the persisted collection (defensive against bad / legacy JSON). */
function read(): CollectionMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    // Legacy format was a bare array of slugs; upgrade it to the map shape.
    if (Array.isArray(parsed)) {
      return Object.fromEntries(parsed.filter((s) => typeof s === 'string').map((s) => [s, '']))
    }
    return parsed && typeof parsed === 'object' ? (parsed as CollectionMap) : {}
  } catch {
    return {}
  }
}

/**
 * Tracks which items the player has "collected" (the sticker-album mechanic),
 * persisted in localStorage so it survives reloads without any login. Stores
 * each slug's category too, so per-category progress is computed offline.
 * Syncs across tabs via the `storage` event.
 */
export function useCollection() {
  const [owned, setOwned] = useState<CollectionMap>(read)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(owned))
    } catch {
      /* storage full / disabled — collection just won't persist */
    }
  }, [owned])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setOwned(read())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggle = useCallback((slug: string, category = '') => {
    setOwned((prev) => {
      const next = { ...prev }
      if (slug in next) delete next[slug]
      else next[slug] = category
      return next
    })
  }, [])

  const has = useCallback((slug: string) => slug in owned, [owned])

  const reset = useCallback(() => setOwned({}), [])

  // Owned count per category, derived once per change.
  const byCategory = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const cat of Object.values(owned)) {
      if (cat) counts[cat] = (counts[cat] ?? 0) + 1
    }
    return counts
  }, [owned])

  const countIn = useCallback((category: string) => byCategory[category] ?? 0, [byCategory])

  return { owned, count: Object.keys(owned).length, has, toggle, reset, countIn }
}
