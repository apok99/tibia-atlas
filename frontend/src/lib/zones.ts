import type { LatLngExpression } from 'leaflet'

// --- Tibia minimap coordinate system ------------------------------------------
// Minimap tiles are 256x256, named Minimap_Color_<gameX>_<gameY>_<floor>.png,
// aligned to a 256-unit grid in Tibia world coordinates, and served from
// /minimap/. Shared by the interactive map and the "guess the zone" game so the
// bounds, tile size and world→screen projection stay in a single place.
export const TILE = 256

// Bounds of the exported region (Tibia world coordinates), from the tile set.
export const X_MIN = 31744
export const X_MAX = 34304 // exclusive edge (last tile 34048 + 256)
export const Y_MIN = 30976
export const Y_MAX = 33024 // exclusive edge (last tile 32768 + 256)

// Floor 7 is the surface/ground level in Tibia; lower numbers are higher up.
export const SURFACE = 7

// Map a Tibia world coordinate to a Leaflet (lat,lng) point under CRS.Simple:
// lng = x and lat = -y so that larger game-y is lower on screen.
export const toLatLng = (x: number, y: number): LatLngExpression => [-y, x]

// --- Named places -------------------------------------------------------------
// Cities/landmarks (surface floor). Coordinates are approximate centres within
// the available tiles — tweak freely if any feels off.
export type Landmark = { name: string; x: number; y: number; floor: number }
export const LANDMARKS: Landmark[] = [
  { name: "Ab'Dendriel", x: 32665, y: 31652, floor: 7 },
  { name: 'Ankrahmun', x: 33146, y: 32816, floor: 7 },
  { name: 'Carlin', x: 32343, y: 31792, floor: 7 },
  { name: 'Cormaya', x: 33307, y: 31999, floor: 7 },
  // NOTE: route anchors must sit on OPEN city ground. (33236,32432) is the
  // decorative walled garden (a sealed 39-tile pocket) — routes from the
  // dropdown died at the start there. Same for Venore's old (32947,32081).
  { name: 'Darashia', x: 33213, y: 32453, floor: 7 },
  { name: 'Edron', x: 33211, y: 31830, floor: 7 },
  { name: 'Farmine', x: 33030, y: 31500, floor: 7 },
  { name: 'Kazordoon', x: 32614, y: 31923, floor: 7 },
  { name: 'Krailos', x: 33580, y: 31584, floor: 7 },
  { name: 'Liberty Bay', x: 32309, y: 32794, floor: 7 },
  { name: 'Port Hope', x: 32629, y: 32769, floor: 7 },
  { name: 'Rathleton', x: 33607, y: 31955, floor: 7 },
  { name: 'Rookgaard', x: 32097, y: 32219, floor: 7 },
  { name: 'Roshamuul', x: 33524, y: 32477, floor: 7 },
  { name: 'Svargrond', x: 32278, y: 31146, floor: 7 },
  { name: 'Thais', x: 32365, y: 32224, floor: 7 },
  { name: 'Venore', x: 32963, y: 32087, floor: 7 },
  { name: 'Yalahar', x: 32805, y: 31234, floor: 7 },
]

// Named hunting regions / dungeons / islands shown as smaller on-map labels
// (not in the navigation dropdowns). Coordinates are approximate centres within
// the covered tile region — anchored to known landmarks or the community map
// data — and easy to nudge if any feels off.
export type Place = Landmark & { kind: 'city' | 'region' }
// Coordinates verified from TibiaWiki's {{Mapper Coords}} (the location field of
// each place's article): game_x = floor*256 + offset. Underground areas are
// labelled at their surface position so the name marks the spot on the map.
export const REGIONS: { name: string; x: number; y: number }[] = [
  // Thais & central mainland
  { name: 'Mount Sternum', x: 32494, y: 32072 },
  { name: 'Femor Hills', x: 32569, y: 31803 },
  { name: 'Fibula', x: 32261, y: 32385 },
  // Bounac (Order of the Lion): OTBM town #25, temple sits on open ground.
  { name: 'Bounac', x: 32424, y: 32445 },
  { name: 'Plains of Havoc', x: 32735, y: 32297 },
  { name: 'Demona', x: 32479, y: 31663 },
  { name: 'Outlaw Camp', x: 32643, y: 32222 },
  { name: 'Maze of Lost Souls', x: 32490, y: 31697 },
  { name: 'Dark Cathedral', x: 32664, y: 32344 },
  // Carlin & northern / western islands
  { name: 'Folda', x: 32020, y: 31572 },
  { name: 'Ramoa', x: 31931, y: 32567 },
  { name: 'Goroma', x: 32095, y: 32583 },
  { name: 'Treasure Island', x: 32156, y: 32948 },
  { name: 'Laguna Islands', x: 32466, y: 32939 },
  // Ab'Dendriel & orc lands
  { name: 'Elvenbane', x: 32590, y: 31645 },
  { name: 'Mistrock', x: 32560, y: 31449 },
  { name: 'Orc Fortress', x: 32934, y: 31781 },
  { name: 'Vengoth', x: 32916, y: 31516 },
  // Edron & the east
  { name: 'Cyclopolis', x: 33251, y: 31698 },
  { name: 'Hero Cave', x: 33164, y: 31638 },
  { name: 'Stonehome', x: 33303, y: 31773 },
  { name: 'Grimvale', x: 33333, y: 31690 },
  { name: 'Oramond', x: 33501, y: 31965 },
  // Venore & the Ghostlands
  { name: 'Shadowthorn', x: 33075, y: 32170 },
  { name: 'Drefia', x: 33018, y: 32443 },
  { name: 'Forbidden Lands', x: 32973, y: 32549 },
  // Desert (Darashia / Ankrahmun)
  { name: "Mal'ouquah", x: 33041, y: 32627 },
  { name: 'Chor', x: 32952, y: 32855 },
  // Tiquanda jungle (Port Hope)
  { name: 'Tiquanda', x: 32812, y: 32699 },
  { name: 'Banuta', x: 32807, y: 32542 },
  { name: 'Trapwood', x: 32688, y: 32911 },
  // Underground demon lairs
  { name: 'Hellgate', x: 32675, y: 31647 },
  // Svargrond archipelago (ice)
  { name: 'Nibelor', x: 32353, y: 31053 },
  { name: 'Helheim', x: 32473, y: 31174 },
  { name: 'Okolnir', x: 32230, y: 31412 },
  { name: 'Formorgar Glacier', x: 32102, y: 31144 },
  { name: 'Chyllfroest', x: 32060, y: 31034 },
  { name: 'Tyrsung', x: 32464, y: 31173 },
  { name: 'Grimlund', x: 32021, y: 31294 },
  { name: 'Inukaya', x: 32367, y: 31058 },
  // Carlin & western isles
  { name: 'Senja', x: 32020, y: 31692 },
  { name: 'Vega', x: 31974, y: 31901 },
  { name: 'Isle of the Kings', x: 32126, y: 31665 },
  { name: 'Ghostlands', x: 32220, y: 31770 },
  { name: 'Fields of Glory', x: 32445, y: 31977 },
  { name: 'Mintwallin', x: 32540, y: 32200 },
  // Venore surroundings
  { name: 'Green Claw Swamp', x: 32820, y: 32020 },
  { name: 'Amazon Camp', x: 32839, y: 31920 },
  { name: 'Gnomebase Alpha', x: 33001, y: 31900 },
  // Southern seas
  { name: 'Meriana', x: 32132, y: 32912 },
  { name: 'Marapur', x: 33842, y: 32852 },
  // Marapur-island towns (OTBM towns #30/#31), anchored on open ground by
  // their temples.
  { name: 'Silvertides', x: 33776, y: 32842 },
  { name: 'Moonfall', x: 33807, y: 32745 },
  { name: 'Murmuring Wilderness', x: 33690, y: 32780 },
  { name: 'Gnomprona', x: 33600, y: 32880 },
  // Zao & the far east
  // Zao label sits on the open steppe south of the Great Gate — the gate
  // compound itself (33350,31370) is a sealed 821-tile pocket in the walk grid.
  { name: 'Zao', x: 33350, y: 31460 },
  { name: 'Razachai', x: 33074, y: 31100 },
  { name: 'Zzaion', x: 33262, y: 31100 },
  { name: 'Issavi', x: 33946, y: 31516 },
  { name: 'Warzones 4-6', x: 33844, y: 32214 },
  // Roshamuul & the dream realms
  { name: 'Roshamuul Prison', x: 33520, y: 32600 },
  { name: 'Guzzlemaw Valley', x: 33645, y: 32390 },
  { name: 'Feyrist', x: 33540, y: 32208 },
  { name: 'Candia', x: 33370, y: 32155 },
  // Ankrahmun desert & the Ancient Tombs. Each of the seven tombs is labelled at
  // its surface entrance (client marker coords); the bosses spawn on the floors
  // below. Names match the tomb, with the boss it houses in parentheses.
  { name: 'Mountain Tomb (Dipthrah)', x: 33133, y: 32568 },
  { name: 'Oasis Tomb (Rahemos)', x: 33133, y: 32640 },
  { name: 'Ancient Ruins Tomb (Vashresamun)', x: 33208, y: 32591 },
  { name: 'Tarpit Tomb (Morguthis)', x: 33233, y: 32704 },
  { name: 'Stone Tomb (Thalas)', x: 33282, y: 32743 },
  { name: 'Shadow Tomb (Mahrdis)', x: 33255, y: 32833 },
  { name: 'Library Tomb (Ashmunrah)', x: 33142, y: 32838 },
  { name: 'Horestis Tomb', x: 33026, y: 32710 },
  { name: 'Peninsula Tomb', x: 33027, y: 32869 },
  { name: 'Cobra Bastion', x: 33398, y: 32655 },
  // Tiquanda east coast
  { name: 'Asura Palace', x: 32948, y: 32689 },
  // The Hive & the north-eastern seas
  { name: 'The Hive', x: 33560, y: 31255 },
  { name: 'Hive Outpost', x: 33467, y: 31322 },
  { name: 'Gray Island', x: 33191, y: 31985 },
  { name: 'Orcsoberfest', x: 33779, y: 31054 },
  // Kilmaresh south
  { name: 'Ruins of Nuur', x: 33848, y: 31685 },
  // Starter isles & the dream courts
  // No Dawnport label: the town still exists in the Canary OTBM (#2) but was
  // retired from live Tibia (Newhaven replaced the beginner island).
  { name: 'Island of Destiny', x: 32094, y: 32004 },
  { name: 'Targuna', x: 33514, y: 32720 },
  { name: 'Winter Court', x: 33697, y: 32127 },
  { name: 'Summer Court', x: 33691, y: 32213 },
  // Forbidden Islands (wiki Mapper Coords)
  { name: 'Talahu', x: 31953, y: 32660 },
  { name: 'Kharos', x: 32121, y: 32686 },
  { name: 'Malada', x: 32016, y: 32713 },
]

// Every name drawn on the map: the cities (prominent) plus the regions (subtle).
export const MAP_LABELS: Place[] = [
  ...LANDMARKS.map((l): Place => ({ ...l, kind: 'city' })),
  ...REGIONS.map((r): Place => ({ ...r, floor: 7, kind: 'region' })),
]

// The full answer pool for the "guess the zone" game: every named place, cities
// and regions alike. Deduped by name (a couple of regions share a landmark's
// centre) so the daily pick and the search box never list the same name twice.
export const ZONES: Place[] = (() => {
  const seen = new Set<string>()
  const out: Place[] = []
  for (const p of MAP_LABELS) {
    if (seen.has(p.name)) continue
    seen.add(p.name)
    out.push(p)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
})()
