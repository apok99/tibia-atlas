import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { Entry, EntryContent, EntryStatus, EntryType, Locale, SourceType } from '../../types'

const ENTRY_TYPES: EntryType[] = [
  'creature', 'character', 'city', 'location', 'organization', 'quest', 'event', 'item', 'concept',
]
const STATUSES: EntryStatus[] = ['draft', 'in_review', 'published']
const SOURCE_TYPES: SourceType[] = [
  'official_article', 'cipsoft_publication', 'tibia_wiki', 'internet', 'other',
]
const SECTIONS = ['overview', 'canon', 'interpretations', 'theories', 'research_gaps'] as const

interface TranslationForm {
  locale: Locale
  name: string
  overview: string
  canon: string
  interpretations: string
  theories: string
  research_gaps: string
}

interface SourceForm {
  type: SourceType
  title: string
  url: string
  note: string
}

const emptyTranslation = (locale: Locale): TranslationForm => ({
  locale,
  name: '',
  overview: '',
  canon: '',
  interpretations: '',
  theories: '',
  research_gaps: '',
})

export function AdminEntryEditor() {
  const { id } = useParams<{ id: string }>()
  const isEdit = id && id !== 'new'
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [type, setType] = useState<EntryType>('creature')
  const [status, setStatus] = useState<EntryStatus>('draft')
  const [featured, setFeatured] = useState(false)
  const [activeLocale, setActiveLocale] = useState<Locale>('es')
  const [translations, setTranslations] = useState<Record<Locale, TranslationForm>>({
    es: emptyTranslation('es'),
    en: emptyTranslation('en'),
  })
  const [sources, setSources] = useState<SourceForm[]>([])
  const [saving, setSaving] = useState(false)

  // For edit mode, fetch both locales so the editor holds the full bilingual record.
  useEffect(() => {
    if (!isEdit) return
    Promise.all([
      api.get<{ data: Entry }>(`/admin/entries/${id}`, { params: { lang: 'es' } }),
      api.get<{ data: Entry }>(`/admin/entries/${id}`, { params: { lang: 'en' } }),
    ]).then(([es, en]) => {
      const base = es.data.data
      setType(base.type)
      setStatus(base.status)
      setFeatured(base.featured)
      setSources(
        base.sources.map((s) => ({
          type: s.type,
          title: s.title,
          url: s.url ?? '',
          note: s.note ?? '',
        })),
      )
      setTranslations({
        es: { ...emptyTranslation('es'), name: es.data.data.name ?? '', ...stripNulls(es.data.data.content), locale: 'es' },
        en: { ...emptyTranslation('en'), name: en.data.data.name ?? '', ...stripNulls(en.data.data.content), locale: 'en' },
      })
    })
  }, [id, isEdit])

  const updateField = (field: keyof TranslationForm, value: string) => {
    setTranslations((prev) => ({
      ...prev,
      [activeLocale]: { ...prev[activeLocale], [field]: value },
    }))
  }

  const save = async () => {
    setSaving(true)
    // Only submit locales that have at least a name.
    const payloadTranslations = (['es', 'en'] as Locale[])
      .map((l) => translations[l])
      .filter((tr) => tr.name.trim() !== '')

    const payload = {
      type,
      status,
      featured,
      translations: payloadTranslations,
      sources: sources.filter((s) => s.title.trim() !== ''),
    }

    try {
      if (isEdit) {
        await api.put(`/admin/entries/${id}`, payload)
      } else {
        await api.post('/admin/entries', payload)
      }
      qc.invalidateQueries({ queryKey: ['admin-entries'] })
      navigate('/admin/entries')
    } finally {
      setSaving(false)
    }
  }

  const tr = translations[activeLocale]

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value as EntryType)} className={selectClass}>
            {ENTRY_TYPES.map((tp) => (
              <option key={tp} value={tp}>{t(`types.${tp}`)}</option>
            ))}
          </select>
        </Field>
        <Field label={t('admin.status')}>
          <select value={status} onChange={(e) => setStatus(e.target.value as EntryStatus)} className={selectClass}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Featured">
          <label className="flex items-center gap-2 py-2 text-sm text-atlas-muted">
            <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
            ★ Featured
          </label>
        </Field>
      </div>

      <div className="flex gap-2">
        {(['es', 'en'] as Locale[]).map((l) => (
          <button
            key={l}
            onClick={() => setActiveLocale(l)}
            className={`rounded-md px-4 py-1.5 text-sm font-semibold ${
              activeLocale === l ? 'bg-atlas-gold text-stone-950' : 'border border-atlas-border text-atlas-muted'
            }`}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      <Field label="Name">
        <input value={tr.name} onChange={(e) => updateField('name', e.target.value)} className={inputClass} />
      </Field>

      {SECTIONS.map((section) => (
        <Field key={section} label={t(`entry.${section === 'research_gaps' ? 'researchGaps' : section}`)}>
          <textarea
            value={tr[section]}
            onChange={(e) => updateField(section, e.target.value)}
            rows={section === 'overview' ? 3 : 5}
            className={`${inputClass} resize-y`}
          />
        </Field>
      ))}

      <div className="rounded-lg border border-atlas-border bg-atlas-panel/40 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-lg text-atlas-gold">{t('entry.sources')}</h3>
          <button
            onClick={() => setSources((s) => [...s, { type: 'tibia_wiki', title: '', url: '', note: '' }])}
            className="rounded-md border border-atlas-border px-3 py-1 text-sm text-atlas-muted hover:text-atlas-ink"
          >
            + Source
          </button>
        </div>
        <div className="space-y-3">
          {sources.map((s, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[10rem_1fr_1fr_auto]">
              <select
                value={s.type}
                onChange={(e) => setSources((arr) => arr.map((x, j) => (j === i ? { ...x, type: e.target.value as SourceType } : x)))}
                className={selectClass}
              >
                {SOURCE_TYPES.map((st) => (
                  <option key={st} value={st}>{t(`sourceType.${st}`)}</option>
                ))}
              </select>
              <input
                placeholder="Title"
                value={s.title}
                onChange={(e) => setSources((arr) => arr.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                className={inputClass}
              />
              <input
                placeholder="URL"
                value={s.url}
                onChange={(e) => setSources((arr) => arr.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                className={inputClass}
              />
              <button
                onClick={() => setSources((arr) => arr.filter((_, j) => j !== i))}
                className="rounded-md border border-atlas-border px-3 text-rose-400"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="rounded-md bg-atlas-gold px-6 py-2.5 font-semibold text-stone-950 transition hover:bg-atlas-gold-bright disabled:opacity-60"
      >
        {saving ? t('common.loading') : t('admin.save')}
      </button>
    </div>
  )
}

const inputClass =
  'w-full rounded-md border border-atlas-border bg-atlas-bg px-3 py-2 text-sm outline-none focus:border-atlas-gold/60'
const selectClass = inputClass

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm text-atlas-muted">{label}</label>
      {children}
    </div>
  )
}

/** Replace null section values with empty strings for controlled inputs. */
function stripNulls(content: EntryContent): Record<string, string> {
  return Object.fromEntries(Object.entries(content).map(([k, v]) => [k, v ?? '']))
}
