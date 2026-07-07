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
  // Canonical is the clean, language-agnostic URL; hreflang points at the
  // ?lang= variants so each language is independently indexable.
  const canonicalPath = path ?? currentPath()
  const canonical = abs(canonicalPath)
  const ogImg = image ? abs(image) : SITE.ogImage
  const blocks = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : []

  return (
    <>
      <title>{fullTitle}</title>
      <meta name="description" content={desc} />
      <link rel="canonical" href={canonical} />
      {noindex && <meta name="robots" content="noindex, follow" />}

      {/* Bilingual alternates — one URL per language plus an x-default. */}
      <link rel="alternate" hrefLang="es" href={withLang(canonical, 'es')} />
      <link rel="alternate" hrefLang="en" href={withLang(canonical, 'en')} />
      <link rel="alternate" hrefLang="x-default" href={canonical} />

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
  return lang === 'es'
    ? 'La guía de Tibia en español: mapa interactivo con dónde aparece cada criatura piso por piso, rutas entre ciudades, bestiario, loot, precios de items y el lore de Tibia. Con wordle diario.'
    : 'The interactive map of Tibia: find where every creature spawns floor by floor, chart routes between cities and explore the world. Plus a daily wordle, a bestiary and Tibia lore in Spanish and English.'
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
  item: { es: 'stats, precio y quién lo suelta', en: 'stats, price and droppers' },
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
    name: SITE.name,
    url: SITE.url,
    logo: SITE.ogImage,
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
