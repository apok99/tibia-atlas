import { useEffect, useRef } from 'react'
import * as THREE from 'three'

// Surface floor (7) of Tibia as a full 10×8 grid of 256px minimap tiles,
// composited into one 2560×2048 canvas and wrapped onto a sphere as its texture.
const X = [31744, 32000, 32256, 32512, 32768, 33024, 33280, 33536, 33792, 34048]
const Y = [30976, 31232, 31488, 31744, 32000, 32256, 32512, 32768]
const FLOOR = 7
const COLS = X.length
const ROWS = Y.length

// Equirectangular texture is 2:1 so the sphere's UVs don't stretch it. The map
// is drawn to COVER the whole texture at a uniform (square-tile) scale: it fills
// the full 360° of longitude and, being near-square, slightly overflows top and
// bottom — so we crop a little of the poles rather than leave empty ocean. Full
// globe, no stretch distortion.
const TEX_W = 4096
const TEX_H = 2048
const OCEAN = '#22506b'
const DTILE_W = TEX_W / COLS // square tiles → uniform scale, no distortion
const DTILE_H = DTILE_W
const MAP_H = DTILE_H * ROWS
const MAP_X = 0
const MAP_Y = (TEX_H - MAP_H) / 2 // negative: crops a sliver of N/S to fill height

const AXIAL_TILT = THREE.MathUtils.degToRad(-23.5) // desk-globe tilt, leaning right
const IDLE_SPIN = 0.0014 // rad/frame — gentle, spinning to the right

/**
 * A real 3D globe of the Tibia world: a lit, axis-tilted sphere textured with
 * the surface minimap. Spins like a desk globe (features compress toward the
 * limb as it turns) and can be dragged to rotate. Falls back to just the glow
 * if WebGL is unavailable.
 */
export function WorldGlobe({ diameter = 500 }: { diameter?: number }) {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    } catch {
      return // no WebGL — the atmospheric glow still shows
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(diameter, diameter)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.cursor = 'grab'
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
    camera.position.z = 3.0 // zoomed in to read the map, with room for the halo

    // Composite the minimap tiles into one texture canvas (sea-blue base while
    // the tiles stream in), then wrap it around the sphere.
    const canvas = document.createElement('canvas')
    canvas.width = TEX_W
    canvas.height = TEX_H
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = OCEAN
    ctx.fillRect(0, 0, TEX_W, TEX_H)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy()

    Y.forEach((y, ry) =>
      X.forEach((x, cx) => {
        const img = new Image()
        img.onload = () => {
          ctx.drawImage(img, MAP_X + cx * DTILE_W, MAP_Y + ry * DTILE_H, DTILE_W, DTILE_H)
          texture.needsUpdate = true
        }
        img.src = `/minimap/Minimap_Color_${x}_${y}_${FLOOR}.png`
      }),
    )

    const geometry = new THREE.SphereGeometry(1, 96, 64)
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.92,
      metalness: 0,
      emissive: new THREE.Color(0x1c2b33),
      emissiveIntensity: 0.36, // lift the dark seas so the map reads clearly
    })
    const sphere = new THREE.Mesh(geometry, material)

    // Tilt group holds the axis lean; the sphere spins around its own (tilted) Y.
    const tilt = new THREE.Group()
    tilt.rotation.z = AXIAL_TILT
    tilt.add(sphere)
    scene.add(tilt)

    // Even, soft lighting so the whole map is legible, with a gentle key for form.
    scene.add(new THREE.AmbientLight(0xffffff, 1.12))
    const key = new THREE.DirectionalLight(0xfff4e0, 0.7)
    key.position.set(-1.8, 1.4, 2.4)
    scene.add(key)

    // Atmosphere: a fresnel halo on a slightly larger back-side shell — the touch
    // that reads as "premium". Kept outside the tilt group so it stays centred.
    const atmGeo = new THREE.SphereGeometry(1.1, 64, 48)
    const atmMat = new THREE.ShaderMaterial({
      uniforms: { glowColor: { value: new THREE.Color(0x8fbce8) } },
      vertexShader:
        'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'varying vec3 vN; uniform vec3 glowColor; void main(){ float i = pow(0.62 - dot(vN, vec3(0.0, 0.0, 1.0)), 3.2); i = clamp(i, 0.0, 1.0); gl_FragColor = vec4(glowColor, i); }',
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    })
    const atmosphere = new THREE.Mesh(atmGeo, atmMat)
    scene.add(atmosphere)

    let dragging = false
    let lastX = 0
    let lastY = 0
    let velocity = IDLE_SPIN
    const el = renderer.domElement

    const onDown = (e: PointerEvent) => {
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      el.setPointerCapture?.(e.pointerId)
      el.style.cursor = 'grabbing'
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      sphere.rotation.y += dx * 0.006
      tilt.rotation.x = THREE.MathUtils.clamp(tilt.rotation.x + dy * 0.005, -0.6, 0.6)
      velocity = dx * 0.006
    }
    const onUp = () => {
      dragging = false
      el.style.cursor = 'grab'
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)

    let raf = 0
    const animate = () => {
      if (!dragging) {
        velocity += (IDLE_SPIN - velocity) * 0.03 // ease momentum back to idle
        sphere.rotation.y += velocity
      }
      renderer.render(scene, camera)
      raf = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      geometry.dispose()
      material.dispose()
      atmGeo.dispose()
      atmMat.dispose()
      texture.dispose()
      renderer.dispose()
      if (el.parentNode) el.parentNode.removeChild(el)
    }
  }, [diameter])

  return (
    <div className="wg-wrap" style={{ width: diameter, height: diameter }}>
      <div ref={mountRef} style={{ width: diameter, height: diameter, position: 'relative' }} />
    </div>
  )
}
