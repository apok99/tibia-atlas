import { compact } from './CountUp'

export interface TickerItem {
  race: string
  killed: number
  image: string | null
}

/**
 * "Breaking-news" style marquee that scrolls the most-hunted creatures and
 * their kill counts continuously across the full width. The list is duplicated
 * so the CSS translate loop is seamless.
 */
export function KillTicker({ items }: { items: TickerItem[] }) {
  if (!items.length) return null
  const loop = [...items, ...items]
  return (
    <div className="ks-ticker">
      <span className="ks-ticker-tag">● LIVE</span>
      <div className="ks-ticker-mask">
        <div className="ks-ticker-track">
          {loop.map((c, i) => (
            <span className="ks-ticker-item" key={`${c.race}-${i}`}>
              <span className="ks-ticker-dot" />
              {c.image ? (
                <img src={c.image} alt="" loading="lazy" />
              ) : (
                <span className="ks-ticker-skull">☠</span>
              )}
              <span className="ks-ticker-name">{c.race}</span>
              <span className="ks-ticker-count">{compact(c.killed)}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
