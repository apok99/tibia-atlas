import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type LightboxProps = {
  src: string
  alt?: string
  caption?: string
  onClose: () => void
}

/**
 * Fullscreen image viewer. Click the dimmed backdrop or press Esc to close;
 * click the image (or use the zoom buttons / mouse wheel) to magnify, and
 * drag to pan once zoomed in.
 */
export function Lightbox({ src, alt, caption, onClose }: LightboxProps) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  const reset = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const zoomBy = useCallback((delta: number) => {
    setScale((s) => {
      const next = Math.min(6, Math.max(1, +(s + delta).toFixed(2)))
      if (next === 1) setOffset({ x: 0, y: 0 })
      return next
    })
  }, [])

  // Close on Esc, lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === '+' || e.key === '=') zoomBy(0.5)
      else if (e.key === '-') zoomBy(-0.5)
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose, zoomBy])

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    zoomBy(e.deltaY < 0 ? 0.4 : -0.4)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (scale === 1) return
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    setOffset({
      x: dragRef.current.ox + (e.clientX - dragRef.current.x),
      y: dragRef.current.oy + (e.clientY - dragRef.current.y),
    })
  }
  const onPointerUp = () => {
    dragRef.current = null
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex flex-col bg-black/85 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      {/* Toolbar */}
      <div
        className="flex items-center justify-end gap-1 p-3 text-white/90"
        onClick={(e) => e.stopPropagation()}
      >
        <ToolBtn label="−" title="Zoom out" onClick={() => zoomBy(-0.5)} />
        <span className="w-12 text-center font-mono text-xs tabular-nums">
          {Math.round(scale * 100)}%
        </span>
        <ToolBtn label="+" title="Zoom in" onClick={() => zoomBy(0.5)} />
        <ToolBtn label="⟳" title="Reset" onClick={reset} />
        <ToolBtn label="✕" title="Close" onClick={onClose} />
      </div>

      {/* Stage */}
      <div
        className="flex flex-1 items-center justify-center overflow-hidden p-4"
        onWheel={onWheel}
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={alt ?? ''}
          draggable={false}
          onClick={() => (scale === 1 ? zoomBy(1) : reset())}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            cursor: scale === 1 ? 'zoom-in' : dragRef.current ? 'grabbing' : 'grab',
          }}
          className="max-h-full max-w-full select-none object-contain transition-transform duration-100 will-change-transform"
        />
      </div>

      {caption && (
        <div
          className="px-4 pb-4 text-center text-xs font-bold uppercase tracking-wider text-white/70"
          onClick={(e) => e.stopPropagation()}
        >
          {caption}
        </div>
      )}
    </div>,
    document.body,
  )
}

function ToolBtn({
  label,
  title,
  onClick,
}: {
  label: string
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="grid h-9 w-9 place-items-center rounded border border-white/20 bg-white/5 text-base leading-none transition hover:bg-white/15"
    >
      {label}
    </button>
  )
}
