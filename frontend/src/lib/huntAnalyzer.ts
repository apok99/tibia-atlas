// Parser for Tibia's in-client Hunt Analyzer / Party Hunt Analyzer pastes.
// Lives apart from the profit tool because the party-split panel reads the very
// same paste — one parser, one set of quirks to get right.

export type Tally = { name: string; count: number }

/** One player's own block in a Party Hunt Analyzer. */
export type Member = {
  name: string
  loot: number
  supplies: number
  balance: number
  damage: number | null
  healing: number | null
}

export type Parsed = {
  /** Local start time of the session, from the analyzer's own "From …" line. */
  startedAt: Date | null
  /** Party size read off the paste: 1 for a solo analyzer. */
  players: number
  /** Per-player blocks of a Party Hunt Analyzer; empty for a solo one. */
  members: Member[]
  hours: number | null
  loot: number | null
  supplies: number | null
  balance: number | null
  xpGain: number | null
  xpPerHour: number | null
  damage: number | null
  damagePerHour: number | null
  healing: number | null
  healingPerHour: number | null
  kills: Tally[]
  items: Tally[]
}

// "667x candy horror 72x honey elemental …" → tallies. Works for one-per-line
// pastes too (whitespace is normalised first). Names never start with a digit,
// so the next "NNNx " marks the end of the previous name.
export function parseTallies(section: string): Tally[] {
  const out: Tally[] = []
  const flat = section.replace(/\s+/g, ' ').trim()
  const re = /(\d+)x\s+(.+?)(?=\s+\d+x\s|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(flat))) {
    const count = parseInt(m[1], 10)
    const name = m[2].replace(/^(?:a|an)\s+/i, '').trim()
    if (name && Number.isFinite(count)) out.push({ name, count })
  }
  return out
}

// Pull the numbers out of a pasted (party) hunt analyzer. Per-player sections
// repeat "Loot:/Supplies:/Balance:" below the totals, so the FIRST match of
// each label is always the session total. Numbers keep their thousand
// separators ("1,234,567") and Balance may be negative. The paste often
// arrives as ONE long line (the client strips newlines), so labels are matched
// anywhere in the text — each number simply ends at the next space or word.
// Word boundaries keep "Looted Items:" / "Loot Type:" from matching "Loot:",
// and the lookbehinds keep "Raw XP Gain"/"Raw XP/h" from stealing the boosted
// "XP Gain"/"XP/h" values.
export function parseAnalyzer(text: string): Parsed {
  const num = (re: RegExp): number | null => {
    const m = re.exec(text)
    if (!m) return null
    const neg = m[1].trim().startsWith('-')
    const v = parseInt(m[1].replace(/[^\d]/g, ''), 10)
    if (!Number.isFinite(v)) return null
    return neg ? -v : v
  }
  let hours: number | null = null
  const s = /\bSession:\s*(\d+):(\d{2})\s*h/i.exec(text)
  if (s) {
    const h = parseInt(s[1], 10) + parseInt(s[2], 10) / 60
    if (h > 0) hours = h
  }

  // "From 2026-07-29, 23:19:58 to …" — when the session was actually hunted,
  // which is what the log should file it under. Built as a LOCAL date: a hunt
  // that ran 23:19 → 00:47 belongs to the night the player played, not to the
  // calendar day it happened to end on (nor to whatever UTC says).
  let startedAt: Date | null = null
  const f = /\bFrom\s+(\d{4})-(\d{2})-(\d{2}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/i.exec(text)
  if (f) {
    const d = new Date(+f[1], +f[2] - 1, +f[3], +f[4], +f[5], +(f[6] ?? 0))
    if (!Number.isNaN(d.getTime())) startedAt = d
  }

  // Party Hunt Analyzer: the party totals come first, then one block per member
  // — "<name> Loot: … Supplies: … Balance: … Damage: … Healing: …". The paste
  // often arrives with the newlines stripped, so the blocks are found by
  // walking the Loot/Supplies/Balance triples rather than by line: the first
  // triple is the session, every later one is a player, and the player's name
  // is whatever text sits between the previous block and their own "Loot:".
  const members: Member[] = []
  const TRIPLE = /\bLoot:\s*(-?[\d.,]+)\s+Supplies:\s*(-?[\d.,]+)\s+Balance:\s*(-?[\d.,]+)/gi
  let m: RegExpExecArray | null
  let prevEnd = -1
  while ((m = TRIPLE.exec(text))) {
    if (prevEnd < 0) {
      // First triple = the party totals, already read above.
      prevEnd = m.index + m[0].length
      continue
    }
    const gap = text.slice(prevEnd, m.index)
    // What's left of the gap once the previous block's trailing stats and any
    // stray header are stripped is the player's name.
    const name = gap
      .replace(/\b(?:Damage|Healing|Damage\/h|Healing\/h|XP Gain|XP\/h|Raw XP Gain|Raw XP\/h):\s*-?[\d.,]+/gi, '')
      .replace(/\bLoot Type:\s*\w+/gi, '')
      .replace(/[\s\n\r\t]+/g, ' ')
      .trim()
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 200)
    const stat = (label: string) => {
      const hit = new RegExp(`\\b${label}:\\s*(-?[\\d.,]+)`, 'i').exec(tail)
      if (!hit) return null
      const v = parseInt(hit[1].replace(/[^\d]/g, ''), 10)
      return Number.isFinite(v) ? v : null
    }
    const gold = (s: string) => {
      const neg = s.trim().startsWith('-')
      const v = parseInt(s.replace(/[^\d]/g, ''), 10)
      return Number.isFinite(v) ? (neg ? -v : v) : 0
    }
    members.push({
      name: name || `#${members.length + 1}`,
      loot: gold(m[1]),
      supplies: gold(m[2]),
      balance: gold(m[3]),
      damage: stat('Damage'),
      healing: stat('Healing'),
    })
    prevEnd = m.index + m[0].length
  }
  const players = Math.max(1, members.length)

  // List sections: "Killed Monsters: …" runs until "Looted Items: …".
  const km = /Killed Monsters:/i.exec(text)
  const li = /Looted Items:/i.exec(text)
  const kills = km ? parseTallies(text.slice(km.index + km[0].length, li ? li.index : undefined)) : []
  const items = li ? parseTallies(text.slice(li.index + li[0].length)) : []

  return {
    startedAt,
    players,
    members,
    hours,
    loot: num(/\bLoot:\s*(-?[\d.,]+)/i),
    supplies: num(/\bSupplies:\s*(-?[\d.,]+)/i),
    balance: num(/\bBalance:\s*(-?[\d.,]+)/i),
    xpGain: num(/(?<!Raw )\bXP Gain:\s*(-?[\d.,]+)/i),
    xpPerHour: num(/(?<!Raw )\bXP\/h:\s*(-?[\d.,]+)/i),
    damage: num(/\bDamage:\s*(-?[\d.,]+)/i),
    damagePerHour: num(/\bDamage\/h:\s*(-?[\d.,]+)/i),
    healing: num(/\bHealing:\s*(-?[\d.,]+)/i),
    healingPerHour: num(/\bHealing\/h:\s*(-?[\d.,]+)/i),
    kills,
    items,
  }
}
