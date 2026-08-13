// Party settle-up: turn a Party Hunt Analyzer's per-player blocks into "who
// pays whom", plus the banker commands to actually do it in game.
//
// The convention every Tibia party uses: the session's LOOT is shared and the
// SUPPLIES each player burned are the party's cost too, so everyone should walk
// out with the same net. That net is the party's balance (loot − supplies) over
// the number of players, and each player's adjustment is the gap between that
// fair share and what they personally banked. A player who looted a lot pays;
// a player who burned potions all session gets paid back.
import type { Member } from './huntAnalyzer'

/**
 * A cost the analyzer never saw — blessings, a boss entry fee, a rope bought
 * mid-hunt. Someone fronted the gold (`paidBy`) and someone bears it: the whole
 * party when `chargedTo` is empty, or that one player when it names them.
 */
export type Extra = {
  id: string
  concept: string
  amount: number
  paidBy: string
  chargedTo: string
}

export type SplitRow = Member & {
  /** Gold this player fronted for extras — out of their pocket already. */
  paid: number
  /** Extras that are this player's alone to bear. */
  charged: number
  /** Where they really stand: analyzer balance minus what they fronted. */
  net: number
  /** Gold this player must still receive (+) or hand over (−) to end level. */
  delta: number
}

export type Transfer = { from: string; to: string; amount: number }

export type Split = {
  rows: SplitRow[]
  /**
   * The shared pot ÷ players — what each member ends on, before anything
   * charged to them personally.
   */
  fair: number
  /** Party balance from the analyzer, before extras. */
  total: number
  /** Extras the whole party bears. */
  shared: number
  players: number
  transfers: Transfer[]
}

export function splitParty(members: Member[], extras: Extra[] = []): Split {
  const players = members.length
  const names = new Set(members.map((m) => m.name))

  // An extra only counts once it names a real payer — a half-filled row is
  // still being typed, not a cost. A "charged to" pointing at someone who left
  // the paste falls back to the party, which is the safe reading.
  const paid = new Map<string, number>()
  const charged = new Map<string, number>()
  let shared = 0
  for (const e of extras) {
    const amount = Math.round(Number(e.amount) || 0)
    if (amount <= 0 || !names.has(e.paidBy)) continue
    paid.set(e.paidBy, (paid.get(e.paidBy) ?? 0) + amount)
    if (e.chargedTo && names.has(e.chargedTo)) {
      charged.set(e.chargedTo, (charged.get(e.chargedTo) ?? 0) + amount)
    } else {
      shared += amount
    }
  }

  const total = members.reduce((s, m) => s + m.balance, 0)
  // What the party splits is its balance minus the costs the party agreed to
  // carry. Anything charged to one player is NOT in this pot — it comes off
  // that player's own target below, so the payer still gets made whole.
  const fair = players > 0 ? (total - shared) / players : 0

  // Gold is an integer in game, so every adjustment is rounded — and rounding N
  // of them independently can leave the table not summing to zero. Push that
  // residue (a handful of gp at most) onto the biggest mover, so what everyone
  // pays always equals what everyone receives.
  const rows: SplitRow[] = members.map((m) => {
    const p = paid.get(m.name) ?? 0
    const c = charged.get(m.name) ?? 0
    const net = m.balance - p
    return { ...m, paid: p, charged: c, net, delta: Math.round(fair - c - net) }
  })
  const residue = rows.reduce((s, r) => s + r.delta, 0)
  if (residue !== 0 && rows.length > 0) {
    let big = 0
    rows.forEach((r, i) => {
      if (Math.abs(r.delta) > Math.abs(rows[big].delta)) big = i
    })
    rows[big].delta -= residue
  }

  // Fewest possible transfers: the deepest debtor pays the biggest creditor
  // until one of them is settled, then move on. Nobody sends two payments when
  // one would do.
  const debtors = rows.filter((r) => r.delta < 0).map((r) => ({ name: r.name, amt: -r.delta })).sort((a, b) => b.amt - a.amt)
  const creditors = rows.filter((r) => r.delta > 0).map((r) => ({ name: r.name, amt: r.delta })).sort((a, b) => b.amt - a.amt)
  const transfers: Transfer[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amt, creditors[j].amt)
    if (amount > 0) transfers.push({ from: debtors[i].name, to: creditors[j].name, amount })
    debtors[i].amt -= amount
    creditors[j].amt -= amount
    if (debtors[i].amt <= 0) i++
    if (creditors[j].amt <= 0) j++
  }

  return { rows, fair, total, shared, players, transfers }
}

/**
 * The literal lines to say to a banker NPC for one player's payments. The
 * conversation stays open after a transfer, so a player owing two people says
 * "hi" once and then repeats transfer/yes.
 */
export function bankCommands(transfers: Transfer[]): string[] {
  if (transfers.length === 0) return []
  const lines = ['hi']
  for (const tr of transfers) {
    lines.push(`transfer ${tr.amount} to ${tr.to}`)
    lines.push('yes')
  }
  return lines
}

/** Payments grouped by who sends them, so each payer gets one command block. */
export function byPayer(transfers: Transfer[]): { name: string; out: Transfer[]; total: number }[] {
  const order: string[] = []
  const map = new Map<string, Transfer[]>()
  for (const tr of transfers) {
    if (!map.has(tr.from)) {
      map.set(tr.from, [])
      order.push(tr.from)
    }
    map.get(tr.from)!.push(tr)
  }
  return order.map((name) => {
    const out = map.get(name)!
    return { name, out, total: out.reduce((s, tr) => s + tr.amount, 0) }
  })
}
