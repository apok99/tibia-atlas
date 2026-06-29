import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLoadout } from '../../hooks/useEntries'
import type { EntryListItem, LoadoutSlot } from '../../types'
import { statChips } from './itemStats'

const VOCATIONS = ['knight', 'paladin', 'sorcerer', 'druid', 'monk'] as const

export function ItemConfigurator() {
  const { t } = useTranslation()
  const [level, setLevel] = useState(100)
  const [vocation, setVocation] = useState<(typeof VOCATIONS)[number]>('knight')

  const { data, isFetching } = useLoadout(level, vocation)
  const slots = data?.slots ?? []

  return (
    <div>
      <p className="mb-5 max-w-2xl text-sm text-fg-mute">{t('items.configIntro')}</p>

      {/* Controls. */}
      <div className="panel mb-6 flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <label className="text-xs font-bold uppercase tracking-wider text-fg-mute">
            {t('items.level')}
          </label>
          <input
            type="number"
            min={1}
            max={3000}
            value={level}
            onChange={(e) => setLevel(Math.max(1, Math.min(3000, Number(e.target.value) || 1)))}
            className="w-20 rounded-md border border-line bg-surface px-2 py-1.5 text-sm tabular-nums text-fg outline-none focus:border-accent/60"
          />
          <input
            type="range"
            min={1}
            max={3000}
            value={Math.min(level, 3000)}
            onChange={(e) => setLevel(Number(e.target.value))}
            className="hidden flex-1 accent-accent sm:block sm:w-48"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
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
        {isFetching && <span className="text-xs font-normal text-fg-mute">…</span>}
      </h2>

      <div className="grid gap-3 md:grid-cols-2">
        {slots.map((slot) => (
          <SlotCard key={slot.slot} slot={slot} />
        ))}
      </div>

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
        {best.item?.power != null && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-fg-mute">
            {t('items.power')} <span className="tabular-nums text-fg">{best.item.power}</span>
          </span>
        )}
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

      {/* Alternatives. */}
      {slot.alternatives.length > 0 && (
        <div className="mt-2.5 border-t border-line pt-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-fg-mute">
            {t('items.alternatives')}
          </span>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {slot.alternatives.map((alt) => (
              <AltChip key={alt.slug} alt={alt} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AltChip({ alt }: { alt: EntryListItem }) {
  return (
    <span
      title={`${alt.name}${alt.item?.power != null ? ` · ${alt.item.power}` : ''}`}
      className="flex items-center gap-1.5 rounded border border-line bg-surface/60 py-0.5 pl-0.5 pr-2"
    >
      {alt.primary_image && (
        <img
          src={alt.primary_image}
          alt={alt.name ?? ''}
          loading="lazy"
          className="h-6 w-6 object-contain"
        />
      )}
      <span className="max-w-28 truncate text-[11px] text-fg-mute">{alt.name}</span>
    </span>
  )
}
