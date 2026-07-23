import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { TypeIcon } from './TypeIcon'
import type { EntryListItem, EntryType } from '../types'

/** Presentation order of the cross-reference groups: living things first,
 *  then geography, then abstractions. Unknown types sink to the end. */
const TYPE_ORDER: EntryType[] = [
  'creature',
  'character',
  'npc',
  'city',
  'location',
  'quest',
  'organization',
  'event',
  'item',
  'concept',
]

const orderOf = (t: EntryType) => {
  const i = TYPE_ORDER.indexOf(t)
  return i === -1 ? TYPE_ORDER.length : i
}

/**
 * Wiki pages that are about the game rather than about the world: they get
 * auto-linked from lore text but are never a lore cross-reference.
 */
const NOT_LORE = new Set(['tibia', 'retargeting'])

/**
 * The importer types every auto-linked wiki page as `concept` regardless of
 * what it really is, so a creature's "concepts" are usually its spawn areas.
 * The group is still worth showing — it's where the article points — but it
 * must not claim to be a taxonomy it isn't, hence its own neutral rubric.
 */
const isMention = (type: EntryType) => type === 'concept'

/** A quill nib: these are passages the article points at, not a kind of thing. */
function MentionIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M4 20l4-1 9.5-9.5a2.1 2.1 0 0 0-3-3L5 16zM14.5 6.5l3 3" />
    </svg>
  )
}

/** Drop cross-references that carry nothing a reader can use. */
function usable(r: EntryListItem): boolean {
  const name = r.name ?? r.slug ?? ''
  // Wiki sub-pages ("Forsaken Mine/Cyclopes") duplicate their parent article.
  if (name.includes('/')) return false
  if (NOT_LORE.has(r.slug)) return false
  // Empty auto-stubs: no blurb and no sprite means an empty page behind the link.
  if (!r.overview && !r.primary_image) return false
  return true
}

/**
 * "Véase también" — the entry sidebar's cross-reference plate, styled like the
 * index of an old atlas: one framed panel, entries grouped under small-caps
 * type rubrics, each reference a round sprite medallion with its name in
 * display serif. Replaces the old stacks of full-size EntryCards.
 */
export function RelatedCodex({ items }: { items: EntryListItem[] }) {
  const { t } = useTranslation()
  const shown = items.filter(usable)
  if (shown.length === 0) return null

  const types: EntryType[] = []
  for (const r of shown) if (!types.includes(r.type)) types.push(r.type)
  types.sort((a, b) => orderOf(a) - orderOf(b))
  const groups = types.map((type) => ({
    type,
    entries: shown.filter((r) => r.type === type),
  }))

  return (
    <section className="atlas-plate overflow-hidden">
      {/* Book-plate header: gilt rule broken by a diamond node, then the rubric. */}
      <header className="border-b border-line px-4 pb-3 pt-4 text-center">
        <div className="flex items-center justify-center gap-2" aria-hidden="true">
          <span className="rule-gilt w-12" />
          <span className="h-1.5 w-1.5 rotate-45 bg-gold" />
          <span className="rule-gilt w-12" />
        </div>
        <h2 className="mt-2 font-title text-[13px] font-bold uppercase tracking-[0.28em] text-fg">
          {t('entry.seeAlso')}
        </h2>
        <p className="mt-0.5 text-xs italic text-fg-mute">{t('entry.seeAlsoSub')}</p>
      </header>

      <div className="divide-y divide-line/70">
        {groups.map(({ type, entries }) => (
          <div key={type} className="py-1.5">
            <div className="flex items-center gap-2 px-4 py-1.5">
              {isMention(type) ? (
                <MentionIcon className="h-3.5 w-3.5 text-accent" />
              ) : (
                <TypeIcon type={type} className="h-3.5 w-3.5 text-accent" />
              )}
              <span className="small-caps text-fg-dim">
                {isMention(type)
                  ? t('entry.seeAlsoMentions')
                  : t(`types.${type}`, { defaultValue: type })}
              </span>
              <span className="h-px flex-1 bg-line" />
              <span className="font-title text-[10px] font-semibold tabular-nums text-fg-mute">
                {entries.length}
              </span>
            </div>

            {entries.map((r) => {
              // Items are draft catalogue entries with no public lore page.
              const to = r.type === 'item' ? `/items/${r.slug}` : `/entry/${r.slug}`
              return (
                <Link
                  key={r.id}
                  to={to}
                  className="group relative flex items-center gap-3 px-4 py-2 transition hover:bg-surface-2/70"
                >
                  {/* Wax-seal rule that unfurls along the left edge on hover. */}
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-1.5 left-0 w-[3px] origin-top scale-y-0 rounded-r bg-accent transition-transform duration-200 group-hover:scale-y-100"
                  />
                  <span className="sprite-tile grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border border-line-2/60 transition duration-200 group-hover:border-accent">
                    {r.primary_image ? (
                      <img
                        src={r.primary_image}
                        alt=""
                        loading="lazy"
                        className="sprite max-h-9 max-w-9 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)] transition duration-200 group-hover:scale-110"
                      />
                    ) : isMention(r.type) ? (
                      <MentionIcon className="h-5 w-5 text-fg-mute" />
                    ) : (
                      <TypeIcon type={r.type} className="h-5 w-5 text-fg-mute" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-title text-[15px] font-semibold leading-snug text-fg transition group-hover:text-accent">
                      {r.name ?? r.slug}
                    </span>
                    {r.overview && (
                      <span className="mt-px block truncate text-xs italic text-fg-mute">
                        {r.overview}
                      </span>
                    )}
                  </span>
                  {typeof r.recommended_level === 'number' && (
                    <span className="shrink-0 rounded-[2px] border border-line bg-surface-2 px-1.5 py-0.5 font-title text-[10px] font-bold tabular-nums text-accent-2">
                      {t('quests.lvl', { n: r.recommended_level })}
                    </span>
                  )}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 -translate-x-1 text-accent opacity-0 transition duration-200 group-hover:translate-x-0 group-hover:opacity-100"
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </Link>
              )
            })}
          </div>
        ))}
      </div>

      {/* Closing asterism, like the end of a chapter. */}
      <div
        aria-hidden="true"
        className="border-t border-line px-4 py-1.5 text-center font-title text-[11px] tracking-[0.4em] text-fg-mute"
      >
        ⁂
      </div>
    </section>
  )
}
