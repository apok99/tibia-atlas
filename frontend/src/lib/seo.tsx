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
  return lang === 'es' ? 'El atlas viviente del mundo de Tibia' : 'The living atlas of the Tibian world'
}

function defaultDescription(lang: string): string {
  return lang === 'es'
    ? 'El mapa interactivo de Tibia: encuentra dónde aparece cada criatura piso por piso, traza rutas entre ciudades y explora el mundo. Con wordle diario, bestiario y el lore de Tibia en español e inglés.'
    : 'The interactive map of Tibia: find where every creature spawns floor by floor, chart routes between cities and explore the world. Plus a daily wordle, a bestiary and Tibia lore in Spanish and English.'
}

// ── JSON-LD builders ────────────────────────────────────────────────────────

/** Site-wide WebSite node with the sitelinks search box action. */
export function websiteJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE.name,
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
