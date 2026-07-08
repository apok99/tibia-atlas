// Bake the static house layer for the map. TibiaData's houses API gives live
// name/rent/status per world but NO coordinates; the otservbr world files carry
// every house's entry tile plus a `clientid` that IS the real Tibia house id
// TibiaData keys on (verified: "Castle of the Winds" clientid=40112 ==
// TibiaData house_id=40112). So we bake coords+meta from the XML here and let the
// backend ETL layer live rent/auction status on top, joined by id.
//
//   node tools/otbm/bake-houses.mjs
//
// Source (fetched, not committed):
//   opentibiabr/canary  data-otservbr-global/world/otservbr-house.xml
// Output (committed, served to the browser):
//   frontend/public/houses.json → { updated, houses: [{ id, name, x, y, z,
//                                    town, rent, size, beds, guild }] }
//   id = real Tibia house id (clientid). Only houses whose entry tile falls in
//   the rendered map region are kept, so every pin lands on a real tile.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = path.join(root, 'frontend', 'public', 'houses.json')
const HOUSE_XML = 'https://raw.githubusercontent.com/opentibiabr/canary/main/data-otservbr-global/world/otservbr-house.xml'

// Same rendered region as bake-walk.mjs — pins outside it have no map tile.
const X0 = 31744, X1 = 34304, Y0 = 30976, Y1 = 33024

// townid → name, decoded from the OTBM's own TOWN nodes (authoritative).
const TOWNS = {
  1: 'Dawnport Tutorial', 2: 'Dawnport', 3: 'Rookgaard', 4: 'Island of Destiny',
  5: "Ab'Dendriel", 6: 'Carlin', 7: 'Kazordoon', 8: 'Thais', 9: 'Venore',
  10: 'Ankrahmun', 11: 'Edron', 12: 'Farmine', 13: 'Darashia', 14: 'Liberty Bay',
  15: 'Port Hope', 16: 'Svargrond', 17: 'Yalahar', 18: 'Gray Beach', 19: 'Krailos',
  20: 'Rathleton', 21: 'Roshamuul', 22: 'Issavi', 24: 'Cobra Bastion', 25: 'Bounac',
  26: 'Feyrist', 27: 'Gnomprona', 28: 'Marapur', 29: 'Candia', 30: 'Silvertides', 31: 'Moonfall',
}

async function main() {
  console.log('fetching otservbr-house.xml …')
  const xml = await fetch(HOUSE_XML, { headers: { 'User-Agent': 'TibiaAtlas-ETL' } }).then(r => {
    if (!r.ok) throw new Error('house.xml HTTP ' + r.status)
    return r.text()
  })

  const re = /<house\b([^>]*)\/?>/g
  const attr = (s, k) => { const m = s.match(new RegExp(`\\b${k}="([^"]*)"`)); return m ? m[1] : null }
  const houses = []
  let total = 0, skipped = 0
  let m
  while ((m = re.exec(xml))) {
    total++
    const a = m[1]
    const id = +(attr(a, 'clientid') || 0)         // real Tibia house id
    const x = +attr(a, 'entryx'), y = +attr(a, 'entryy'), z = +attr(a, 'entryz')
    if (!id || !Number.isFinite(x) || !Number.isFinite(y)) { skipped++; continue }
    if (x < X0 || x >= X1 || y < Y0 || y >= Y1) { skipped++; continue } // off the rendered map
    houses.push({
      id,
      name: attr(a, 'name') || `House ${id}`,
      x, y, z,
      town: TOWNS[+attr(a, 'townid')] || null,
      rent: +(attr(a, 'rent') || 0),
      size: +(attr(a, 'size') || 0),
      beds: +(attr(a, 'beds') || 0),
      guild: attr(a, 'guildhall') === 'true' ? 1 : 0,
    })
  }
  houses.sort((h1, h2) => h1.id - h2.id)

  console.log(`  ${total} houses in xml, ${houses.length} kept, ${skipped} off-map/invalid`)
  const towns = {}
  for (const h of houses) towns[h.town || '?'] = (towns[h.town || '?'] || 0) + 1
  console.log('  by town:', JSON.stringify(towns))
  console.log('  sample:', JSON.stringify(houses.slice(0, 3)))

  fs.writeFileSync(OUT, JSON.stringify({ updated: null, houses }))
  console.log('wrote', path.relative(root, OUT), `(${houses.length} houses)`)
}

main().catch(e => { console.error(e); process.exit(1) })
