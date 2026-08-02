// Bake the static house layer for the map. TibiaData's houses API gives live
// name/rent/status per world but NO coordinates; the otservbr world files carry
// every house's entry tile plus a `clientid` that IS the real Tibia house id
// TibiaData keys on (verified: "Castle of the Winds" clientid=40112 ==
// TibiaData house_id=40112). So we bake coords+meta from the XML here and let the
// backend ETL layer live rent/auction status on top, joined by id.
//
// The XML's `size` is NOT real Tibia's: otservbr counts every tile the house
// region covers (walls, doorways, decorative edges), so 810 of 993 houses came
// out too big — "Paupers Palace, Flat 27" read 23 sqm against the real 13. Rent,
// beds, town and the guildhall flag DO match (verified against TibiaData: rent
// 993/993, beds 40/40 sampled), so only name/size are taken from TibiaData,
// which reports exactly what the in-game house list shows.
//
//   node tools/otbm/bake-houses.mjs
//   node tools/otbm/bake-houses.mjs --world=Secura   # any world: sizes are global
//
// Source (fetched, not committed):
//   opentibiabr/canary  data-otservbr-global/world/otservbr-house.xml
//   api.tibiadata.com   /v4/houses/{world}/{town}   (authoritative name + size)
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
const TIBIADATA = 'https://api.tibiadata.com'
const WORLD = (process.argv.find(a => a.startsWith('--world=')) || '--world=Antica').slice(8)

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

  await applyRealSizes(houses, Object.keys(towns).filter(t => t !== '?'))

  console.log('  sample:', JSON.stringify(houses.slice(0, 3)))

  fs.writeFileSync(OUT, JSON.stringify({ updated: null, houses }))
  console.log('wrote', path.relative(root, OUT), `(${houses.length} houses)`)
}

/**
 * Overwrite name + size in place with what TibiaData reports for the real game.
 * One request per town of a single world — house names and sizes are identical
 * on every world, only rent status differs, so Antica stands in for all of them.
 * A town the API doesn't know (otservbr has towns real Tibia never rented houses
 * in) is reported, not fatal: those houses keep their XML values.
 */
async function applyRealSizes(houses, townNames) {
  console.log(`checking sizes against TibiaData (${WORLD}) …`)
  const real = new Map()
  const failed = []
  for (const town of townNames) {
    const url = `${TIBIADATA}/v4/houses/${encodeURIComponent(WORLD)}/${encodeURIComponent(town)}`
    let list = null
    for (let attempt = 0; attempt < 3 && list === null; attempt++) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'TibiaAtlas-ETL' } })
        // 400 = "the provided town does not exist"; retrying can't fix that.
        if (r.status === 400) break
        if (!r.ok) throw new Error('HTTP ' + r.status)
        const j = await r.json()
        list = [...(j.houses?.house_list ?? []), ...(j.houses?.guildhall_list ?? [])]
      } catch (e) {
        if (attempt === 2) console.warn(`  ${town}: ${e.message}`)
        else await new Promise(s => setTimeout(s, 1500))
      }
    }
    if (!list) { failed.push(town); continue }
    for (const h of list) if (h.house_id) real.set(h.house_id, h)
    await new Promise(s => setTimeout(s, 200))
  }
  // Nothing came back at all → the API is down. Writing XML sizes would silently
  // reintroduce the very numbers this step exists to correct.
  if (!real.size) throw new Error('TibiaData returned no houses — refusing to bake XML sizes')

  let sizeFixed = 0, nameFixed = 0, unmatched = 0
  for (const h of houses) {
    const r = real.get(h.id)
    if (!r) { unmatched++; continue }
    if (r.size && r.size !== h.size) { h.size = r.size; sizeFixed++ }
    if (r.name && r.name !== h.name) { h.name = r.name; nameFixed++ }
  }
  console.log(`  ${real.size} houses from TibiaData: ${sizeFixed} sizes corrected, ${nameFixed} names corrected`)
  if (unmatched) console.log(`  ${unmatched} house(s) not in TibiaData — kept XML values`)
  if (failed.length) console.log(`  towns skipped (unknown to TibiaData): ${failed.join(', ')}`)
}

main().catch(e => { console.error(e); process.exit(1) })
