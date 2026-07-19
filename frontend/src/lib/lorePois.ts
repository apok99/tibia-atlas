// --- Lore / mystery points of interest ----------------------------------------
// A hand-curated "mystery tour": iconic Tibian locations plotted at their real
// world coordinates, each linked to a PUBLISHED lore entry (by slug). Clicking a
// point opens an in-map reader panel with the story in the active language.
//
// This is deliberately a curated list (not data-driven): the lore entries carry
// no map coordinates, and we want editorial control over which mysteries appear
// and exactly where the pin lands. Coordinates come from TibiaWiki Mapper Coords
// ({{Mapper Coords|A.B|C.D|z}} → x = A*256+B, y = C*256+D), the imported client
// markers (public/map-markers.json), or the region anchors in zones.ts.
//
// `slug` MUST match a published entry — the panel fetches /api/entries/{slug}.
// `title` is a short label shown on the pin/tooltip before the entry loads.

export type LorePoi = {
  /** Published entry to open in the reader panel (rich-lore path). */
  slug?: string
  /** Short label for the pin (kept in Spanish; the entry supplies the full name). */
  title: string
  x: number
  y: number
  floor: number
  /**
   * Inline caption for mystery spots that have NO lore entry yet (e.g. the
   * level-999 gate). Factual only — this documents a real in-game object/
   * mystery, it does not invent lore. Shown in the panel instead of an entry.
   */
  blurb?: string
}

export const LORE_POIS: LorePoi[] = [
  // Serpentine Tower — the sunken sorcerer's tower in the Murmuring Wilderness
  // (wiki Mapper Coords 129.171/128.84).
  { slug: 'serpentine-tower', title: 'Serpentine Tower', x: 33195, y: 32852, floor: 7 },
  // The Dark Pyramid east of Ankrahmun (wiki 130.27/126.30).
  { slug: 'dark-pyramid', title: 'Pirámide Oscura', x: 33307, y: 32286, floor: 7 },
  // The Demon Oak on the mainland south of Venore (wiki 127.205/126.95).
  { slug: 'the-demon-oak-quest', title: 'El Roble Demoníaco', x: 32717, y: 32351, floor: 7 },
  // Mother of Scarabs' lair beneath the Kha'labal desert (client marker).
  { slug: 'mother-of-scarabs-lair', title: 'Madre de los Escarabajos', x: 33236, y: 32576, floor: 7 },
  // Ferumbras' Citadel in the Kha'zeel mountains east of Ankrahmun.
  { slug: 'ferumbras-citadel', title: 'Ciudadela de Ferumbras', x: 33420, y: 32678, floor: 7 },
  // The Hero Cave (Edron Ruins), the classic Excalibug legend site.
  { slug: 'hero-cave', title: 'Cueva de los Héroes', x: 33163, y: 31636, floor: 7 },
  // The Inquisition — the crusade against the demon cults (client marker).
  { slug: 'the-inquisition-quest', title: 'La Inquisición', x: 32319, y: 32276, floor: 7 },
  // The Ghostlands west of Carlin.
  { slug: 'ghostlands', title: 'Las Tierras Fantasma', x: 32220, y: 31770, floor: 7 },
  // Hellgate, the demon complex below Ab'Dendriel.
  { slug: 'hellgate', title: 'Hellgate', x: 32675, y: 31647, floor: 7 },
  // Drefia, the necromancers' ruined city.
  { slug: 'drefia', title: 'Drefia', x: 33018, y: 32443, floor: 7 },
  // The Formorgar Glacier and its frozen war.
  { slug: 'formorgar-glacier', title: 'Glaciar de Formorgar', x: 32102, y: 31144, floor: 7 },
  // Deeper Banuta — the serpent goddess Gorgo and the naga.
  { slug: 'deeper-banuta', title: 'Banuta Profunda', x: 32807, y: 32542, floor: 7 },
  // The Ancient Tombs of the pharaohs beneath Ankrahmun's desert.
  { slug: 'ankrahmun-tombs', title: 'Tumbas de Ankrahmun', x: 33133, y: 32568, floor: 7 },
  // Zao — the lizard empire and the Wrath of the Emperor.
  { slug: 'wrath-of-the-emperor-quest', title: 'La Ira del Emperador', x: 33350, y: 31460, floor: 7 },
  // Mintwallin, the sunken minotaur kingdom below Thais.
  { slug: 'mintwallin', title: 'Mintwallin', x: 32540, y: 32200, floor: 7 },
  // Goroma, the volcanic island and its buried secrets.
  { slug: 'goroma', title: 'Goroma', x: 32095, y: 32583, floor: 7 },
  // The Cults of Tibia — the seven cults and the black knight (client marker).
  { slug: 'cults-of-tibia-quest', title: 'Los Cultos de Tibia', x: 33315, y: 32674, floor: 7 },
  // Vengoth, the castle of the vampire counts.
  { slug: 'vengoth', title: 'Vengoth', x: 32916, y: 31516, floor: 7 },
  // The Basilisk — a snake NPC sealed in an unreachable room in the Kazordoon
  // mines; "no way into his room" is the whole legend. Anchored above his cave.
  { slug: 'basilisk', title: 'El Basilisco', x: 32649, y: 31905, floor: 7 },
  // Ferumbras, the archmage-turned-demon, at his citadel east of Ankrahmun
  // (offset from the citadel place-pin so both stay clickable).
  { slug: 'ferumbras', title: 'Ferumbras', x: 33440, y: 32692, floor: 7 },
  // Schrödinger's Island — the legendary level-999 gate. It is a Magic
  // Forcefield ("Gate of Expertise for level 999", TibiaWiki Mapper Coords
  // 128.115/127.14/11 → 32883,32526,f11) south of Venore that demands level
  // 999 to cross. 999 is the highest level requirement in the game — there is
  // NO level-9999 gate; this is the door players mean. No lore entry yet, so it
  // carries a factual caption. Anchored on the surface above it for visibility.
  {
    title: 'Isla de Schrödinger (nivel 999)',
    x: 32883,
    y: 32526,
    floor: 7,
    blurb:
      'Al sur de Venore, en las profundidades (piso -4), un campo de fuerza mágico exige nivel 999 para cruzarlo y da paso a la legendaria Isla de Schrödinger — el requisito de nivel más alto de todo Tibia. Como el gato del experimento, nadie sabe con certeza qué se oculta al otro lado: durante gran parte de la historia del juego el nivel 999 fue inalcanzable, y la isla sigue siendo uno de sus mayores misterios.',
  },
]
