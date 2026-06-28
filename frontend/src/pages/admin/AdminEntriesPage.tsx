import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { Skeleton } from '../../components/Skeleton'
import type { EntryListItem, Paginated } from '../../types'

const statusColor: Record<string, string> = {
  published: 'text-emerald-400',
  in_review: 'text-amber-400',
  draft: 'text-atlas-muted',
}

export function AdminEntriesPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [importTitle, setImportTitle] = useState('')
  const [batchSize, setBatchSize] = useState(0)
  const [msg, setMsg] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-entries'],
    queryFn: async () => {
      const { data } = await api.get<Paginated<EntryListItem>>('/admin/entries')
      return data
    },
  })

  const refresh = (m: string) => {
    setMsg(m)
    qc.invalidateQueries({ queryKey: ['admin-entries'] })
  }

  const importMutation = useMutation({
    mutationFn: async (title: string) =>
      (await api.post('/admin/import/tibiawiki', { title })).data,
    onSuccess: (res) => {
      refresh(res.message)
      setImportTitle('')
    },
    onError: () => setMsg(t('common.error')),
  })

  const scrapeMutation = useMutation({
    mutationFn: async () => (await api.post('/admin/scrape/creatures', { limit: batchSize })).data,
    onSuccess: (res) => refresh(res.message),
    onError: () => setMsg(t('common.error')),
  })

  const publishMutation = useMutation({
    mutationFn: async () => (await api.post('/admin/publish-drafts')).data,
    onSuccess: (res) => refresh(res.message),
    onError: () => setMsg(t('common.error')),
  })

  const busy = importMutation.isPending || scrapeMutation.isPending || publishMutation.isPending

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Single page import */}
        <div className="rounded-lg border border-atlas-border bg-atlas-panel/40 p-4">
          <h2 className="mb-2 font-display text-lg text-atlas-gold">{t('admin.import')}</h2>
          <div className="flex flex-wrap gap-2">
            <input
              value={importTitle}
              onChange={(e) => setImportTitle(e.target.value)}
              placeholder="e.g. Demon, Thais, Ferumbras"
              className="flex-1 rounded-md border border-atlas-border bg-atlas-bg px-3 py-2 text-sm outline-none focus:border-atlas-gold/60"
            />
            <button
              onClick={() => importMutation.mutate(importTitle)}
              disabled={!importTitle || busy}
              className="rounded-md bg-atlas-gold px-4 py-2 text-sm font-semibold text-stone-950 disabled:opacity-60"
            >
              {importMutation.isPending ? t('common.loading') : t('admin.import')}
            </button>
          </div>
        </div>

        {/* Bulk tools */}
        <div className="rounded-lg border border-atlas-border bg-atlas-panel/40 p-4">
          <h2 className="mb-2 font-display text-lg text-atlas-gold">{t('admin.bulkTools')}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={0}
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              title="0 = full roster"
              className="w-20 rounded-md border border-atlas-border bg-atlas-bg px-3 py-2 text-sm outline-none focus:border-atlas-gold/60"
            />
            <button
              onClick={() => scrapeMutation.mutate()}
              disabled={busy}
              className="rounded-md bg-atlas-gold px-4 py-2 text-sm font-semibold text-stone-950 disabled:opacity-60"
            >
              {scrapeMutation.isPending ? t('common.loading') : t('admin.scrapeCreatures')}
            </button>
            <button
              onClick={() => publishMutation.mutate()}
              disabled={busy}
              className="rounded-md border border-emerald-600/50 px-4 py-2 text-sm font-semibold text-emerald-400 hover:bg-emerald-600/10 disabled:opacity-60"
            >
              {publishMutation.isPending ? t('common.loading') : t('admin.publishDrafts')}
            </button>
          </div>
          <p className="mt-2 text-xs text-atlas-muted">{t('admin.bulkHint')}</p>
        </div>
      </div>

      {msg && (
        <p className="rounded-md border border-atlas-border bg-atlas-panel/40 px-3 py-2 text-sm text-atlas-gold-bright">
          {msg}
        </p>
      )}

      {isLoading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-atlas-border text-left text-xs uppercase tracking-wide text-atlas-muted">
              <th className="py-2">{t('admin.entries')}</th>
              <th className="py-2">Type</th>
              <th className="py-2">Langs</th>
              <th className="py-2">{t('admin.status')}</th>
              <th className="py-2">{t('admin.reviewed')}</th>
            </tr>
          </thead>
          <tbody>
            {data?.data.map((e) => (
              <tr key={e.id} className="border-b border-atlas-border/50 hover:bg-atlas-panel/40">
                <td className="py-2">
                  <Link to={`/admin/entries/${e.id}`} className="text-atlas-gold hover:underline">
                    {e.name ?? e.slug}
                  </Link>
                </td>
                <td className="py-2 text-atlas-muted">{t(`types.${e.type}`)}</td>
                <td className="py-2">
                  {(['es', 'en'] as const).map((l) => (
                    <span
                      key={l}
                      className={`mr-1 text-[10px] font-bold uppercase ${
                        e.available_locales?.includes(l) ? 'text-emerald-400' : 'text-atlas-border'
                      }`}
                    >
                      {l}
                    </span>
                  ))}
                </td>
                <td className={`py-2 font-medium ${statusColor[e.status] ?? ''}`}>{e.status}</td>
                <td className="py-2">
                  {e.reviewed ? (
                    <span className="text-emerald-400" title={e.reviewed_at ?? ''}>✓</span>
                  ) : (
                    <span className="text-atlas-border">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
