type Tone = 'canon' | 'interpretation' | 'theory' | 'gap'

const toneBar: Record<Tone, string> = {
  canon: 'bg-canon',
  interpretation: 'bg-arcane',
  theory: 'bg-danger',
  gap: 'bg-fg-mute',
}

const toneNote: Record<Tone, string> = {
  canon: 'text-canon',
  interpretation: 'text-arcane',
  theory: 'text-danger',
  gap: 'text-fg-mute',
}

interface SectionProps {
  title: string
  body: string | null
  note?: string
  tone: Tone
}

export function Section({ title, body, note, tone }: SectionProps) {
  if (!body) return null

  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className={`h-3.5 w-1 rounded-full ${toneBar[tone]}`} />
        <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-fg">{title}</h2>
        {note && (
          <span className={`ml-auto text-[10px] font-semibold uppercase tracking-wider ${toneNote[tone]}`}>
            {note}
          </span>
        )}
      </header>
      <div className="p-4">
        <div className="prose-atlas">{body}</div>
      </div>
    </section>
  )
}
