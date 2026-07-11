// Drawing-tablet-friendly sketch surface for the plan annotator. Sits alongside the
// TextInputPopover (CommentPopover.tsx): where a comment/replacement/insertion attaches text to a
// selected span, this attaches a hand-drawn UI sketch. Uses the Pointer Events API directly (no
// deps) so a stylus's real pressure (e.pressure) and pen vs. touch (e.pointerType) drive stroke
// width — a mouse falls back to a constant mid pressure. Exports the drawing as an image/png data
// URL via onSubmit; the server later has the vision agent describe it before the planner sees it.
import { useCallback, useEffect, useRef, useState } from 'react'

interface SketchCanvasProps {
  // The plan text the sketch is anchored to — shown for context, same as the text popover does.
  selectedText: string
  onSubmit: (dataUrl: string) => void
  onCancel: () => void
}

// Fixed backing resolution: the exported PNG is always this size regardless of display size, so the
// vision model gets a consistent, legible image and coordinate math stays simple (see toCanvasXY).
const CANVAS_W = 1024
const CANVAS_H = 700

const COLORS = ['#1e293b', '#dc2626', '#2563eb', '#059669', '#d97706', '#7c3aed'] as const
const SIZES = [
  { label: 'S', width: 2 },
  { label: 'M', width: 4 },
  { label: 'L', width: 8 },
] as const

const UNDO_LIMIT = 25

export function SketchCanvas({ selectedText, onSubmit, onCancel }: SketchCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const drawingRef = useRef(false)
  const lastRef = useRef<{ x: number; y: number } | null>(null)
  const undoStackRef = useRef<ImageData[]>([])

  const [color, setColor] = useState<string>(COLORS[0])
  const [size, setSize] = useState<number>(SIZES[1].width)
  const [erasing, setErasing] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)
  const [canUndo, setCanUndo] = useState(false)

  // Keep the live color/size/erasing available to the imperative pointer handlers without
  // re-binding listeners on every change.
  const styleRef = useRef({ color, size, erasing })
  styleRef.current = { color, size, erasing }

  const fillWhite = useCallback((ctx: CanvasRenderingContext2D) => {
    // A white ground (not transparent) so the exported PNG reads as paper — a transparent PNG
    // flattens to black in some viewers and gives the vision model nothing to work against.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    fillWhite(ctx)
    ctxRef.current = ctx
  }, [fillWhite])

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onCancel])

  const toCanvasXY = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (CANVAS_W / rect.width),
      y: (e.clientY - rect.top) * (CANVAS_H / rect.height),
    }
  }

  const pushUndo = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    undoStackRef.current.push(ctx.getImageData(0, 0, CANVAS_W, CANVAS_H))
    if (undoStackRef.current.length > UNDO_LIMIT) undoStackRef.current.shift()
    setCanUndo(true)
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.preventDefault()
    canvasRef.current?.setPointerCapture(e.pointerId)
    pushUndo()
    drawingRef.current = true
    lastRef.current = toCanvasXY(e)
  }, [pushUndo])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    e.preventDefault()
    const ctx = ctxRef.current
    const last = lastRef.current
    if (!ctx || !last) return
    const { color: c, size: s, erasing: er } = styleRef.current
    // Pen reports 0..1 pressure; mouse/touch usually report 0 or a flat 0.5 — treat a 0 as the
    // neutral mid so non-pen input still draws a sensible constant-width line.
    const pressure = e.pressure > 0 && e.pressure <= 1 ? e.pressure : 0.5
    const point = toCanvasXY(e)
    ctx.strokeStyle = er ? '#ffffff' : c
    ctx.lineWidth = (er ? s * 3 : s) * (0.5 + pressure)
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
    lastRef.current = point
    if (!er) setHasDrawn(true)
  }, [])

  const endStroke = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    drawingRef.current = false
    lastRef.current = null
    try { canvasRef.current?.releasePointerCapture(e.pointerId) } catch { /* pointer already released */ }
  }, [])

  const handleUndo = useCallback(() => {
    const ctx = ctxRef.current
    const prev = undoStackRef.current.pop()
    if (!ctx || !prev) return
    ctx.putImageData(prev, 0, 0)
    setCanUndo(undoStackRef.current.length > 0)
  }, [])

  const handleClear = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    pushUndo()
    fillWhite(ctx)
    setHasDrawn(false)
  }, [fillWhite, pushUndo])

  const handleSave = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !hasDrawn) return
    onSubmit(canvas.toDataURL('image/png'))
  }, [hasDrawn, onSubmit])

  const swatchBtn = 'h-6 w-6 rounded-full border-2 transition-transform hover:scale-110'
  const toolBtn = 'px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors'

  return (
    <div role="presentation" className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 overscroll-contain p-4" onClick={onCancel}>
      <div role="dialog" aria-label="Sketch a UI" aria-modal="true" className="bg-card border border-border rounded-xl shadow-xl overflow-hidden w-full max-w-3xl" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Sketch a UI</h3>
          <p className="text-[11px] text-muted-foreground truncate">For: “{selectedText}”</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border">
          <div className="flex items-center gap-1.5">
            {COLORS.map(c => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                onClick={() => { setColor(c); setErasing(false) }}
                className={`${swatchBtn} ${color === c && !erasing ? 'border-foreground' : 'border-border'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="w-px h-5 bg-border mx-1" />
          <div className="flex items-center gap-1">
            {SIZES.map(s => (
              <button
                key={s.label}
                type="button"
                onClick={() => setSize(s.width)}
                className={`h-6 w-7 rounded-lg border text-[11px] font-semibold transition-colors ${size === s.width ? 'border-foreground text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="w-px h-5 bg-border mx-1" />
          <button type="button" onClick={() => setErasing(v => !v)} className={`${toolBtn} ${erasing ? 'border-foreground text-foreground' : ''}`}>Eraser</button>
          <button type="button" onClick={handleUndo} disabled={!canUndo} className={toolBtn}>Undo</button>
          <button type="button" onClick={handleClear} className={toolBtn}>Clear</button>
        </div>

        <div className="p-4 bg-muted/40">
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onPointerLeave={endStroke}
            // touch-action:none stops the browser from scrolling/zooming the page mid-stroke on a
            // touchscreen or pen display, which would otherwise abort the drag.
            className="w-full h-auto rounded-lg border border-border bg-white shadow-inner cursor-crosshair touch-none"
          />
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasDrawn}
            className="px-3 py-1.5 text-xs rounded-lg text-white font-semibold bg-violet-500 hover:bg-violet-500/85 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Attach sketch
          </button>
        </div>
      </div>
    </div>
  )
}
