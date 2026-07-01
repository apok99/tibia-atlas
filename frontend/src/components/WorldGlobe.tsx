import { useEffect, useRef } from 'react'
import Globe from 'globe.gl'

// Surface floor (7) of Tibia as a full 10×8 grid of 256px minimap tiles,
// composited onto a 2:1 equirectangular canvas and handed to globe.gl as the
// globe image. The map is drawn to COVER the texture at a uniform (square-tile)
// scale, cropping a sliver of the poles so it fills the whole sphere.
const X = [31744, 32000, 32256, 32512, 32768, 33024, 33280, 33536, 33792, 34048]
const Y = [30976, 31232, 31488, 31744, 32000, 32256, 32512, 32768]
const FLOOR = 7
const COLS = X.length
const ROWS = Y.length
const TEX_W = 4096
const TEX_H = 2048
const OCEAN = '#22506b'
const DTILE_W = TEX_W / COLS
const DTILE_H = DTILE_W
const MAP_H = DTILE_H * ROWS
const MAP_X = 0
const MAP_Y = (TEX_H - MAP_H) / 2

const LEAN = (-23.5 * Math.PI) / 180 // desk-globe tilt, leaning right

// Creature "spawn" markers scattered over the continent — decorative for now;
// swap in real spawn coordinates later. globe.gl pins them to the surface as
// dots and pulsing rings, and they hide correctly behind the globe.
const MARKERS: { lat: number; lng: number }[] = [
  { lat: 12, lng: -8 }, { lat: -6, lng: 14 }, { lat: 24, lng: 6 }, { lat: 2, lng: -26 },
  { lat: -18, lng: -4 }, { lat: 30, lng: 22 }, { lat: -10, lng: 34 }, { lat: 16, lng: 48 },
  { lat: -24, lng: 20 }, { lat: 8, lng: -42 }, { lat: -2, lng: 58 }, { lat: 20, lng: -30 },
]

/**
 * The Tibia world as a globe, built on globe.gl (three-globe). The library
 * gives us the material, a real atmosphere, smooth drag/zoom controls and the
 * points/rings marker layers; we add the Tibia texture, an axial lean and a
 * slow auto-rotation on top.
 */
export function WorldGlobe({ diameter = 500 }: { diameter?: number }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const world = new Globe(el, { rendererConfig: { antialias: true, alpha: true }, animateIn: false })
      .width(diameter)
      .height(diameter)
      .backgroundColor('rgba(0,0,0,0)')
      .showAtmosphere(true)
      .atmosphereColor('#8fbce8')
      .atmosphereAltitude(0.2)
      .pointsData(MARKERS)
      .pointLat('lat')
      .pointLng('lng')
      .pointColor(() => '#e0533b')
      .pointAltitude(0.012)
      .pointRadius(0.42)
      .pointsMerge(false)
      .ringsData(MARKERS)
      .ringColor(() => (t: number) => `rgba(224,83,59,${Math.sqrt(1 - t)})`)
      .ringMaxRadius(2.4)
      .ringPropagationSpeed(1.1)
      .ringRepeatPeriod(1700)

    // Composite the minimap into the globe texture (ocean base while tiles load).
    const canvas = document.createElement('canvas')
    canvas.width = TEX_W
    canvas.height = TEX_H
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = OCEAN
    ctx.fillRect(0, 0, TEX_W, TEX_H)
    world.globeImageUrl(canvas.toDataURL())

    let loaded = 0
    Y.forEach((y, ry) =>
      X.forEach((x, cx) => {
        const img = new Image()
        img.onload = () => {
          ctx.drawImage(img, MAP_X + cx * DTILE_W, MAP_Y + ry * DTILE_H, DTILE_W, DTILE_H)
          loaded += 1
          if (loaded === COLS * ROWS) world.globeImageUrl(canvas.toDataURL())
        }
        img.src = `/minimap/Minimap_Color_${x}_${y}_${FLOOR}.png`
      }),
    )

    // Axial lean, zoomed-in view, and a gentle auto-rotation via OrbitControls.
    world.scene().rotation.z = LEAN
    world.pointOfView({ lat: 6, lng: -12, altitude: 1.7 }, 0)
    const controls = world.controls() as unknown as {
      autoRotate: boolean
      autoRotateSpeed: number
      enableZoom: boolean
      minDistance: number
      maxDistance: number
    }
    controls.autoRotate = true
    controls.autoRotateSpeed = -0.5 // spin to the right
    controls.enableZoom = true
    controls.minDistance = 160
    controls.maxDistance = 480

    // Force a fully transparent canvas — globe.gl's backgroundColor with an
    // alpha can still leave an opaque dark scene background, which reads as a
    // grey box behind the planet. Null the scene bg and clear with alpha 0.
    world.scene().background = null
    world.renderer().setClearColor(0x000000, 0)

    return () => {
      controls.autoRotate = false
      const w = world as unknown as { _destructor?: () => void }
      w._destructor?.()
      el.replaceChildren()
    }
  }, [diameter])

  return <div ref={ref} className="wg-wrap" style={{ width: diameter, height: diameter }} />
}
