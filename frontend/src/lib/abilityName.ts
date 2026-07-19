/**
 * Ability-name localisation.
 *
 * `meta.abilities` names come verbatim from TibiaWiki and are therefore always
 * in English ("Fire wave", "Death strike", "Life drain beam", …). English is
 * already correct, so `es` is the only locale that needs work.
 *
 * There are ~1300 distinct names in the DB, but almost all of them are built
 * from a tiny vocabulary: an optional modifier + an element + a "shape" word
 * (wave / beam / strike / ball / …). So instead of a 1300-row dictionary we
 * translate compositionally and fall back to the raw English name for the long
 * tail of true proper names (Sudden Death, Whirlwind Throw, Wrath of Nature…).
 *
 * The "<shape> de <element>" order keeps Spanish grammar clean — the linking
 * "de" sidesteps gender agreement entirely ("onda de fuego", "rayo de muerte").
 */

// Shape nouns — the projectile / area word. Genderless join via "de …".
const ES_SHAPE: Record<string, string> = {
  wave: 'onda',
  beam: 'rayo',
  strike: 'golpe',
  ball: 'bola',
  missile: 'misil',
  bomb: 'bomba',
  hit: 'impacto',
  berserk: 'furia',
  chain: 'cadena',
  explosion: 'explosión',
  storm: 'tormenta',
  spit: 'escupitajo',
  shot: 'disparo',
  exori: 'golpe', // wiki shorthand for a close-range area hit
}

// Element / effect nouns used after "de".
const ES_ELEMENT: Record<string, string> = {
  fire: 'fuego',
  energy: 'energía',
  ice: 'hielo',
  earth: 'tierra',
  poison: 'veneno',
  poisoning: 'veneno',
  terra: 'tierra',
  death: 'muerte',
  holy: 'lo sagrado',
  physical: 'daño físico',
  blood: 'sangre',
  smoke: 'humo',
  spark: 'chispas',
  lifedrain: 'drenaje de vida',
  manadrain: 'drenaje de maná',
}

// Whole-name matches that don't decompose into element + shape.
const ES_STANDALONE: Record<string, string> = {
  paralyze: 'Paralización',
  paralyse: 'Paralización',
  paralysis: 'Paralización',
  paralyzes: 'Paralización',
  'distance paralyze': 'Paralización a distancia',
  invisibility: 'Invisibilidad',
  invisible: 'Invisibilidad',
  'turns invisible': 'Se vuelve invisible',
  berserk: 'Furia',
  bloodrage: 'Furia sangrienta',
  'blood rage': 'Furia sangrienta',
  drunkenness: 'Embriaguez',
  drunk: 'Embriaguez',
  envenom: 'Envenenamiento',
  poison: 'Envenenamiento',
  poisons: 'Envenenamiento',
  'poisons you': 'Te envenena',
  fireball: 'Bola de fuego',
  'self healing': 'Auto-curación',
  'self-healing': 'Auto-curación',
}

// Leading modifiers we can render safely (invariable in gender).
const ES_MODIFIER_PREFIX: Record<string, string> = {
  great: 'gran',
  greater: 'gran',
  large: 'gran',
  big: 'gran',
  strong: 'gran',
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

function translateEs(raw: string): string {
  let key = raw.trim().toLowerCase().replace(/\s+/g, ' ')

  // Fixed self-healing phrasings ("frequent self-healing", "very frequent…").
  if (/self[\s-]?heal/.test(key)) return 'Auto-curación'
  if (ES_STANDALONE[key]) return ES_STANDALONE[key]

  // Normalise the two multi-word elements and the "fireball" compound into
  // single tokens so the element+shape parser can see them.
  key = key
    .replace(/life drain/g, 'lifedrain')
    .replace(/mana drain/g, 'manadrain')
    .replace(/fireball/g, 'fire ball')

  // Optional trailing "… a distancia" from a leading "distance".
  let distance = false
  if (key.startsWith('distance ')) {
    distance = true
    key = key.slice('distance '.length)
  }

  const tokens = key.split(' ')

  // Optional single leading modifier ("great fireball" → "gran bola de fuego").
  let prefix = ''
  if (tokens.length > 2 && ES_MODIFIER_PREFIX[tokens[0]]) {
    prefix = ES_MODIFIER_PREFIX[tokens[0]] + ' '
    tokens.shift()
  }

  let out: string | null = null
  if (tokens.length === 2 && ES_ELEMENT[tokens[0]] && ES_SHAPE[tokens[1]]) {
    out = `${ES_SHAPE[tokens[1]]} de ${ES_ELEMENT[tokens[0]]}`
  } else if (tokens.length === 1 && ES_SHAPE[tokens[0]]) {
    out = ES_SHAPE[tokens[0]]
  } else if (tokens.length === 1 && ES_ELEMENT[tokens[0]]) {
    out = ES_ELEMENT[tokens[0]]
  }

  if (!out) return raw // long-tail proper name → leave the English as-is
  return cap(prefix + out + (distance ? ' a distancia' : ''))
}

/** Localise a raw TibiaWiki ability name for the given 2-letter locale. */
export function localizeAbilityName(raw: string, lang: string): string {
  if (!raw) return raw
  if (lang === 'es') return translateEs(raw)
  return cap(raw) // English source — just tidy the leading letter
}
