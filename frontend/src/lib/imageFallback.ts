// Global broken-image handler.
//
// Many sprites/images load from external sources (TibiaWiki `Special:FilePath`
// proxies, etc.) that 404 or fail intermittently. By default the browser then
// shows its ugly "broken image" glyph. This installs a single capture-phase
// listener that catches ANY <img> load failure — whether the <img> came from
// React JSX or from HTML strings injected into Leaflet popups/divIcons — and
// adds the `img-broken` class so CSS can hide it cleanly.
//
// `error` events from <img> do NOT bubble, so we must listen in the capture
// phase on the document to catch them all from one place.
export function installImageFallback() {
  document.addEventListener(
    'error',
    (e) => {
      const el = e.target as HTMLElement | null
      if (!el || el.tagName !== 'IMG') return
      const img = el as HTMLImageElement
      if (img.dataset.broken) return // already handled
      img.dataset.broken = '1'
      img.classList.add('img-broken')
    },
    true,
  )
}
