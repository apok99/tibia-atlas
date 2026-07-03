import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Icon } from '../lib/icons'
import type { BossRow } from '../hooks/useKillStats'

function BossCard({ b, color, hot }: { b: BossRow; color: string; hot: boolean }) {
  const { t } = useTranslation()
  const firstWorld = b.worlds[0]
  const more = b.worlds_active - 1
  const card = (
    <div
      className={`ks-raid-card ${hot ? 'is-hot' : 'is-cold'}`}
      style={{ ['--temp' as string]: color }}
      title={t('ks.raidWorlds', { a: b.worlds_active, c: b.cooldown })}
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

function Squad({ label, color, hot, bosses }: { label: string; color: string; hot: boolean; bosses: BossRow[] }) {
  return (
    <div className="ks-squad">
      <div className="ks-squad-head">
        <span className="ks-squad-dot" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        <span style={{ color }}>{label}</span>
        <span className="ks-squad-count">{bosses.length}</span>
      </div>
      <div className="ks-squad-row">
        {bosses.map((b) => (
          <BossCard key={b.slug ?? b.race} b={b} color={color} hot={hot} />
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
export function BossWatch({ bosses }: { bosses: BossRow[] }) {
  const { t } = useTranslation()
  if (!bosses.length) return <div className="ks-panel ks-skel h-full min-h-[280px]" />

  // Keep the backend order (iconic world bosses by fame, then by heat) so the
  // famous raids — Ferumbras, Orshabaal… — always lead their squad.
  let hot = bosses.filter((b) => b.cooldown === 0)
  let cold = bosses.filter((b) => b.cooldown > 0)
  if (!hot.length || !cold.length) {
    const mid = Math.ceil(bosses.length / 2)
    hot = bosses.slice(0, mid)
    cold = bosses.slice(mid)
  }
  hot = hot.slice(0, 8)
  cold = cold.slice(0, 8)

  return (
    <section className="ks-panel">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="ks-panel-title">{t('ks.raidTitle')}</h2>
        <span className="text-[11px] text-fg-mute">{t('ks.raidSub')}</span>
      </div>

      <div className="ks-raid-box">
        <div className="ks-raid-half is-hot-half">
          <Squad label={t('ks.raidSquadHot')} color="#d23d2f" hot bosses={hot} />
        </div>
        <div className="ks-raid-half is-cold-half">
          <Squad label={t('ks.raidSquadCold')} color="#6fa8c4" hot={false} bosses={cold} />
        </div>
      </div>
    </section>
  )
}
