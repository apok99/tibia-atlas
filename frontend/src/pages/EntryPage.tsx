import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useEntry } from '../hooks/useEntries'
import { EntryCard } from '../components/EntryCard'
import { EntryPageSkeleton } from '../components/Skeleton'
import { RecommendedReading } from '../components/RecommendedReading'
import { TypeIcon } from '../components/TypeIcon'
import { LoreText } from '../components/LoreText'
import { CreatureKillStats } from '../components/CreatureKillStats'
import { DamageAffinity } from '../components/DamageAffinity'
import { BossRespawn } from '../components/BossRespawn'
import { Lightbox } from '../components/Lightbox'
import { Seo, articleJsonLd, breadcrumbJsonLd } from '../lib/seo'
import { useState } from 'react'
import type { EntryListItem } from '../types'

/** Trim a lore paragraph into a clean ~160-char meta description. */
function metaExcerpt(text: string | null | undefined, max = 160): string {
  if (!text) return ''
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return clean.slice(0, max - 1).replace(/\s+\S*$/, '') + '…'
}

export function EntryPage() {
  const { slug } = useParams<{ slug: string }>()
  const { t, i18n } = useTranslation()
  const { data: entry, isLoading, isError } = useEntry(slug)
  const [zoomed, setZoomed] = useState(false)

  if (isLoading) return <EntryPageSkeleton />
  if (isError || !entry) return <p className="text-fg-mute">{t('common.error')}</p>

  const uiLang = i18n.language?.slice(0, 2)
  const langMismatch = entry.locale && entry.locale !== uiLang

  // The lead lore paragraph: the overview, or canon as a fallback.
  const lead = entry.content.overview || entry.content.canon
  // Show canon as body text only when the overview already provided the lead,
  // so it isn't duplicated. Titles for canon/interpretations are intentionally omitted.
  const canonBody = entry.content.overview ? entry.content.canon : null

  const related = entry.related ?? []
  const creatures = related.filter((r) => r.type === 'creature')
  const npcs = related.filter((r) => r.type === 'character')
  const others = related.filter((r) => r.type !== 'creature' && r.type !== 'character')

  // Internal bookkeeping fields that must never appear in the stat block.
  // immune_to / weak_to get their own visual DamageAffinity panel below.
  const hiddenMeta = ['imported_from', 'wiki_pageid', 'auto_stub', 'artwork', 'note', 'character_kind', 'location', 'importance_rank', 'immune_to', 'weak_to']
  const metaEntries = Object.entries(entry.meta ?? {}).filter(
    ([k, v]) => !hiddenMeta.includes(k) && v !== null && v !== '' && typeof v !== 'object',
  )
  const artwork = typeof entry.meta?.artwork === 'string' ? entry.meta.artwork : null
  // Textual spawn locations from TibiaWiki ("Plains of Havoc, Hellgate, …").
  const location = typeof entry.meta?.location === 'string' ? entry.meta.location : null

  const seoDesc = metaExcerpt(lead || entry.content.canon)
  const browsePath = `/browse/${entry.type}`

  return (
    <div className="space-y-6">
      <Seo
        title={entry.name ?? entry.slug}
        description={seoDesc}
        path={`/entry/${entry.slug}`}
        image={entry.primary_image}
        type="article"
        jsonLd={[
          articleJsonLd({
            headline: entry.name ?? entry.slug ?? '',
            description: seoDesc,
            path: `/entry/${entry.slug}`,
            image: entry.primary_image,
            datePublished: entry.published_at,
            dateModified: entry.updated_at,
            lang: uiLang || 'es',
          }),
          breadcrumbJsonLd([
            { name: 'Tibia Atlas', path: '/' },
            { name: entry.type_label, path: browsePath },
            { name: entry.name ?? entry.slug ?? '', path: `/entry/${entry.slug}` },
          ]),
        ]}
      />
      <Link
        to="/"
        className="text-xs font-bold uppercase tracking-wider text-fg-mute transition hover:text-fg"
      >
        ← {t('entry.backToBrowse')}
      </Link>

      {/* Hero */}
      <header className="panel overflow-hidden">
        <div className="flex flex-col gap-6 p-6 sm:flex-row">
          <div className="sprite-tile mx-auto grid h-40 w-40 shrink-0 place-items-center rounded border border-line sm:mx-0">
            {entry.primary_image ? (
              <img
                src={entry.primary_image}
                alt={entry.name ?? ''}
                className="sprite max-h-32 max-w-32 object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.8)]"
              />
            ) : (
              <TypeIcon type={entry.type} className="h-16 w-16 text-fg-mute" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-accent">
              <TypeIcon type={entry.type} className="h-3.5 w-3.5" />
              <span className="text-[11px] font-bold uppercase tracking-[0.18em]">
                {entry.type_label}
              </span>
            </div>
            <h1 className="mt-1 text-4xl font-black tracking-tight text-fg">{entry.name}</h1>

            {entry.type === 'creature' && entry.slug && (
              <Link
                to={`/map#c=${entry.slug}`}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-accent transition hover:bg-accent hover:text-white"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3z" />
                  <path d="M9 3v15M15 6v15" />
                </svg>
                {t('entry.openMap')}
              </Link>
            )}

            {entry.type === 'creature' && location && (
              <p className="mt-3 text-sm leading-relaxed text-fg-dim">
                <span className="mr-1.5 inline-flex items-center gap-1 align-middle text-[11px] font-bold uppercase tracking-wider text-accent">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  {t('entry.foundIn')}:
                </span>
                <LoreText text={location} currentSlug={entry.slug} />
              </p>
            )}

            {lead && (
              <p className="mt-3 leading-relaxed text-fg-dim">
                <LoreText text={lead} currentSlug={entry.slug} />
              </p>
            )}

            {langMismatch && (
              <p className="mt-3 rounded border border-theory/40 bg-theory/10 px-3 py-2 text-xs text-theory">
                {t('entry.notAvailableInLang', {
                  lang: uiLang?.toUpperCase(),
                  shown: entry.locale?.toUpperCase(),
                })}
              </p>
            )}
          </div>
        </div>

        {/* Stat block — bestiary-style infobox built from meta. */}
        {metaEntries.length > 0 && (
          <dl className="grid grid-cols-2 border-t border-line sm:grid-cols-3 lg:grid-cols-4">
            {metaEntries.map(([k, v]) => (
              <div key={k} className="border-b border-r border-line px-4 py-3">
                <dt className="text-[10px] font-bold uppercase tracking-wider text-fg-mute">
                  {t(`stat.${k}`, { defaultValue: k.replace(/_/g, ' ') })}
                </dt>
                <dd className="mt-0.5 font-mono text-base font-semibold tabular-nums text-fg">
                  {typeof v === 'number' ? v.toLocaleString() : String(v)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_19rem]">
        <div className="space-y-5">
          {canonBody && (
            <div className="panel p-5">
              <div className="prose-atlas">
                <LoreText text={canonBody} currentSlug={entry.slug} />
              </div>
            </div>
          )}
          {entry.content.interpretations && (
            <div className="panel p-5">
              <div className="prose-atlas">
                <LoreText text={entry.content.interpretations} currentSlug={entry.slug} />
              </div>
            </div>
          )}

          {entry.type === 'creature' && <DamageAffinity meta={entry.meta} />}

          {entry.type === 'creature' && entry.slug && (
            <CreatureKillStats slug={entry.slug} />
          )}
          {entry.type === 'creature' && entry.slug && entry.meta?.rank === 'Boss' && (
            <BossRespawn slug={entry.slug} />
          )}

          {artwork && (
            <figure className="panel overflow-hidden">
              <button
                type="button"
                onClick={() => setZoomed(true)}
                className="group relative block w-full cursor-zoom-in"
                title={t('entry.zoomHint')}
              >
                <img
                  src={artwork}
                  alt={`${entry.name} — artwork`}
                  className="max-h-[28rem] w-full bg-bg object-contain transition group-hover:opacity-95"
                  loading="lazy"
                />
                <span className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded border border-white/20 bg-black/55 text-white opacity-0 transition group-hover:opacity-100">
                  ⤢
                </span>
              </button>
              <figcaption className="border-t border-line px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-fg-mute">
                {t('entry.artwork')}
              </figcaption>
            </figure>
          )}
          {artwork && zoomed && (
            <Lightbox
              src={artwork}
              alt={`${entry.name} — ${t('entry.artwork')}`}
              caption={`${entry.name} · ${t('entry.artwork')}`}
              onClose={() => setZoomed(false)}
            />
          )}

          <section className="panel overflow-hidden">
            <header className="flex items-center gap-3 border-b border-line px-4 py-3">
              <span className="h-3.5 w-1 rounded-full bg-accent" />
              <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-fg">{t('entry.sources')}</h2>
            </header>
            <div className="p-4">
              {entry.sources.length > 0 ? (
                <ul className="space-y-2 text-sm">
                  {entry.sources.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-2">
                      <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-fg-mute">
                        {t(`sourceType.${s.type}`)}
                      </span>
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer" className="text-accent-2 underline-offset-2 hover:underline">
                          {s.title}
                        </a>
                      ) : (
                        <span className="text-fg-dim">{s.title}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm italic text-fg-mute">{t('entry.sectionEmpty')}</p>
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <RelatedGroup title={t('entry.relatedCreatures')} items={creatures} />
          <RelatedGroup title={t('entry.relatedNpcs')} items={npcs} />
          <RelatedGroup title={t('entry.relatedOther')} items={others} />
          <RecommendedReading excludeSlug={entry.slug} />
        </aside>
      </div>
    </div>
  )
}

function RelatedGroup({ title, items }: { title: string; items: EntryListItem[] }) {
  if (items.length === 0) return null
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-fg-mute">
        <span className="h-px flex-1 bg-line" />
        {title}
        <span className="h-px flex-1 bg-line" />
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {items.map((r) => (
          <EntryCard key={r.id} entry={r} />
        ))}
      </div>
    </section>
  )
}
