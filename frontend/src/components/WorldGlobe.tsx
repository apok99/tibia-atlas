import { useEffect, useRef } from 'react'
import * as THREE from 'three'

// Surface floor (7) of Tibia as a full 10×8 grid of 256px minimap tiles,
// composited into one 2560×2048 canvas and wrapped onto a sphere as its texture.
const X = [31744, 32000, 32256, 32512, 32768, 33024, 33280, 33536, 33792, 34048]
const Y = [30976, 31232, 31488, 31744, 32000, 32256, 32512, 32768]
const FLOOR = 7
const TILE = 256
const COLS = X.length
const ROWS = Y.length
const TEX_W = COLS * TILE
const TEX_H = ROWS * TILE
const AXIAL_TILT = THREE.MathUtils.degToRad(23.5) // classic desk-globe tilt
const IDLE_SPIN = 0.0026 // rad/frame, west→east

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
    camera.position.z = 2.9

    // Composite the minimap tiles into one texture canvas (sea-blue base while
    // the tiles stream in), then wrap it around the sphere.
    const canvas = document.createElement('canvas')
    canvas.width = TEX_W
    canvas.height = TEX_H
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#22506b'
    ctx.fillRect(0, 0, TEX_W, TEX_H)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.magFilter = THREE.NearestFilter // crisp pixel-art coastlines
    texture.wrapS = THREE.RepeatWrapping

    Y.forEach((y, ry) =>
      X.forEach((x, cx) => {
        const img = new Image()
        img.onload = () => {
          ctx.drawImage(img, cx * TILE, ry * TILE, TILE, TILE)
          texture.needsUpdate = true
        }
        img.src = `/minimap/Minimap_Color_${x}_${y}_${FLOOR}.png`
      }),
    )

    const geometry = new THREE.SphereGeometry(1, 64, 48)
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 })
    const sphere = new THREE.Mesh(geometry, material)

    // Tilt group holds the axis lean; the sphere spins around its own (tilted) Y.
    const tilt = new THREE.Group()
    tilt.rotation.z = AXIAL_TILT
    tilt.add(sphere)
    scene.add(tilt)

    scene.add(new THREE.AmbientLight(0xffffff, 0.68))
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.05)
    sun.position.set(-2.4, 1.3, 2.2)
    scene.add(sun)

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
      texture.dispose()
      renderer.dispose()
      if (el.parentNode) el.parentNode.removeChild(el)
    }
  }, [diameter])

  return (
    <div className="wg-wrap" style={{ width: diameter, height: diameter }}>
      <span className="wg-glow" />
      <div ref={mountRef} style={{ width: diameter, height: diameter, position: 'relative' }} />
    </div>
  )
}
