import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Icon } from '../lib/icons'
import type { BossRow } from '../hooks/useKillStats'

function BossCard({ b, color, hot, world }: { b: BossRow; color: string; hot: boolean; world?: string }) {
  const { t } = useTranslation()
  // Scoped to a world: the chip names THAT world and only it. Unscoped: the
  // sample world the row carries, plus a "+N" for its other active worlds.
  const firstWorld = world ?? b.worlds[0]
  const more = world ? 0 : b.worlds_active - 1
  const card = (
    <div
      className={`ks-raid-card ${hot ? 'is-hot' : 'is-cold'}`}
      style={{ ['--temp' as string]: color }}
      title={
        world
          ? t('ks.raidWorldStat', { w: world, c: b.world_day_killed ?? 0 })
          : t('ks.raidWorlds', { a: b.worlds_active, c: b.cooldown })
      }
    >
      <span className="ks-raid-badge">
        <span className="ks-raid-mark" style={{ color }}>
          <Icon name={hot ? 'flame' : 'moon'} />
        </span>
        {b.image ? <img src={b.image} alt={b.race} loading="lazy" /> : <span className="ks-raid-skull">☠</span>}
      </span>
      <span className="ks-raid-name">{b.race}</span>
      {firstWorld && (
        <span className="ks-raid-world" style={{ color }}>
          {firstWorld}
          {more > 0 && <span className="ks-raid-more"> +{more}</span>}
        </span>
      )}
    </div>
  )
  return b.slug ? (
    <Link to={`/entry/${b.slug}`} className="ks-raid-link">
      {card}
    </Link>
  ) : (
    card
  )
}

function Squad({ label, color, hot, bosses, world }: { label: string; color: string; hot: boolean; bosses: BossRow[]; world?: string }) {
  return (
    <div className="ks-squad">
      <div className="ks-squad-head">
        <span className="ks-squad-dot" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        <span style={{ color }}>{label}</span>
        <span className="ks-squad-count">{bosses.length}</span>
      </div>
      <div className="ks-squad-row">
        {bosses.map((b) => (
          <BossCard key={b.slug ?? b.race} b={b} color={color} hot={hot} world={world} />
        ))}
      </div>
    </div>
  )
}

/**
 * "Raid Boss Watch": the rare world/raid bosses split into two squads — the hot
 * ones likely up right now (top) and the ones recently killed / cooling down
 * (bottom). Each sprite glows by its spawn "temperature".
 */
export function BossWatch({ bosses, world = 'all' }: { bosses: BossRow[]; world?: string }) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  // A world is picked in the dashboard's world filter → the panel is that
  // world's watch: only bosses that world reports, and every reading (heat,
  // kills, the world chip) scoped to it. 'all' keeps the network-wide view.
  const scoped = world !== 'all'
  const scopedWorld = scoped ? world : undefined

  // Belongs to the selected world = that world reports it in the latest snapshot,
  // OR we have a recorded kill there to anchor a respawn estimate (heat non-null).
  // The second half matters: a rare boss killed on Antica last week drops out of
  // Antica's snapshot once the week rolls over, but its Antica reading is real.
  const rows = useMemo(
    () => (scoped ? bosses.filter((b) => b.world_present || b.heat !== null) : bosses),
    [bosses, scoped],
  )

  const query = q.trim().toLowerCase()
  // Match against the boss name and its world list so "antica" finds every
  // boss currently tracked on that world too. (Under a world filter the list is
  // already that world's, so the name is what's left to search.)
  const matches = useMemo(() => {
    if (!query) return null
    return rows.filter(
      (b) =>
        b.race.toLowerCase().includes(query) ||
        b.worlds.some((w) => w.toLowerCase().includes(query)),
    )
  }, [rows, query])

  if (!bosses.length) return <div className="ks-panel ks-skel h-full min-h-[280px]" />

  // Cooling down = killed within the last 24h. On a scoped panel that question
  // is asked of the selected world only; unscoped it counts worlds network-wide.
  const isCold = (b: BossRow) => (scoped ? (b.world_day_killed ?? 0) > 0 : b.cooldown > 0)

  // Keep the backend order (iconic world bosses by fame, then by heat) so the
  // famous raids — Ferumbras, Orshabaal… — always lead their squad.
  let hot = rows.filter((b) => !isCold(b))
  let cold = rows.filter(isCold)
  if (!hot.length || !cold.length) {
    const mid = Math.ceil(rows.length / 2)
    hot = rows.slice(0, mid)
    cold = rows.slice(mid)
  }
  hot = hot.slice(0, 8)
  cold = cold.slice(0, 8)

  return (
    <section className="ks-panel">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="ks-panel-title">{t('ks.raidTitle')}</h2>
        <span className="text-xs text-fg-mute">{scoped ? world : t('ks.raidSub')}</span>
      </div>

      <div className="ks-raid-search">
        <Icon name="search" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('ks.raidSearch')}
          aria-label={t('ks.raidSearch')}
        />
      </div>

      {!rows.length ? (
        <p className="ks-raid-empty">{t('ks.raidWorldEmpty', { w: world })}</p>
      ) : matches ? (
        matches.length ? (
          <div className="ks-raid-box">
            <Squad
              label={t('ks.raidSearchResults')}
              color="#c9a54a"
              hot={false}
              bosses={matches}
              world={scopedWorld}
            />
          </div>
        ) : (
          <p className="ks-raid-empty">{t('ks.raidSearchEmpty', { q: q.trim() })}</p>
        )
      ) : (
        <div className="ks-raid-box">
          <div className="ks-raid-half is-hot-half">
            <Squad label={t('ks.raidSquadHot')} color="#d23d2f" hot bosses={hot} world={scopedWorld} />
          </div>
          <div className="ks-raid-half is-cold-half">
            <Squad label={t('ks.raidSquadCold')} color="#6fa8c4" hot={false} bosses={cold} world={scopedWorld} />
          </div>
        </div>
      )}
    </section>
  )
}
