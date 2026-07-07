import { useEffect, useRef, useState } from 'react'
import { compact } from '../lib/format'

/**
 * Animated count-up. Eases from 0 to `value` over `duration` ms the first time
 * it becomes visible (and re-animates whenever `value` changes).
 */
export function CountUp({
  value,
  duration = 1400,
  format = compact,
  className,
}: {
  value: number
  duration?: number
  format?: (n: number) => string
  className?: string
}) {
  const [display, setDisplay] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const seen = useRef(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    let raf = 0
    let settle = 0
    const run = () => {
      const t0 = performance.now()
      const tick = (now: number) => {
        const p = Math.min((now - t0) / duration, 1)
        // easeOutExpo for a punchy settle.
        const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p)
        setDisplay(value * eased)
        if (p < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      // Guarantee the final value even if rAF is throttled (background tab,
      // headless renderer) — otherwise the counter could stick at 0.
      settle = window.setTimeout(() => setDisplay(value), duration + 80)
    }

    const start = () => {
      seen.current = true
      run()
    }

    // Already animated once (value changed), or the element is already on
    // screen at mount → animate straight away.
    const rect = node.getBoundingClientRect()
    const inView = rect.top < window.innerHeight && rect.bottom > 0
    const cleanup = () => {
      cancelAnimationFrame(raf)
      clearTimeout(settle)
    }
    if (seen.current || inView) {
      start()
      return cleanup
    }

    // Below the fold → defer until scrolled into view.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          start()
          io.disconnect()
        }
      },
      { threshold: 0.2 },
    )
    io.observe(node)
    return () => {
      io.disconnect()
      cleanup()
    }
  }, [value, duration])

  return (
    <span ref={ref} className={className}>
      {format(display)}
    </span>
  )
}
