import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Seo } from '../lib/seo'
import { RASHID_ROTATION, useRashidClock } from '../lib/rashid'

/**
 * "¿Dónde está Rashid hoy?" — answers the classic daily Tibia question.
 *
 * The rotation data and the Europe/Berlin server-save clock live in
 * lib/rashid.ts, shared with the map's Rashid marker (MapPage).
 */

type Lang = 'es' | 'en'

/** Self-contained bilingual copy — this page deliberately avoids i18n.ts keys. */
const COPY = {
  es: {
    kicker: 'NPC viajero',
    title: '¿Dónde está Rashid hoy?',
    seoTitle: '¿Dónde está Rashid hoy? Ubicación de hoy y rotación semanal — Tibia',
    seoDescription:
      'Dónde está Rashid hoy en Tibia: la ciudad de hoy en su rotación semanal, a qué hora cambia (server save de las 10:00 CET) y la lista completa de días y ciudades.',
    dayNames: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
    answer: (day: string, city: string, spot: string) => `Hoy es ${day}: Rashid está en ${city}, ${spot}.`,
    changeNote: 'Cambia en el server save de las 10:00 CET (hora de Europa/Berlín).',
    changesIn: 'Cambia de ciudad en',
    mapCta: 'Ver a Rashid en el mapa',
    rotationTitle: 'Rotación semanal de Rashid',
    colDay: 'Día',
    colCity: 'Ciudad',
    colSpot: 'Dónde encontrarlo',
    todayBadge: 'HOY',
    whoTitle: '¿Quién es Rashid?',
    whoBody:
      'Rashid es el mercader viajero de los djinns en Tibia. Compra productos valiosos de criaturas y objetos raros a buen precio, así que muchos jugadores guardan su loot para vendérselo a él. Cada día de la semana atiende en una ciudad distinta y se muda con el server save de las 10:00 (hora de Europa/Berlín). Para poder comerciar con él primero hay que completar la quest The Travelling Trader, que desbloquea su comercio.',
    faqQ1: '¿Dónde está Rashid hoy?',
    faqQ2: '¿Cuándo cambia Rashid de ciudad?',
    faqA2:
      'Rashid cambia de ciudad cada día con el server save de las 10:00 (hora de Europa/Berlín, CET/CEST). Antes de esa hora todavía está en la ciudad del día anterior; después del server save aparece en la ciudad del nuevo día.',
  },
  en: {
    kicker: 'Travelling NPC',
    title: 'Where is Rashid today?',
    seoTitle: "Where is Rashid today? Today's location and weekly rotation — Tibia",
    seoDescription:
      "Where Rashid is today in Tibia: today's city in his weekly rotation, when it changes (10:00 CET server save) and the full day-by-day list.",
    dayNames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    answer: (day: string, city: string, spot: string) => `Today is ${day}: Rashid is in ${city}, ${spot}.`,
    changeNote: 'He moves at the 10:00 CET server save (Europe/Berlin time).',
    changesIn: 'Changes city in',
    mapCta: 'See Rashid on the map',
    rotationTitle: "Rashid's weekly rotation",
    colDay: 'Day',
    colCity: 'City',
    colSpot: 'Where to find him',
    todayBadge: 'TODAY',
    whoTitle: 'Who is Rashid?',
    whoBody:
      'Rashid is the travelling merchant of the Djinn in Tibia. He buys valuable creature products and rare items at good prices, so many players save up their loot to sell to him. Each day of the week he sets up shop in a different city, moving at the 10:00 (Europe/Berlin time) server save. To trade with him you first need to complete The Travelling Trader quest, which unlocks his shop.',
    faqQ1: 'Where is Rashid today?',
    faqQ2: 'When does Rashid change city?',
    faqA2:
      "Rashid moves to a new city every day at the 10:00 server save (Europe/Berlin time, CET/CEST). Before that time he is still in the previous day's city; after the server save he appears in the new day's city.",
  },
} as const

function formatCountdown(totalSeconds: number): string {
  const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')
  const ss = String(totalSeconds % 60).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

/** Capitalize the first letter (Spanish day names are stored lowercase). */
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ── Page ─────────────────────────────────────────────────────────────────────

/** Monday-first display order for the rotation table. */
const TABLE_ORDER = [1, 2, 3, 4, 5, 6, 0]

export function RashidPage() {
  const { i18n } = useTranslation()
  const lang: Lang = (i18n.language || 'es').slice(0, 2) === 'en' ? 'en' : 'es'
  const c = COPY[lang]

  const { effectiveDay, secondsToSave } = useRashidClock()
  const today = RASHID_ROTATION[effectiveDay]
  const answer = c.answer(c.dayNames[effectiveDay], today.city, today.spot[lang])
  // Deep-link into the map (same #x/y/z/f hash scheme GeoPage uses).
  const mapHash = `/#x=${today.x}&y=${today.y}&z=4&f=${today.z}`

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: c.faqQ1,
        acceptedAnswer: { '@type': 'Answer', text: answer },
      },
      {
        '@type': 'Question',
        name: c.faqQ2,
        acceptedAnswer: { '@type': 'Answer', text: c.faqA2 },
      },
    ],
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Seo title={c.seoTitle} description={c.seoDescription} path="/rashid" jsonLd={jsonLd} />

      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-accent">{c.kicker}</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-fg sm:text-4xl">{c.title}</h1>
      </header>

      {/* The direct answer — what everyone searching this question wants first. */}
      <section className="panel space-y-3 border-accent/40 p-6">
        <p className="text-xl font-black leading-snug tracking-tight text-fg sm:text-2xl">{answer}</p>
        <p className="text-sm text-fg-mute">
          {c.changeNote} {c.changesIn}{' '}
          <span className="font-mono font-semibold text-fg">{formatCountdown(secondsToSave)}</span>
        </p>
        <Link
          to={mapHash}
          className="inline-block rounded border border-accent/50 bg-accent/10 px-4 py-2 text-sm font-bold text-accent transition hover:bg-accent/20"
        >
          {c.mapCta} →
        </Link>
      </section>

      {/* Full weekly rotation, today's row highlighted. */}
      <section className="panel space-y-3 p-6">
        <h2 className="text-lg font-black tracking-tight text-fg">{c.rotationTitle}</h2>
        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-bold uppercase tracking-wider text-fg-mute">
                <th className="px-3 py-2">{c.colDay}</th>
                <th className="px-3 py-2">{c.colCity}</th>
                <th className="px-3 py-2">{c.colSpot}</th>
              </tr>
            </thead>
            <tbody>
              {TABLE_ORDER.map((day) => {
                const isToday = day === effectiveDay
                return (
                  <tr
                    key={day}
                    className={`border-b border-line/60 last:border-0 ${isToday ? 'bg-accent/10' : ''}`}
                  >
                    <td className={`px-3 py-2 font-medium ${isToday ? 'text-accent' : 'text-fg'}`}>
                      {cap(c.dayNames[day])}
                      {isToday && (
                        <span className="ml-2 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-accent">
                          {c.todayBadge}
                        </span>
                      )}
                    </td>
                    <td className={`px-3 py-2 font-bold ${isToday ? 'text-accent' : 'text-fg'}`}>
                      {RASHID_ROTATION[day].city}
                    </td>
                    <td className="px-3 py-2 text-fg-dim">{RASHID_ROTATION[day].spot[lang]}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Who Rashid is — short, factual explainer. */}
      <section className="panel space-y-3 p-6">
        <h2 className="text-lg font-black tracking-tight text-fg">{c.whoTitle}</h2>
        <p className="text-sm leading-relaxed text-fg-dim">{c.whoBody}</p>
      </section>
    </div>
  )
}
