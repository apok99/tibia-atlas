import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Seo } from '../lib/seo'
import { compact } from '../lib/format'
import { useHunts, type HuntZone } from '../hooks/useHunts'
import { useIdleGame } from '../hooks/useIdleGame'
import {
  heroDps,
  heroHp,
  huntRates,
  levelFromXp,
  snapshotZone,
  upgradeCost,
  xpForLevel,
  IDLE_VOCATIONS,
  OFFLINE_CAP_SEC,
  type IdleSave,
  type IdleSimResult,
  type IdleUpgradeKind,
  type IdleVocation,
} from '../lib/idle'

// A friendly face per vocation for the creation cards and the hero badge.
const VOC_EMOJI: Record<IdleVocation, string> = {
  knight: '🛡️',
  paladin: '🏹',
  sorcerer: '🔥',
  druid: '🌿',
  monk: '👊',
}

const UPGRADE_KINDS: IdleUpgradeKind[] = ['weapon', 'armor', 'training']
const UPGRADE_EMOJI: Record<IdleUpgradeKind, string> = { weapon: '⚔️', armor: '🛡️', training: '📖' }

function fmtDuration(sec: number, hUnit: string, mUnit: string): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h <= 0) return String(m) + ' ' + mUnit
  return String(h) + ' ' + hUnit + ' ' + String(m) + ' ' + mUnit
}

export function IdlePage() {
  const { t } = useTranslation()
  const { save, welcome, createCharacter, selectZone, buyUpgrade, reset, dismissWelcome } = useIdleGame()

  return (
    <div className="mx-auto max-w-5xl">
      <Seo title={t('idle.brand')} description={t('idle.subtitle')} path="/idle" />

      <header className="mb-6 text-center">
        <p className="text-[0.65rem] font-bold uppercase tracking-[0.25em] text-accent">{t('idle.kicker')}</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight">{t('idle.title')}</h1>
        <p className="mt-2 text-sm text-fg-mute">{t('idle.subtitle')}</p>
      </header>

      {!save ? (
        <CreationCard onCreate={createCharacter} />
      ) : (
        <Dashboard save={save} onSelectZone={selectZone} onBuy={buyUpgrade} onReset={reset} />
      )}

      {welcome && save && <WelcomeBack result={welcome} save={save} onClose={dismissWelcome} />}

      <p className="mx-auto mt-8 max-w-xl text-center text-xs text-fg-mute">{t('idle.howTo')}</p>
    </div>
  )
}

// --- Character creation ---------------------------------------------------------

function CreationCard({ onCreate }: { onCreate: (name: string, voc: IdleVocation) => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [voc, setVoc] = useState<IdleVocation | null>(null)

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-line bg-surface p-6">
      <p className="text-center text-sm font-bold uppercase tracking-widest text-fg-mute">
        {t('idle.create.title')}
      </p>

      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 20))}
        placeholder={t('idle.create.namePlaceholder')}
        autoComplete="off"
        spellCheck={false}
        className="mt-4 w-full rounded-lg border border-line bg-bg-2 px-4 py-2.5 text-center text-sm font-semibold outline-none focus:border-accent"
      />

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {IDLE_VOCATIONS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setVoc(v)}
            className={
              'flex cursor-pointer flex-col items-center gap-1 rounded-xl border px-2 py-3 transition ' +
              (voc === v ? 'border-accent bg-accent/10' : 'border-line bg-bg-2 hover:border-line-2')
            }
          >
            <span className="text-2xl" aria-hidden="true">{VOC_EMOJI[v]}</span>
            <span className={'text-xs font-bold ' + (voc === v ? 'text-accent' : 'text-fg')}>
              {t('items.voc.' + v)}
            </span>
            <span className="text-center text-[10px] leading-tight text-fg-mute">
              {t('idle.create.voc.' + v)}
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={!voc || !name.trim()}
        onClick={() => voc && onCreate(name.trim(), voc)}
        className="mt-5 w-full rounded-lg bg-accent py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-40"
      >
        {t('idle.create.start')}
      </button>
      <p className="mt-2 text-center text-[11px] text-fg-mute">{t('idle.create.hint')}</p>
    </div>
  )
}

// --- Main dashboard ---------------------------------------------------------------

function Dashboard({
  save,
  onSelectZone,
  onBuy,
  onReset,
}: {
  save: IdleSave
  onSelectZone: (zone: HuntZone, level: number) => void
  onBuy: (kind: IdleUpgradeKind) => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  const [picking, setPicking] = useState(save.zone === null)

  const level = levelFromXp(save.xp)
  const lvlFloor = xpForLevel(level)
  const lvlCeil = xpForLevel(level + 1)
  const pct = Math.min(100, Math.max(0, ((save.xp - lvlFloor) / (lvlCeil - lvlFloor)) * 100))

  const rates = save.zone ? huntRates(save.zone, level, save.vocation, save.upgrades) : null
  const outgrown = save.zone !== null && level - save.zone.fetchedAtLevel >= 10

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_minmax(0,18rem)]">
      {/* Hero card */}
      <section className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-line bg-bg-2 text-2xl" aria-hidden="true">
            {VOC_EMOJI[save.vocation]}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-black">{save.name}</p>
            <p className="text-xs text-fg-mute">
              {t('idle.hero.levelVoc', { level, vocation: t('items.voc.' + save.vocation) })}
            </p>
          </div>
        </div>

        {/* XP bar to next level */}
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-[11px] text-fg-mute">
            <span>{t('idle.hero.xp')}</span>
            <span className="font-mono">{compact(save.xp)} / {compact(lvlCeil)}</span>
          </div>
          <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-bg-2">
            <div className="h-full rounded-full bg-accent transition-[width] duration-1000" style={{ width: pct + '%' }} />
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-2 text-center">
          <Stat label={t('idle.hero.gold')} value={compact(save.gold) + ' gp'} />
          <Stat label={t('idle.hero.kills')} value={compact(save.totalKills)} />
          <Stat label={t('idle.hero.dps')} value={compact(heroDps(level, save.vocation, save.upgrades))} />
          <Stat label={t('idle.hero.hp')} value={compact(heroHp(level, save.vocation, save.upgrades))} />
        </dl>

        <button
          type="button"
          onClick={() => {
            if (window.confirm(t('idle.hero.resetConfirm'))) onReset()
          }}
          className="mt-5 w-full rounded-lg border border-line px-3 py-1.5 text-[11px] font-bold text-fg-mute transition hover:border-red-400 hover:text-red-400"
        >
          {t('idle.hero.reset')}
        </button>
      </section>

      {/* Hunting ground */}
      <section className="rounded-2xl border border-line bg-surface p-5">
        {save.zone && !picking ? (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-fg-mute">{t('idle.zone.current')}</p>
                <p className="truncate text-lg font-black text-accent">{save.zone.name}</p>
              </div>
              <span className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-500">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
                {t('idle.zone.hunting')}
              </span>
            </div>

            {/* Live rates */}
            {rates && (
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                <Stat label={t('idle.zone.xpHour')} value={compact(rates.xpPerSec * 3600)} accent />
                <Stat label={t('idle.zone.goldHour')} value={compact(rates.goldPerSec * 3600)} />
                <Stat label={t('idle.zone.killsHour')} value={compact(rates.killsPerSec * 3600)} />
              </dl>
            )}

            {/* Zone population */}
            <ul className="mt-4 flex flex-wrap gap-1.5">
              {save.zone.creatures.slice(0, 8).map((c) => (
                <li
                  key={c.slug}
                  className={
                    'flex items-center gap-1.5 rounded-lg border border-line bg-bg-2 px-2 py-1 ' +
                    (c.tooDangerous ? 'opacity-40' : '')
                  }
                  title={c.tooDangerous ? t('idle.zone.avoided') : c.name}
                >
                  {c.image && <img src={c.image} alt="" className="h-6 w-6 object-contain" loading="lazy" />}
                  <span className="text-[11px] font-semibold">{c.name}</span>
                  <span className="text-[10px] text-fg-mute">×{c.count}</span>
                </li>
              ))}
            </ul>

            {outgrown && (
              <p className="mt-3 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-[11px] font-semibold text-fg">
                {t('idle.zone.outgrown')}
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white transition hover:opacity-90"
              >
                {t('idle.zone.change')}
              </button>
              <Link
                to={'/map#x=' + save.zone.x + '&y=' + save.zone.y + '&z=3&f=' + save.zone.z}
                className="rounded-lg border border-line px-4 py-2 text-sm font-bold text-fg transition hover:border-line-2"
              >
                {t('idle.zone.viewOnMap')}
              </Link>
            </div>
          </>
        ) : (
          <ZonePicker
            save={save}
            level={level}
            onPick={(z) => {
              onSelectZone(z, level)
              setPicking(false)
            }}
            onCancel={save.zone ? () => setPicking(false) : null}
          />
        )}
      </section>

      {/* Camp upgrades */}
      <section className="rounded-2xl border border-line bg-surface p-5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-fg-mute">{t('idle.shop.title')}</p>
        <ul className="mt-3 space-y-2">
          {UPGRADE_KINDS.map((kind) => {
            const tier = save.upgrades[kind]
            const cost = upgradeCost(kind, tier)
            const affordable = save.gold >= cost
            return (
              <li key={kind} className="rounded-xl border border-line bg-bg-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-bold">
                    <span aria-hidden="true">{UPGRADE_EMOJI[kind]}</span>
                    {t('idle.shop.' + kind)}
                    <span className="rounded bg-accent/15 px-1.5 py-px text-[10px] font-black text-accent">
                      {t('idle.shop.tier', { n: tier })}
                    </span>
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-fg-mute">{t('idle.shop.' + kind + 'Desc')}</p>
                <button
                  type="button"
                  disabled={!affordable}
                  onClick={() => onBuy(kind)}
                  className="mt-2 w-full rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-40"
                >
                  {t('idle.shop.buy', { cost: compact(cost) })}
                </button>
              </li>
            )
          })}
        </ul>
        <p className="mt-3 text-[11px] leading-relaxed text-fg-mute">{t('idle.shop.hint')}</p>
      </section>
    </div>
  )
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-bg-2 px-2 py-2">
      <dt className="text-[10px] uppercase tracking-wider text-fg-mute">{label}</dt>
      <dd className={'mt-0.5 font-mono text-sm font-bold ' + (accent ? 'text-accent' : 'text-fg')}>{value}</dd>
    </div>
  )
}

// --- Zone picker -------------------------------------------------------------------

function ZonePicker({
  save,
  level,
  onPick,
  onCancel,
}: {
  save: IdleSave
  level: number
  onPick: (zone: HuntZone) => void
  onCancel: (() => void) | null
}) {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useHunts(level, save.vocation, 'solo', true)

  // Rank the API's zones by what THIS hero (upgrades included) would earn there.
  const zones = useMemo(() => {
    if (!data) return []
    return data.zones
      .slice(0, 12)
      .map((z) => ({
        zone: z,
        xpHour: huntRates(snapshotZone(z, level), level, save.vocation, save.upgrades).xpPerSec * 3600,
      }))
      .sort((a, b) => b.xpHour - a.xpHour)
  }, [data, level, save.vocation, save.upgrades])

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-fg-mute">{t('idle.picker.kicker')}</p>
          <p className="text-lg font-black">{t('idle.picker.title')}</p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-fg-mute transition hover:border-line-2 hover:text-fg"
          >
            {t('idle.picker.cancel')}
          </button>
        )}
      </div>

      {isLoading && <p className="mt-6 text-center text-sm text-fg-mute">{t('idle.picker.loading')}</p>}
      {isError && <p className="mt-6 text-center text-sm text-fg-mute">{t('idle.picker.error')}</p>}

      <ul className="mt-3 max-h-[26rem] space-y-2 overflow-y-auto pr-1">
        {zones.map(({ zone, xpHour }) => (
          <li key={zone.id}>
            <button
              type="button"
              onClick={() => onPick(zone)}
              className="w-full cursor-pointer rounded-xl border border-line bg-bg-2 p-3 text-left transition hover:border-accent"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-bold">{zone.name ?? t('idle.picker.unknown')}</span>
                <span className="shrink-0 font-mono text-xs font-bold text-accent">
                  {t('idle.picker.xpHour', { n: compact(xpHour) })}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <DangerMeter danger={zone.danger} />
                <span className="text-[10px] text-fg-mute">
                  {t('idle.picker.creatures', { n: zone.creatures.filter((c) => !c.too_dangerous).length })}
                </span>
                {zone.access === 'quest' && (
                  <span className="rounded bg-gold/15 px-1.5 py-px text-[10px] font-bold text-gold">
                    {t('idle.picker.quest')}
                  </span>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DangerMeter({ danger }: { danger: number }) {
  const { t } = useTranslation()
  const pct = Math.min(100, Math.round(danger * 100))
  const tone = danger < 0.3 ? 'bg-emerald-500' : danger < 0.6 ? 'bg-gold' : 'bg-red-500'
  return (
    <span className="flex items-center gap-1.5" title={t('idle.picker.danger')}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-line">
        <span className={'block h-full rounded-full ' + tone} style={{ width: pct + '%' }} />
      </span>
    </span>
  )
}

// --- Welcome back ---------------------------------------------------------------------

function WelcomeBack({
  result,
  save,
  onClose,
}: {
  result: IdleSimResult
  save: IdleSave
  onClose: () => void
}) {
  const { t } = useTranslation()
  const away = fmtDuration(result.simulatedSec, t('idle.back.h'), t('idle.back.m'))

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 text-center shadow-xl">
        <p className="text-2xl" aria-hidden="true">⛺</p>
        <p className="mt-1 text-lg font-black">{t('idle.back.title', { name: save.name })}</p>
        <p className="mt-1 text-xs text-fg-mute">
          {t('idle.back.away', { time: away })}
          {result.capped && ' ' + t('idle.back.capped', { h: Math.round(OFFLINE_CAP_SEC / 3600) })}
        </p>

        <dl className="mt-4 grid grid-cols-3 gap-2">
          <Stat label={t('idle.back.xp')} value={'+' + compact(result.xpGained)} accent />
          <Stat label={t('idle.back.gold')} value={'+' + compact(result.goldGained)} />
          <Stat label={t('idle.back.kills')} value={'+' + compact(result.killsGained)} />
        </dl>
        {result.levelsGained > 0 && (
          <p className="mt-3 text-sm font-bold text-emerald-500">
            {t('idle.back.levels', { count: result.levelsGained })}
          </p>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-lg bg-accent py-2.5 text-sm font-bold text-white transition hover:opacity-90"
        >
          {t('idle.back.continue')}
        </button>
      </div>
    </div>
  )
}
