import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { parseAnalyzer } from '../lib/huntAnalyzer'
import { bankCommands, byPayer, splitParty, type Extra } from '../lib/partySplit'

const gp = (n: number) => Math.round(n).toLocaleString()

/** Copy button that confirms itself for a couple of seconds. */
function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [ok, setOk] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setOk(true)
            if (timer.current) window.clearTimeout(timer.current)
            timer.current = window.setTimeout(() => setOk(false), 2000)
          },
          () => {
            /* clipboard denied — the commands are on screen to copy by hand */
          },
        )
      }}
      className={`flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
        ok ? 'border-canon bg-canon/10 text-canon' : 'border-line-2 text-fg-mute hover:border-accent hover:text-accent'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {ok ? <path d="M20 6 9 17l-5-5" /> : <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>}
      </svg>
      {ok ? done : label}
    </button>
  )
}

/**
 * Party settle-up panel: paste a Party Hunt Analyzer, get what each member owes
 * or is owed once loot and supplies are shared evenly, plus the literal banker
 * commands to pay it. Opens on top of the profit tool as its own small modal.
 */
export default function PartySplitTool({
  open,
  onClose,
  initialText,
  meName,
}: {
  open: boolean
  onClose: () => void
  /** The profit tool's own paste — seeded in when it already holds a party. */
  initialText: string
  /** Which member is the player, so their row and payments come first. */
  meName: string | null
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const seeded = useRef(false)

  // Seed from the main paste the first time it opens on a party analyzer —
  // re-typing the same wall of text would be absurd. Editing here never touches
  // the profit calculation.
  useEffect(() => {
    if (!open) {
      seeded.current = false
      return
    }
    if (seeded.current) return
    seeded.current = true
    if (!text.trim() && parseAnalyzer(initialText).members.length > 1) setText(initialText)
  }, [open, initialText, text])

  // Esc closes only this panel; the profit card behind it stays open (it skips
  // its own Esc handler while this is up).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const members = useMemo(() => parseAnalyzer(text).members, [text])

  // Costs the analyzer never saw, each with who fronted it and who bears it.
  const [extras, setExtras] = useState<Extra[]>([])
  const nextId = useRef(0)
  const addExtra = () =>
    setExtras((xs) => [
      ...xs,
      { id: `x${++nextId.current}`, concept: '', amount: 0, paidBy: members[0]?.name ?? '', chargedTo: '' },
    ])
  const patchExtra = (id: string, patch: Partial<Extra>) =>
    setExtras((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const dropExtra = (id: string) => setExtras((xs) => xs.filter((x) => x.id !== id))

  const split = useMemo(() => splitParty(members, extras), [members, extras])
  const payers = useMemo(() => byPayer(split.transfers), [split.transfers])
  const anyExtras = split.rows.some((r) => r.paid > 0 || r.charged > 0)

  // You first: your own row and your own commands are what you came for.
  const rows = useMemo(() => {
    if (!meName) return split.rows
    return [...split.rows].sort((a, b) => Number(b.name === meName) - Number(a.name === meName))
  }, [split.rows, meName])
  const payerBlocks = useMemo(() => {
    if (!meName) return payers
    return [...payers].sort((a, b) => Number(b.name === meName) - Number(a.name === meName))
  }, [payers, meName])

  const allCommands = payerBlocks
    .map((p) => `${p.name}:\n${bankCommands(p.out).join('\n')}`)
    .join('\n\n')

  if (!open) return null

  const ready = members.length > 1

  return createPortal(
    <div className="fixed inset-0 z-[1010] flex items-center justify-center bg-black/60 px-3 py-4 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-[44rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border-2 border-accent/60 bg-bg-2 p-3.5 shadow-2xl"
      >
        <div className="mb-2 flex shrink-0 items-center gap-1.5 text-accent">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" />
          </svg>
          <span className="text-xs font-bold uppercase tracking-widest">{t('map.psTitle')}</span>
          <button
            onClick={onClose}
            aria-label={t('map.psTitle')}
            className="ml-auto grid h-6 w-6 place-items-center rounded-md border border-line-2 text-fg-mute transition hover:border-accent hover:text-accent"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="scroll-atlas min-h-0 flex-1 overflow-y-auto pr-0.5">
          <p className="mb-2 text-sm text-fg-dim">{t('map.psHint')}</p>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('map.psPaste')}
            spellCheck={false}
            rows={ready ? 2 : 4}
            className="w-full resize-y rounded-lg border border-line bg-bg-2 px-2.5 py-2 font-mono text-xs leading-relaxed outline-none transition placeholder:font-sans placeholder:text-sm placeholder:text-fg-mute focus:border-accent"
          />

          {!ready ? (
            <p className="mt-2 text-sm text-fg-mute">{t('map.psNeedParty')}</p>
          ) : (
            <>
              {/* Headline: what the party made and what each member walks with */}
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {[
                  { label: t('map.psTotal'), value: gp(split.total), tone: split.total >= 0 ? 'text-canon' : 'text-accent', note: '' },
                  { label: t('map.hpPlayers'), value: String(split.players), tone: 'text-fg', note: '' },
                  {
                    label: t('map.psFair'),
                    value: gp(split.fair),
                    tone: split.fair >= 0 ? 'text-canon' : 'text-accent',
                    // Shared extras come off the pot before it is divided, so
                    // say so rather than let the number look wrong.
                    note: split.shared > 0 ? t('map.psFairNote', { gp: gp(split.shared) }) : '',
                  },
                ].map((tile) => (
                  <div key={tile.label} className="rounded-lg border border-line bg-bg-2 px-2 py-1.5 text-center">
                    <div className={`text-base font-bold leading-tight ${tile.tone}`}>{tile.value}</div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-fg-mute">{tile.label}</div>
                    {tile.note && <div className="text-[9px] leading-tight text-fg-mute">{tile.note}</div>}
                  </div>
                ))}
              </div>

              {/* Costs the analyzer never sees — someone fronts them, and they
                  are either the party's or one player's. */}
              <div className="mt-2 rounded-xl border border-line bg-bg-2 p-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-widest text-fg-dim">
                    {t('map.psExtras')}
                    {split.shared > 0 && (
                      <span className="ml-1.5 font-normal normal-case tracking-normal text-fg-mute">
                        {t('map.psExtraShared', { gp: gp(split.shared) })}
                      </span>
                    )}
                  </span>
                  <button
                    onClick={addExtra}
                    className="flex shrink-0 items-center gap-1 rounded-lg border border-line-2 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-fg-mute transition hover:border-accent hover:text-accent"
                  >
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    {t('map.psExtraAdd')}
                  </button>
                </div>
                {extras.length === 0 ? (
                  <p className="text-xs text-fg-mute">{t('map.psExtraEmpty')}</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {extras.map((x) => (
                      <div key={x.id} className="flex flex-wrap items-center gap-1.5">
                        <input
                          value={x.concept}
                          onChange={(e) => patchExtra(x.id, { concept: e.target.value })}
                          placeholder={t('map.psExtraConcept')}
                          className="h-8 min-w-0 flex-1 basis-32 rounded-lg border border-line bg-bg-2 px-2 text-sm outline-none transition placeholder:text-fg-mute focus:border-accent"
                        />
                        <input
                          type="number"
                          value={x.amount === 0 ? '' : String(x.amount)}
                          min={0}
                          step={1000}
                          onChange={(e) => patchExtra(x.id, { amount: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                          placeholder={t('map.psExtraAmount')}
                          aria-label={t('map.psExtraAmount')}
                          className="h-8 w-24 shrink-0 rounded-lg border border-line bg-bg-2 px-2 text-right text-sm font-semibold tabular-nums outline-none transition focus:border-accent"
                        />
                        {/* Who put the gold up front — they get made whole. */}
                        <select
                          value={x.paidBy}
                          onChange={(e) => patchExtra(x.id, { paidBy: e.target.value })}
                          aria-label={t('map.psExtraPaidBy')}
                          title={t('map.psExtraPaidBy')}
                          className="h-8 w-32 shrink-0 rounded-lg border border-line bg-bg-2 px-1.5 text-xs font-semibold outline-none transition focus:border-accent"
                        >
                          <option value="">{t('map.psExtraPaidBy')}…</option>
                          {members.map((m) => (
                            <option key={m.name} value={m.name}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        {/* Who bears it: the party splits it, or one player eats it. */}
                        <select
                          value={x.chargedTo}
                          onChange={(e) => patchExtra(x.id, { chargedTo: e.target.value })}
                          aria-label={t('map.psExtraChargedTo')}
                          title={t('map.psExtraChargedTo')}
                          className="h-8 w-32 shrink-0 rounded-lg border border-line bg-bg-2 px-1.5 text-xs font-semibold outline-none transition focus:border-accent"
                        >
                          <option value="">{t('map.psExtraAll')}</option>
                          {members.map((m) => (
                            <option key={m.name} value={m.name}>
                              {t('map.psExtraOnly', { name: m.name })}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => dropExtra(x.id)}
                          aria-label={t('map.psExtraRemove')}
                          title={t('map.psExtraRemove')}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line-2 text-fg-mute transition hover:border-accent hover:text-accent"
                        >
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-1.5 text-xs text-fg-mute">{t('map.psExtraNote')}</p>
              </div>

              {/* Per-player: what they looted, what they burned, and the gap to
                  the fair share that the transfers below close. */}
              <div className="mt-2 overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[26rem] text-sm">
                  <thead>
                    <tr className="border-b border-line text-[10px] font-bold uppercase tracking-wide text-fg-mute">
                      <th className="px-2 py-1 text-left">{t('map.psPlayer')}</th>
                      <th className="px-2 py-1 text-right">{t('map.hpLoot')}</th>
                      <th className="px-2 py-1 text-right">{t('map.psWaste')}</th>
                      {anyExtras && <th className="px-2 py-1 text-right">{t('map.psExtraCol')}</th>}
                      <th className="px-2 py-1 text-right">{anyExtras ? t('map.psNet') : t('map.hpBalance')}</th>
                      <th className="px-2 py-1 text-right">{t('map.psAdjust')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.name} className={`border-t border-line/60 ${r.name === meName ? 'bg-accent/10' : ''}`}>
                        <td className="max-w-[10rem] truncate px-2 py-1 font-semibold text-fg">
                          {r.name}
                          {r.name === meName && <span className="ml-1 text-[10px] font-bold uppercase text-accent">{t('map.psYou')}</span>}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums text-fg-dim">{gp(r.loot)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-fg-dim">{gp(r.supplies)}</td>
                        {anyExtras && (
                          <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-fg-dim">
                            {r.paid > 0 ? <span className="text-accent">-{gp(r.paid)}</span> : r.charged > 0 ? null : '—'}
                            {/* Charged to them alone: it comes off their target,
                                not off the party pot. */}
                            {r.charged > 0 && (
                              <span className="ml-1 text-[10px] text-fg-mute" title={t('map.psExtraOwnTitle')}>
                                ({t('map.psExtraOwn', { gp: gp(r.charged) })})
                              </span>
                            )}
                          </td>
                        )}
                        <td
                          className={`px-2 py-1 text-right font-semibold tabular-nums ${r.net >= 0 ? 'text-fg' : 'text-accent'}`}
                          title={anyExtras ? t('map.psNetTitle', { gp: gp(r.balance) }) : undefined}
                        >
                          {gp(r.net)}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {r.delta === 0 ? (
                            <span className="text-xs text-fg-mute">{t('map.psEven')}</span>
                          ) : (
                            <span className={`whitespace-nowrap text-xs font-bold tabular-nums ${r.delta > 0 ? 'text-canon' : 'text-accent'}`}>
                              {r.delta > 0 ? `+${gp(r.delta)}` : `-${gp(-r.delta)}`}
                              <span className="ml-1 font-normal text-fg-mute">{r.delta > 0 ? t('map.psGets') : t('map.psPays')}</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Who pays whom */}
              <div className="mt-2 rounded-xl border border-line bg-bg-2 p-2.5">
                <div className="mb-1.5 text-xs font-bold uppercase tracking-widest text-fg-dim">{t('map.psTransfers')}</div>
                {split.transfers.length === 0 ? (
                  <p className="text-sm text-fg-mute">{t('map.psNoTransfers')}</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {split.transfers.map((tr, i) => (
                      <li key={`${tr.from}-${tr.to}-${i}`} className="flex items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1 truncate font-semibold text-fg">{tr.from}</span>
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12h14M13 6l6 6-6 6" />
                        </svg>
                        <span className="min-w-0 flex-1 truncate font-semibold text-fg">{tr.to}</span>
                        <span className="shrink-0 font-bold tabular-nums text-accent">{gp(tr.amount)} gp</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* The literal banker conversation, one block per payer */}
              {payerBlocks.length > 0 && (
                <div className="mt-2 rounded-xl border border-line bg-bg-2 p-2.5">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-widest text-fg-dim">{t('map.psCommands')}</span>
                    {payerBlocks.length > 1 && <CopyButton text={allCommands} label={t('map.psCopyAll')} done={t('map.psCopied')} />}
                  </div>
                  <div className="flex flex-col gap-2">
                    {payerBlocks.map((p) => {
                      const lines = bankCommands(p.out)
                      return (
                        <div key={p.name} className={`rounded-lg border p-2 ${p.name === meName ? 'border-accent/60 bg-accent/5' : 'border-line'}`}>
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-xs font-bold text-fg">
                              {p.name}
                              {p.name === meName && <span className="ml-1 text-[10px] uppercase text-accent">{t('map.psYou')}</span>}
                              <span className="ml-1.5 font-normal text-fg-mute">{t('map.psPaysTotal', { gp: gp(p.total) })}</span>
                            </span>
                            <CopyButton text={lines.join('\n')} label={t('map.psCopy')} done={t('map.psCopied')} />
                          </div>
                          <pre className="scroll-atlas overflow-x-auto whitespace-pre rounded-md bg-bg/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-fg-dim">
                            {lines.join('\n')}
                          </pre>
                        </div>
                      )
                    })}
                  </div>
                  <p className="mt-1.5 text-xs text-fg-mute">{t('map.psCommandsNote')}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
