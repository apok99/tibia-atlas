import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useItemDetail } from '../../hooks/useEntries'
import type { Dropper as DropperT, NpcDeal } from '../../types'
import { statChips, VocationDots } from './itemStats'

/** How many NPCs / droppers to show before a "show all (N)" toggle. */
const NPC_LIMIT = 10
const DROP_LIMIT = 24

/**
 * Click-through detail for a cromo: lore, stats, worth, the NPCs that buy/sell
 * it, and the creatures that drop it (each linking to its bestiary entry when
 * published). Rendered as a modal so the album stays put behind it.
 */
export function ItemDetailModal({
  slug,
  collected,
  onToggle,
  onClose,
}: {
  slug: string
  collected: boolean
  onToggle: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useItemDetail(slug)

  // Close on Esc; lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const item = data?.item

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className="panel relative flex max-h-[90vh] w-full max-w-3xl flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label={t('items.close')}
          className="absolute right-3 top-3 z-10 grid h-7 w-7 place-items-center rounded-full bg-bg/80 text-fg-mute ring-1 ring-line transition hover:text-fg"
        >
          ✕
        </button>

        {isLoading || !data ? (
          <div className="p-10 text-center text-fg-mute">…</div>
        ) : (
          <div className="min-h-0 overflow-y-auto p-6">
            {/* Header. */}
            <div className="flex items-start gap-4">
              <div className="sprite-tile flex h-20 w-20 shrink-0 items-center justify-center">
                {data.image && (
                  <img
                    src={data.image}
                    alt={data.name ?? ''}
                    className="sprite max-h-16 max-w-16 object-contain drop-shadow-[0_3px_6px_rgba(0,0,0,0.7)]"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-2xl font-black tracking-tight text-fg">{data.name}</h2>
                <p className="mt-0.5 text-sm text-fg-mute">
                  {item?.category}
                  {item?.slot && <> · {t(`items.slot.${item.slot}`)}</>}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {item?.level ? (
                    <Badge className="text-accent-2">{t('items.lvl', { n: item.level })}</Badge>
                  ) : null}
                  {statChips(item, t).map((c) => (
                    <Badge key={c.label}>
                      {c.label} <span className="tabular-nums text-fg">{c.value}</span>
                    </Badge>
                  ))}
                  {item?.weight != null && (
                    <Badge>
                      {item.weight} {t('items.weight')}
                    </Badge>
                  )}
                  {item?.imbue_slots ? <Badge>{item.imbue_slots} imbue</Badge> : null}
                  <VocationDots vocations={item?.vocations ?? []} />
                </div>
              </div>
            </div>

            {/* Collect toggle. */}
            <button
              onClick={onToggle}
              className={`mt-4 w-full rounded-md border px-3 py-2 text-xs font-bold uppercase tracking-wider transition ${
                collected
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-line text-fg-mute hover:border-line-2 hover:text-fg'
              }`}
            >
              {collected ? `✓ ${t('items.owned')}` : `+ ${t('items.markCollected')}`}
            </button>

            {/* Flavor / notes. */}
            {(data.overview || data.notes) && (
              <div className="mt-4 space-y-2 text-sm text-fg-mute">
                {data.overview && <p className="italic text-fg">“{data.overview}”</p>}
                {data.notes && <p>{data.notes}</p>}
              </div>
            )}

            {/* Worth. */}
            {(data.value || data.npc_value != null) && (
              <Section title={t('items.value')}>
                <div className="flex flex-wrap gap-2 text-sm">
                  {data.value && <span className="font-semibold text-fg">{data.value}</span>}
                  {data.npc_value != null && (
                    <span className="text-fg-mute">
                      {t('items.npcValue')}: {data.npc_value.toLocaleString()} {t('items.gp')}
                    </span>
                  )}
                </div>
              </Section>
            )}

            {/* Buy / sell. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Section title={t('items.buyFrom')}>
                <NpcList deals={data.npc_buy} empty={t('items.noTrade')} />
              </Section>
              <Section title={t('items.sellTo')}>
                <NpcList deals={data.npc_sell} empty={t('items.noTrade')} />
              </Section>
            </div>

            {/* Dropped by. */}
            <Section title={`${t('items.droppedBy')} (${data.dropped_by.length})`}>
              {data.dropped_by.length === 0 ? (
                <p className="text-sm text-fg-mute">{t('items.noDrops')}</p>
              ) : (
                <DropperList droppers={data.dropped_by} onNavigate={onClose} />
              )}
            </Section>

            {data.wiki_url && (
              <a
                href={data.wiki_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-block text-xs font-bold uppercase tracking-wider text-fg-mute transition hover:text-accent"
              >
                {t('items.onWiki')} →
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Badge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`rounded bg-surface px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-fg-mute ${className}`}
    >
      {children}
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 border-t border-line pt-3">
      <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-accent-2">
        {title}
      </h3>
      {children}
    </div>
  )
}

function NpcList({ deals, empty }: { deals: NpcDeal[]; empty: string }) {
  const { t } = useTranslation()
  const [showAll, setShowAll] = useState(false)
  if (!deals.length) return <p className="text-sm text-fg-mute">{empty}</p>

  const shown = showAll ? deals : deals.slice(0, NPC_LIMIT)
  const hidden = deals.length - shown.length

  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((d, i) => (
        <span
          key={`${d.npc}-${i}`}
          className="inline-flex items-baseline gap-1 rounded border border-line bg-surface/60 px-1.5 py-0.5 text-[11px]"
        >
          <span className="text-fg">{d.npc}</span>
          {d.price != null && (
            <span className="tabular-nums text-fg-mute">
              {d.price.toLocaleString()} {t('items.gp')}
            </span>
          )}
        </span>
      ))}
      {hidden > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="rounded border border-line px-1.5 py-0.5 text-[11px] font-bold text-fg-mute transition hover:text-accent"
        >
          +{hidden}
        </button>
      )}
    </div>
  )
}

function DropperList({ droppers, onNavigate }: { droppers: DropperT[]; onNavigate: () => void }) {
  const { t } = useTranslation()
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? droppers : droppers.slice(0, DROP_LIMIT)
  const hidden = droppers.length - shown.length

  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((c) => (
        <Dropper key={c.name} c={c} onNavigate={onNavigate} />
      ))}
      {hidden > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="rounded border border-line px-2 py-0.5 text-[11px] font-bold text-fg-mute transition hover:text-accent"
        >
          {t('items.showMore')} +{hidden}
        </button>
      )}
    </div>
  )
}

function Dropper({ c, onNavigate }: { c: DropperT; onNavigate: () => void }) {
  const inner = (
    <>
      {c.image ? (
        <img src={c.image} alt="" loading="lazy" className="h-6 w-6 object-contain" />
      ) : (
        <span className="grid h-6 w-6 place-items-center text-fg-mute">☠</span>
      )}
      <span className="max-w-32 truncate text-[11px]">{c.name}</span>
    </>
  )
  const base = 'flex items-center gap-1.5 rounded border border-line bg-surface/60 py-0.5 pl-0.5 pr-2'
  return c.slug && c.published ? (
    <Link to={`/entry/${c.slug}`} onClick={onNavigate} className={`${base} text-fg-mute transition hover:border-accent/60 hover:text-accent-2`}>
      {inner}
    </Link>
  ) : (
    <span className={`${base} text-fg-mute`} title={c.name}>
      {inner}
    </span>
  )
}
