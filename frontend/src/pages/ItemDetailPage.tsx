import { useMemo, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useItemDetail, useItems } from '../hooks/useEntries'
import { useCollection } from '../hooks/useCollection'
import { useDebounce } from '../hooks/useDebounce'
import { statChips, VocationDots } from '../components/items/itemStats'
import { ItemDetailSkeleton } from '../components/Skeleton'
import { Seo, entrySeoTitle } from '../lib/seo'
import type { Dropper as DropperT, ItemDetail, NpcDeal } from '../types'

/** How many NPCs / droppers to show before a "show all (N)" toggle. */
const NPC_LIMIT = 12
const DROP_LIMIT = 24

/**
 * Full-page item detail — the same information the album's cromo used to show
 * in a modal, now a shareable URL (`/items/:slug`). A second item can be added
 * via `?vs=<slug>` to compare the two side by side, with the winning value of
 * each numeric stat highlighted.
 */
export function ItemDetailPage() {
  const { t, i18n } = useTranslation()
  const { slug = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const collection = useCollection()

  const vs = params.get('vs') || undefined
  const a = useItemDetail(slug)
  const b = useItemDetail(vs)

  const comparing = !!vs

  const setVs = (next: string | null) => {
    const p = new URLSearchParams(params)
    if (next) p.set('vs', next)
    else p.delete('vs')
    setParams(p, { replace: true })
  }

  const swap = () => {
    if (vs) navigateSwap()
  }
  const navigate = useNavigate()
  const navigateSwap = () => navigate(`/items/${vs}?vs=${slug}`, { replace: true })

  const es = (i18n.language || 'es').slice(0, 2) === 'es'
  const name = a.data?.name ?? null
  // Keyword-first title/description matching how players search items
  // ("<item> tibia precio / loot / stats"), with real detail when loaded.
  const seoTitle = name ? entrySeoTitle(name, 'item', es ? 'es' : 'en') : t('items.title')
  const cat = a.data?.item?.category
  const droppers = a.data?.dropped_by?.length ?? 0
  const seoDesc = name
    ? es
      ? `${name} en Tibia${cat ? ` (${cat})` : ''}: estadísticas, precio de mercado, NPCs que lo compran y venden${droppers ? `, y las ${droppers} criaturas que lo sueltan` : ''}.`
      : `${name} in Tibia${cat ? ` (${cat})` : ''}: stats, market price, NPCs that buy and sell it${droppers ? `, and the ${droppers} creatures that drop it` : ''}.`
    : t('items.intro')

  return (
    <div>
      <Seo title={seoTitle} description={seoDesc} path={`/items/${slug}`} image={a.data?.image ?? undefined} type="article" />

      {/* Top bar: back to album + compare controls. */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link
          to="/items"
          className="text-sm font-bold uppercase tracking-wider text-fg-mute transition hover:text-accent"
        >
          {t('items.backToAlbum')}
        </Link>

        <div className="ml-auto flex items-center gap-2">
          {comparing && (
            <>
              <button
                onClick={swap}
                className="rounded-md border border-line px-3 py-1.5 text-sm font-bold uppercase tracking-wider text-fg-mute transition hover:border-line-2 hover:text-fg"
              >
                ⇄ {t('items.swap')}
              </button>
              <button
                onClick={() => setVs(null)}
                className="rounded-md border border-line px-3 py-1.5 text-sm font-bold uppercase tracking-wider text-fg-mute transition hover:border-line-2 hover:text-fg"
              >
                {t('items.removeCompare')}
              </button>
            </>
          )}
          {!comparing && <ComparePicker excludeSlug={slug} onPick={setVs} />}
        </div>
      </div>

      {/* Stat comparison table (only when two items are loaded). */}
      {comparing && a.data && b.data && (
        <CompareTable a={a.data} b={b.data} t={t} />
      )}

      {/* Item column(s). */}
      <div className={`grid gap-5 ${comparing ? 'md:grid-cols-2' : ''}`}>
        <ItemColumn
          query={a}
          collected={collection.has(slug)}
          onToggle={() => collection.toggle(slug, a.data?.item?.category ?? '')}
        />
        {comparing && (
          <ItemColumn
            query={b}
            collected={vs ? collection.has(vs) : false}
            onToggle={() => vs && collection.toggle(vs, b.data?.item?.category ?? '')}
          />
        )}
      </div>
    </div>
  )
}

/** One item's full detail, rendered inside a panel (used per compare column). */
function ItemColumn({
  query,
  collected,
  onToggle,
}: {
  query: ReturnType<typeof useItemDetail>
  collected: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const { data, isLoading } = query

  if (isLoading || !data) {
    return (
      <div className="panel">
        <ItemDetailSkeleton />
      </div>
    )
  }

  const item = data.item

  return (
    <div className="panel p-6">
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
          <h1 className="text-3xl font-black tracking-tight text-fg">{data.name}</h1>
          <p className="mt-1 text-lg text-fg-dim">
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
        className={`mt-4 w-full rounded-md border px-3 py-2.5 text-sm font-bold uppercase tracking-wider transition ${
          collected
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-line text-fg-mute hover:border-line-2 hover:text-fg'
        }`}
      >
        {collected ? `✓ ${t('items.owned')}` : `+ ${t('items.markCollected')}`}
      </button>

      {/* Flavor / notes. */}
      {(data.overview || data.notes) && (
        <div className="mt-4 space-y-2 text-lg leading-relaxed text-fg">
          {data.overview && <p className="italic">“{data.overview}”</p>}
          {data.notes && <p className="text-fg-dim">{data.notes}</p>}
        </div>
      )}

      {/* Worth. */}
      {(data.value || data.npc_value != null) && (
        <Section title={t('items.value')}>
          <div className="flex flex-wrap gap-2 text-lg">
            {data.value && <span className="font-semibold text-fg">{data.value}</span>}
            {data.npc_value != null && (
              <span className="text-fg-dim">
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
          <p className="text-base text-fg-dim">{t('items.noDrops')}</p>
        ) : (
          <DropperList droppers={data.dropped_by} />
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
  )
}

/** A numeric row in the comparison table; `lowerBetter` flips the winner. */
type Row = { label: string; a: number | null; b: number | null; lowerBetter?: boolean }

function buildRows(a: ItemDetail, b: ItemDetail, t: TFunction): Row[] {
  const rows: Row[] = [
    { label: t('items.level'), a: a.item?.level, b: b.item?.level, lowerBetter: true },
    { label: t('items.atk'), a: a.item?.attack, b: b.item?.attack },
    { label: t('items.def'), a: a.item?.defense, b: b.item?.defense },
    { label: t('items.arm'), a: a.item?.armor, b: b.item?.armor },
    { label: t('items.power'), a: a.item?.power, b: b.item?.power },
    { label: 'Imbue', a: a.item?.imbue_slots, b: b.item?.imbue_slots },
    { label: t('items.weight'), a: a.item?.weight, b: b.item?.weight, lowerBetter: true },
    { label: t('items.npcValue'), a: a.npc_value, b: b.npc_value },
  ]
  // Drop rows where neither item has the stat.
  return rows.filter((r) => r.a != null || r.b != null)
}

function CompareTable({ a, b, t }: { a: ItemDetail; b: ItemDetail; t: TFunction }) {
  const rows = buildRows(a, b, t)
  const dmgA = a.item?.damage_range
  const dmgB = b.item?.damage_range

  const cell = (val: number | null, other: number | null, lowerBetter?: boolean) => {
    const wins =
      val != null &&
      other != null &&
      val !== other &&
      (lowerBetter ? val < other : val > other)
    return (
      <td
        className={`px-3 py-3 text-center text-lg tabular-nums ${
          wins ? 'font-bold text-accent' : 'text-fg'
        }`}
      >
        {val != null ? val.toLocaleString() : <span className="text-fg-mute">—</span>}
      </td>
    )
  }

  return (
    <div className="panel mb-5 overflow-hidden">
      <h2 className="border-b border-line px-4 py-3 text-xs font-bold uppercase tracking-widest text-accent-2">
        {t('items.statsHeading')}
      </h2>
      <table className="w-full text-lg">
        <thead>
          <tr className="border-b border-line text-sm uppercase tracking-wider text-fg-dim">
            <th className="px-3 py-3 text-left font-bold">{t('items.stat')}</th>
            <th className="px-3 py-3 text-center font-bold text-fg">{trunc(a.name)}</th>
            <th className="px-3 py-3 text-center font-bold text-fg">{trunc(b.name)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-line/60 last:border-0">
              <td className="px-3 py-3 text-left font-semibold text-fg-dim">{r.label}</td>
              {cell(r.a, r.b, r.lowerBetter)}
              {cell(r.b, r.a, r.lowerBetter)}
            </tr>
          ))}
          {(dmgA || dmgB) && (
            <tr className="border-b border-line/60 last:border-0">
              <td className="px-3 py-3 text-left font-semibold text-fg-dim">Dmg</td>
              <td className="px-3 py-3 text-center text-lg text-fg">{dmgA ?? '—'}</td>
              <td className="px-3 py-3 text-center text-lg text-fg">{dmgB ?? '—'}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function trunc(name: string | null): string {
  if (!name) return '—'
  return name.length > 22 ? `${name.slice(0, 21)}…` : name
}

/** Inline search box that lets the user pick a second item to compare. */
function ComparePicker({
  excludeSlug,
  onPick,
}: {
  excludeSlug: string
  onPick: (slug: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const q = useDebounce(search.trim(), 300)
  const { data } = useItems({ q: q || undefined, per_page: 8 })

  const results = useMemo(
    () => (data?.data ?? []).filter((i) => i.slug !== excludeSlug),
    [data, excludeSlug],
  )

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-accent/60 bg-accent/10 px-3 py-1.5 text-sm font-bold uppercase tracking-wider text-accent transition hover:bg-accent/20"
      >
        ⇄ {t('items.compare')}
      </button>
    )
  }

  return (
    <div className="relative">
      <input
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={t('items.pickCompare')}
        className="w-56 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-fg outline-none placeholder:text-fg-mute focus:border-accent/60"
      />
      {q && (
        <div className="absolute right-0 z-20 mt-1 max-h-72 w-72 overflow-y-auto rounded-md border border-line bg-bg shadow-xl">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-fg-mute">{t('items.pickEmpty')}</p>
          ) : (
            results.map((i) => (
              <button
                key={i.slug}
                onMouseDown={() => onPick(i.slug)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition hover:bg-surface"
              >
                <span className="sprite-tile grid h-8 w-8 shrink-0 place-items-center">
                  {i.primary_image && (
                    <img src={i.primary_image} alt="" loading="lazy" className="max-h-7 max-w-7 object-contain" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{i.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function Badge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`rounded bg-surface px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-fg-mute ${className}`}
    >
      {children}
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 border-t border-line pt-3">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-accent-2">
        {title}
      </h3>
      {children}
    </div>
  )
}

function NpcList({ deals, empty }: { deals: NpcDeal[]; empty: string }) {
  const { t } = useTranslation()
  const [showAll, setShowAll] = useState(false)
  if (!deals.length) return <p className="text-base text-fg-dim">{empty}</p>

  const shown = showAll ? deals : deals.slice(0, NPC_LIMIT)
  const hidden = deals.length - shown.length

  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((d, i) => (
        <span
          key={`${d.npc}-${i}`}
          className="inline-flex items-baseline gap-1 rounded border border-line bg-surface/60 px-2 py-1 text-base"
        >
          <span className="text-fg">{d.npc}</span>
          {d.price != null && (
            <span className="tabular-nums text-fg-dim">
              {d.price.toLocaleString()} {t('items.gp')}
            </span>
          )}
        </span>
      ))}
      {hidden > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="rounded border border-line px-2 py-1 text-sm font-bold text-fg-mute transition hover:text-accent"
        >
          +{hidden}
        </button>
      )}
    </div>
  )
}

function DropperList({ droppers }: { droppers: DropperT[] }) {
  const { t } = useTranslation()
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? droppers : droppers.slice(0, DROP_LIMIT)
  const hidden = droppers.length - shown.length

  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((c) => (
        <Dropper key={c.name} c={c} />
      ))}
      {hidden > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="rounded border border-line px-2 py-1 text-sm font-bold text-fg-mute transition hover:text-accent"
        >
          {t('items.showMore')} +{hidden}
        </button>
      )}
    </div>
  )
}

function Dropper({ c }: { c: DropperT }) {
  const inner = (
    <>
      {c.image ? (
        <img src={c.image} alt="" loading="lazy" className="h-6 w-6 object-contain" />
      ) : (
        <span className="grid h-6 w-6 place-items-center text-fg-mute">☠</span>
      )}
      <span className="max-w-36 truncate text-base">{c.name}</span>
    </>
  )
  const base = 'flex items-center gap-1.5 rounded border border-line bg-surface/60 py-0.5 pl-0.5 pr-2'
  return c.slug && c.published ? (
    <Link
      to={`/entry/${c.slug}`}
      className={`${base} text-fg-mute transition hover:border-accent/60 hover:text-accent-2`}
    >
      {inner}
    </Link>
  ) : (
    <span className={`${base} text-fg-mute`} title={c.name}>
      {inner}
    </span>
  )
}
