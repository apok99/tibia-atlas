import { useTranslation } from 'react-i18next'

/**
 * Per-page SEO head management.
 *
 * React 19 hoists <title>, <meta> and <link> rendered anywhere in the tree
 * into <head> and de-dupes them, so a page just renders <Seo …/> and the
 * document head updates on navigation. This drives what Google (which runs
 * JS) and social/share unfurlers see; non-JS AI crawlers are served the
 * Laravel-rendered mirror instead (same data, same tags).
 */

export const SITE = {
  name: 'Tibia Atlas',
  url: 'https://tibiaatlas.com',
  twitter: '@tibiaatlas',
  // Absolute default share image (must be absolute for OG/Twitter unfurlers).
  ogImage: 'https://tibiaatlas.com/logo.png',
} as const

/** Build an absolute URL from a site-relative path. */
export function abs(path: string): string {
  if (!path) return SITE.url
  if (path.startsWith('http')) return path
  return SITE.url + (path.startsWith('/') ? path : '/' + path)
}

type JsonLd = Record<string, unknown>

interface SeoProps {
  /** Page title — combined as "Title · Tibia Atlas" (brand alone on home). */
  title?: string
  description?: string
  /** Site-relative canonical path, e.g. "/entry/demon". Defaults to current. */
  path?: string
  /** Absolute or site-relative share image. */
  image?: string
  /** og:type — "website" (default) or "article". */
  type?: 'website' | 'article'
  /** Keep this page out of the index (admin/search-result pages). */
  noindex?: boolean
  /** One or more JSON-LD structured-data blocks. */
  jsonLd?: JsonLd | JsonLd[]
}

export function Seo({ title, description, path, image, type = 'website', noindex, jsonLd }: SeoProps) {
  const { i18n } = useTranslation()
  const lang = (i18n.language || 'es').slice(0, 2)

  const fullTitle = title ? `${title} · ${SITE.name}` : `${SITE.name} — ${defaultTagline(lang)}`
  const desc = description || defaultDescription(lang)
  // The clean URL is the Spanish (default) variant; ?lang=en is the English
  // one. Each variant must be SELF-canonical or Google treats the EN URL as a
  // duplicate of the ES page and never indexes it — so the canonical follows
  // the ?lang= actually present in the address bar, while hreflang always
  // describes the full es/en cluster. Mirrored in crawler.blade.php.
  const canonicalPath = path ?? currentPath()
  const esUrl = abs(canonicalPath)
  const enUrl = withLang(esUrl, 'en')
  const urlLang = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('lang')
  const canonical = urlLang === 'en' ? enUrl : esUrl
  const ogImg = image ? abs(image) : SITE.ogImage
  const blocks = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : []

  return (
    <>
      <title>{fullTitle}</title>
      <meta name="description" content={desc} />
      <link rel="canonical" href={canonical} />
      {noindex && <meta name="robots" content="noindex, follow" />}

      {/* Bilingual alternates — the clean URL is Spanish, ?lang=en is English. */}
      <link rel="alternate" hrefLang="es" href={esUrl} />
      <link rel="alternate" hrefLang="en" href={enUrl} />
      <link rel="alternate" hrefLang="x-default" href={esUrl} />

      {/* Open Graph */}
      <meta property="og:site_name" content={SITE.name} />
      <meta property="og:title" content={title || SITE.name} />
      <meta property="og:description" content={desc} />
      <meta property="og:type" content={type} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={ogImg} />
      <meta property="og:locale" content={lang === 'es' ? 'es_ES' : 'en_US'} />

      {/* Twitter / X */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title || SITE.name} />
      <meta name="twitter:description" content={desc} />
      <meta name="twitter:image" content={ogImg} />
      <meta name="twitter:site" content={SITE.twitter} />

      {blocks.map((block, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(block)}
        </script>
      ))}
    </>
  )
}

function currentPath(): string {
  if (typeof window === 'undefined') return '/'
  return window.location.pathname + window.location.search
}

function withLang(url: string, lang: 'es' | 'en'): string {
  try {
    const u = new URL(url)
    u.searchParams.set('lang', lang)
    return u.toString()
  } catch {
    return url
  }
}

function defaultTagline(lang: string): string {
  // Home <title> is the single most important tag for the target query
  // ("tibia en español"), so it leads with the words people actually search.
  return lang === 'es'
    ? 'Mapa, bestiario y guía de Tibia en español'
    : 'Interactive map, bestiary and guide to Tibia'
}

function defaultDescription(lang: string): string {
  // Mirrored in PrerenderController::staticMeta ('') — edit both together.
  return lang === 'es'
    ? 'La guía de Tibia en español: mapa interactivo con dónde aparece cada criatura piso por piso, rutas entre ciudades, casas, bestiario, más de 4.000 items con precios y dónde venderlos, boss tracker y el lore de Tibia. Con juegos diarios.'
    : "The Tibia guide: an interactive map with every creature's spawns floor by floor, routes between cities, houses, a bestiary, 4,000+ items with prices and where to sell them, a live boss tracker and Tibia lore. Plus daily games."
}

// ── Type-aware, keyword-first SEO copy ────────────────────────────────────────
// Titles/descriptions lead with the words players actually search ("dónde
// aparece", "loot", "stats", "precio"). Kept in sync with the server-rendered
// mirror in backend/app/Http/Controllers/PrerenderController.php — edit both.

const TYPE_TITLE_SUFFIX: Record<string, { es: string; en: string }> = {
  creature: { es: 'dónde aparece, loot y stats', en: 'spawn, loot and stats' },
  npc: { es: 'NPC de Tibia: ubicación e historia', en: 'Tibia NPC: location and story' },
  character: { es: 'historia y lore en Tibia', en: 'story and lore in Tibia' },
  city: { es: 'guía de la ciudad de Tibia', en: 'guide to the Tibian city' },
  location: { es: 'el lugar en el mundo de Tibia', en: 'the place in the world of Tibia' },
  organization: { es: 'la organización en el lore de Tibia', en: 'the organization in Tibia lore' },
  quest: { es: 'guía de la misión de Tibia', en: 'Tibia quest guide' },
  event: { es: 'en la historia de Tibia', en: "in Tibia's history" },
  item: { es: 'precio, quién lo suelta y dónde venderlo', en: 'price, droppers and where to sell it' },
  concept: { es: 'en el lore de Tibia', en: 'in Tibia lore' },
}

/** Keyword-rich page title for a lore entry (site suffix added by <Seo>). */
export function entrySeoTitle(name: string, type: string, lang: string): string {
  const s = TYPE_TITLE_SUFFIX[type]
  const suffix = s ? (lang === 'es' ? s.es : s.en) : ''
  return suffix ? `${name}: ${suffix}` : name
}

/** Trim/clean to a ~160-char meta description, keeping whole words. */
function clampDesc(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return clean.slice(0, max - 1).replace(/\s+\S*$/, '') + '…'
}

/**
 * Keyword-rich meta description for a lore entry. For creatures with a known
 * spawn, it leads with "aparece en …" (matching "dónde aparece X" searches)
 * then folds in the lore; everything else just uses the lore excerpt.
 */
export function entrySeoDescription(opts: {
  name: string
  type: string
  lang: string
  lead?: string | null
  location?: string | null
}): string {
  const { name, type, lang, lead, location } = opts
  const es = lang === 'es'
  let prefix = ''
  if (type === 'creature' && location) {
    prefix = es ? `${name} en Tibia: aparece en ${location}.` : `${name} in Tibia: spawns in ${location}.`
  }
  const body = [prefix, (lead ?? '').trim()].filter(Boolean).join(' ')
  if (body) return clampDesc(body)
  // Last-resort fallback so no entry ships an empty description.
  return es ? `${name} en el atlas de Tibia en español.` : `${name} in the Tibia atlas.`
}

// ── JSON-LD builders ────────────────────────────────────────────────────────

/** Site-wide WebSite node with the sitelinks search box action. */
export function websiteJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE.name,
    // Names people actually type — helps search engines tie those queries to
    // the site and surface it as an answer for "wiki/guía/mapa de Tibia".
    alternateName: ['Atlas de Tibia', 'Wiki de Tibia en español', 'Guía de Tibia en español', 'Mapa de Tibia'],
    description: 'La guía de Tibia en español: mapa interactivo, bestiario, loot, items y lore.',
    url: SITE.url,
    inLanguage: ['es', 'en'],
    about: { '@id': `${SITE.url}/#tibia` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE.url}/browse?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  }
}

/** Publisher/Organization node. */
export function organizationJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE.url}/#org`,
    name: SITE.name,
    url: SITE.url,
    logo: SITE.ogImage,
  }
}

/**
 * The game itself, as a knowledge-graph anchor. Ties every page to the Tibia
 * (CipSoft, 1997) entity so engines never confuse the site with the bone or
 * the flute. Full node on the home page; articles reference it via `about`.
 */
export function tibiaGameJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    '@id': `${SITE.url}/#tibia`,
    name: 'Tibia',
    url: 'https://www.tibia.com',
    sameAs: ['https://en.wikipedia.org/wiki/Tibia_(video_game)', 'https://www.wikidata.org/wiki/Q616401'],
    author: { '@type': 'Organization', name: 'CipSoft GmbH', url: 'https://www.cipsoft.com' },
    publisher: { '@type': 'Organization', name: 'CipSoft GmbH' },
    genre: 'MMORPG',
    gamePlatform: ['PC'],
    playMode: 'MultiPlayer',
    datePublished: '1997-01-07',
    operatingSystem: ['Windows', 'Linux', 'macOS'],
    applicationCategory: 'Game',
  }
}

/** Compact `about` reference to the Tibia VideoGame entity, for article nodes. */
export function tibiaGameRef(): JsonLd {
  return {
    '@type': 'VideoGame',
    name: 'Tibia',
    url: 'https://www.tibia.com',
    sameAs: ['https://en.wikipedia.org/wiki/Tibia_(video_game)', 'https://www.wikidata.org/wiki/Q616401'],
  }
}

/** BreadcrumbList from an ordered list of {name, path} crumbs. */
export function breadcrumbJsonLd(crumbs: { name: string; path: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: abs(c.path),
    })),
  }
}

/** Article node for a lore entry. */
export function articleJsonLd(opts: {
  headline: string
  description: string
  path: string
  image?: string | null
  datePublished?: string | null
  dateModified?: string | null
  lang: string
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: opts.headline,
    description: opts.description,
    inLanguage: opts.lang,
    mainEntityOfPage: abs(opts.path),
    image: opts.image ? abs(opts.image) : SITE.ogImage,
    datePublished: opts.datePublished || undefined,
    dateModified: opts.dateModified || opts.datePublished || undefined,
    author: { '@type': 'Organization', name: SITE.name },
    publisher: organizationJsonLd(),
    about: tibiaGameRef(),
  }
}

/** ItemList of the entries visible on a listing page (positions + URLs). */
export function itemListJsonLd(items: { name: string; path: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      url: abs(it.path),
    })),
  }
}

/** CollectionPage node for a listing page. */
export function collectionJsonLd(opts: { name: string; description: string; path: string }): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: opts.name,
    description: opts.description,
    url: abs(opts.path),
    isPartOf: { '@type': 'WebSite', name: SITE.name, url: SITE.url },
  }
}
