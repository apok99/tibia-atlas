import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLoadout } from '../../hooks/useEntries'
import { Skeleton } from '../Skeleton'
import type { EntryListItem, LoadoutSlot } from '../../types'
import { statChips } from './itemStats'

const VOCATIONS = ['knight', 'paladin', 'sorcerer', 'druid', 'monk'] as const

/**
 * Level brackets instead of a fiddly slider. Each band queries the gear you can
 * equip by the top of that range, so picking one shows the loadout you grow
 * into. Labels are plain numbers, so no translation is needed.
 */
const LEVEL_RANGES = [
  { label: '1–50', level: 50 },
  { label: '50–100', level: 100 },
  { label: '100–200', level: 200 },
  { label: '200–300', level: 300 },
  { label: '300–500', level: 500 },
  { label: '500–700', level: 700 },
  { label: '700+', level: 2000 },
] as const

export function ItemConfigurator() {
  const { t } = useTranslation()
  const [level, setLevel] = useState(200)
  const [vocation, setVocation] = useState<(typeof VOCATIONS)[number]>('knight')

  const { data, isLoading, isPlaceholderData } = useLoadout(level, vocation)
  const slots = data?.slots ?? []

  return (
    <div>
      <p className="mb-5 max-w-2xl text-sm text-fg-mute">{t('items.configIntro')}</p>

      {/* Controls. */}
      <div className="panel mb-6 flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="mr-1 text-xs font-bold uppercase tracking-wider text-fg-mute">
            {t('items.level')}
          </label>
          {LEVEL_RANGES.map((r) => (
            <button
              key={r.level}
              onClick={() => setLevel(r.level)}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-bold tabular-nums tracking-wider transition ${
                level === r.level
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-line text-fg-mute hover:border-line-2 hover:text-fg'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 lg:ml-auto">
          {VOCATIONS.map((v) => (
            <button
              key={v}
              onClick={() => setVocation(v)}
              className={`rounded-md border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition ${
                vocation === v
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-line text-fg-mute hover:border-line-2 hover:text-fg'
              }`}
            >
              {t(`items.voc.${v}`)}
            </button>
          ))}
        </div>
      </div>

      <h2 className="mb-3 flex items-center gap-2.5 text-xl font-black tracking-tight text-fg">
        <span className="h-5 w-1.5 rounded-full bg-accent" />
        {t('items.build')}
      </h2>

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2" aria-busy="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <SlotCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        // Keep the current build on screen while a new range/vocation loads
        // (the query keeps previous data); just dim it so the refresh reads.
        <div
          className={`grid gap-3 transition-opacity md:grid-cols-2 ${
            isPlaceholderData ? 'opacity-50' : 'opacity-100'
          }`}
        >
          {slots.map((slot) => (
            <SlotCard key={slot.slot} slot={slot} />
          ))}
        </div>
      )}

      <p className="mt-6 rounded-md border border-line bg-surface/50 px-4 py-3 text-xs text-fg-mute">
        ⚠ {t('items.disclaimer')}
      </p>
    </div>
  )
}

function SlotCard({ slot }: { slot: LoadoutSlot }) {
  const { t } = useTranslation()
  const best = slot.best

  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-widest text-accent-2">
          {t(`items.slot.${slot.slot}`)}
        </span>
      </div>

      {/* Best in slot. */}
      <div className="flex items-center gap-3">
        <div className="sprite-tile flex h-14 w-14 shrink-0 items-center justify-center">
          {best.primary_image && (
            <img
              src={best.primary_image}
              alt={best.name ?? ''}
              loading="lazy"
              className="sprite max-h-12 max-w-12 object-contain drop-shadow-[0_3px_6px_rgba(0,0,0,0.7)]"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-fg">{best.name}</h3>
          <div className="mt-1 flex flex-wrap gap-1">
            {statChips(best.item, t).map((c) => (
              <span
                key={c.label}
                className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-fg-mute"
              >
                {c.label} <span className="tabular-nums text-fg">{c.value}</span>
              </span>
            ))}
            {best.item?.level ? (
              <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-2">
                {t('items.lvl', { n: best.item.level })}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Flavour text — the item's in-game description. */}
      {best.overview && (
        <p className="mt-2 text-xs leading-relaxed text-fg-mute">{best.overview}</p>
      )}

      {/* Alternatives. */}
      {slot.alternatives.length > 0 && (
        <div className="mt-2.5 border-t border-line pt-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-fg-mute">
            {t('items.alternatives')}
          </span>
          <div className="mt-1.5 space-y-1.5">
            {slot.alternatives.map((alt) => (
              <AltRow key={alt.slug} alt={alt} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Placeholder mirroring <SlotCard>'s layout while a loadout loads. */
function SlotCardSkeleton() {
  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="h-2.5 w-10" />
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className="h-14 w-14 shrink-0 rounded" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <div className="flex gap-1">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-10" />
          </div>
        </div>
      </div>
    </div>
  )
}

function AltRow({ alt }: { alt: EntryListItem }) {
  const { t } = useTranslation()

  return (
    <div className="flex items-start gap-2.5 rounded border border-line bg-surface/60 p-2">
      <div className="sprite-tile flex h-10 w-10 shrink-0 items-center justify-center">
        {alt.primary_image && (
          <img
            src={alt.primary_image}
            alt={alt.name ?? ''}
            loading="lazy"
            className="sprite max-h-8 max-w-8 object-contain"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-fg">{alt.name}</span>
          {alt.item?.level ? (
            <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-2">
              {t('items.lvl', { n: alt.item.level })}
            </span>
          ) : null}
          {statChips(alt.item, t).map((c) => (
            <span
              key={c.label}
              className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-fg-mute"
            >
              {c.label} <span className="tabular-nums text-fg">{c.value}</span>
            </span>
          ))}
        </div>
        {alt.overview && (
          <p className="mt-1 text-[11px] leading-relaxed text-fg-mute">{alt.overview}</p>
        )}
      </div>
    </div>
  )
}
