// Structured wireframe/component designer for the plan annotator — the high-fidelity sibling of
// SketchCanvas. Where a sketch is freehand pixels the vision model must interpret, this places
// semantic elements (kind + label) onto device frames, so the planner reads intent deterministically
// from the element tree while the exported clean PNGs (no comment pins) stay a visual backup.
//
// Two modes: BUILD lays out elements across responsive breakpoint frames (one element list, per-frame
// rect overrides), with drag-move, corner/edge resize handles, and snap-to-grid + sibling alignment
// guides; ANNOTATE (reached via "Next") pins free-text notes to individual elements by id. Notes live
// on the element, never in the rendered PNG. A `sketch` element embeds a freehand drawing where a
// labelled rectangle isn't enough. Passing `initialSpec` re-opens an existing wireframe for editing.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ElementKind, FrameId, WireElement, WireframeSpec, WireRect } from './types'
import { SketchCanvas } from './SketchCanvas'

interface WireframeDesignerProps {
  // The plan text this wireframe is anchored to — shown for context, same as the sketch canvas does.
  selectedText: string
  // When editing an existing element annotation (re-opened from the sidebar), its current spec.
  initialSpec?: WireframeSpec
  onSubmit: (spec: WireframeSpec) => void
  onCancel: () => void
}

// Each frame's backing-pixel size — the coordinate space rects are stored in and the resolution the
// clean PNG is exported at, independent of on-screen display size (which scales to fit).
const FRAME_SIZES: Record<FrameId, { w: number; h: number; label: string; tab: string }> = {
  desktop: { w: 1280, h: 800, label: 'Desktop', tab: 'Desktop' },
  tabletLandscape: { w: 1024, h: 768, label: 'Tablet landscape', tab: 'Tablet ▭' },
  tabletPortrait: { w: 768, h: 1024, label: 'Tablet portrait', tab: 'Tablet ▯' },
  phonePortrait: { w: 390, h: 844, label: 'Phone', tab: 'Phone' },
}

// The breakpoints the designer surfaces, largest first. `desktop` is the authoring base every element
// is first placed on and other frames are derived from — keep it first.
const ENABLED_FRAMES: FrameId[] = ['desktop', 'tabletLandscape', 'tabletPortrait', 'phonePortrait']
const BASE_FRAME: FrameId = 'desktop'

// Known kinds get distinct colors so a wireframe reads at a glance and the exported PNG is legible to
// the vision model. Anything outside this map falls back to `box`.
const KIND_STYLE: Record<string, { border: string; fill: string; text: string }> = {
  box:       { border: '#94a3b8', fill: '#f1f5f9', text: '#475569' },
  button:    { border: '#0891b2', fill: '#cffafe', text: '#0e7490' },
  text:      { border: '#a3a3a3', fill: '#fafafa', text: '#525252' },
  image:     { border: '#7c3aed', fill: '#ede9fe', text: '#6d28d9' },
  input:     { border: '#2563eb', fill: '#dbeafe', text: '#1d4ed8' },
  card:      { border: '#059669', fill: '#d1fae5', text: '#047857' },
  nav:       { border: '#d97706', fill: '#fef3c7', text: '#b45309' },
  list:      { border: '#db2777', fill: '#fce7f3', text: '#be185d' },
  container: { border: '#64748b', fill: '#f8fafc', text: '#475569' },
  footer:    { border: '#64748b', fill: '#f1f5f9', text: '#475569' },
  sketch:    { border: '#7c3aed', fill: '#faf5ff', text: '#6d28d9' },
  // Named replicas — grouped by ecosystem, on-theme colors.
  'shopify:product-card':    { border: '#16a34a', fill: '#dcfce7', text: '#15803d' },
  'shopify:collection-grid': { border: '#16a34a', fill: '#f0fdf4', text: '#15803d' },
  'shopify:cart-drawer':     { border: '#16a34a', fill: '#dcfce7', text: '#15803d' },
  'astro:hero':              { border: '#e11d48', fill: '#ffe4e6', text: '#be123c' },
  'astro:nav':               { border: '#e11d48', fill: '#fff1f2', text: '#be123c' },
}
const styleFor = (kind: string) => KIND_STYLE[kind] ?? KIND_STYLE.box
// Short badge for the element box / PNG — strips the ecosystem prefix so "shopify:product-card" reads
// as "PRODUCT-CARD" rather than overflowing.
const kindBadge = (kind: string) => (kind.includes(':') ? kind.split(':')[1] : kind).toUpperCase()

interface PaletteItem { kind: ElementKind; label: string; defaultLabel: string; size: WireRect; sketch?: boolean }
const PALETTE_GROUPS: { group: string; items: PaletteItem[] }[] = [
  { group: 'Primitives', items: [
    { kind: 'container', label: 'Container', defaultLabel: 'Section', size: { x: 40, y: 40, w: 1000, h: 240 } },
    { kind: 'nav',       label: 'Nav',       defaultLabel: 'Navbar',  size: { x: 40, y: 24, w: 1000, h: 64 } },
    { kind: 'card',      label: 'Card',      defaultLabel: 'Card',    size: { x: 40, y: 40, w: 300, h: 220 } },
    { kind: 'image',     label: 'Image',     defaultLabel: 'Image',   size: { x: 40, y: 40, w: 320, h: 200 } },
    { kind: 'text',      label: 'Text',      defaultLabel: 'Heading', size: { x: 40, y: 40, w: 360, h: 48 } },
    { kind: 'button',    label: 'Button',    defaultLabel: 'Button',  size: { x: 40, y: 40, w: 160, h: 48 } },
    { kind: 'input',     label: 'Input',     defaultLabel: 'Field',   size: { x: 40, y: 40, w: 320, h: 48 } },
    { kind: 'list',      label: 'List',      defaultLabel: 'List',    size: { x: 40, y: 40, w: 320, h: 240 } },
    { kind: 'box',       label: 'Box',       defaultLabel: 'Box',     size: { x: 40, y: 40, w: 200, h: 120 } },
    { kind: 'footer',    label: 'Footer',    defaultLabel: 'Footer',  size: { x: 40, y: 700, w: 1200, h: 100 } },
  ] },
  { group: 'Shopify', items: [
    { kind: 'shopify:product-card',    label: 'Product card', defaultLabel: 'Product',    size: { x: 40, y: 40, w: 280, h: 380 } },
    { kind: 'shopify:collection-grid', label: 'Collection',   defaultLabel: 'Collection', size: { x: 40, y: 40, w: 1000, h: 500 } },
    { kind: 'shopify:cart-drawer',     label: 'Cart drawer',  defaultLabel: 'Cart',       size: { x: 960, y: 0, w: 320, h: 800 } },
  ] },
  { group: 'Astro', items: [
    { kind: 'astro:hero', label: 'Hero',    defaultLabel: 'Hero',    size: { x: 0, y: 64, w: 1280, h: 420 } },
    { kind: 'astro:nav',  label: 'Nav bar', defaultLabel: 'Nav',     size: { x: 0, y: 0, w: 1280, h: 64 } },
  ] },
  { group: 'Freehand', items: [
    { kind: 'sketch', label: 'Sketch', defaultLabel: 'Sketch', size: { x: 40, y: 40, w: 360, h: 260 }, sketch: true },
  ] },
]
const ALL_PALETTE = PALETTE_GROUPS.flatMap((g) => g.items)

const DISPLAY_MAX_W = 640 // on-screen frame cap; backing coords scale by (displayW / frame.w)
const GRID = 8            // snap-to-grid step, backing px
const SNAP = 9            // sibling/edge snap threshold, backing px
const MIN_SIZE = 16       // smallest element dimension, backing px

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max))
const snapToGrid = (v: number) => Math.round(v / GRID) * GRID

// Derive a rect for `to` from a rect authored on `from` by uniform width-ratio scaling, clamped inside
// the target frame — a predictable responsive default the user then adjusts per frame.
function deriveRect(r: WireRect, from: FrameId, to: FrameId): WireRect {
  const ratio = FRAME_SIZES[to].w / FRAME_SIZES[from].w
  const F = FRAME_SIZES[to]
  const w = Math.min(r.w * ratio, F.w)
  const h = Math.min(r.h * ratio, F.h)
  return { w, h, x: clamp(r.x * ratio, 0, F.w - w), y: clamp(r.y * ratio, 0, F.h - h) }
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const HANDLES: { id: Handle; cx: number; cy: number; cursor: string }[] = [
  { id: 'nw', cx: 0, cy: 0, cursor: 'nwse-resize' }, { id: 'n', cx: 0.5, cy: 0, cursor: 'ns-resize' },
  { id: 'ne', cx: 1, cy: 0, cursor: 'nesw-resize' }, { id: 'e', cx: 1, cy: 0.5, cursor: 'ew-resize' },
  { id: 'se', cx: 1, cy: 1, cursor: 'nwse-resize' }, { id: 's', cx: 0.5, cy: 1, cursor: 'ns-resize' },
  { id: 'sw', cx: 0, cy: 1, cursor: 'nesw-resize' }, { id: 'w', cx: 0, cy: 0.5, cursor: 'ew-resize' },
]

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

// Draw the element tree for one frame onto a fresh offscreen canvas at backing resolution and return a
// clean image/png data URL — WITHOUT comment pins, so the vision layer sees only the wireframe. Async
// because `sketch` elements embed a drawn PNG that must be preloaded before it can be composited.
async function renderFrame(frame: FrameId, elements: WireElement[]): Promise<string | null> {
  const { w, h } = FRAME_SIZES[frame]
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const sketchImgs = new Map<string, HTMLImageElement>()
  await Promise.all(
    elements.filter((e) => e.sketch && e.rect[frame]).map((e) =>
      loadImage(e.sketch!).then((img) => sketchImgs.set(e.id, img)).catch(() => { /* degrade to box */ })),
  )

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.textBaseline = 'top'
  for (const el of elements) {
    const r = el.rect[frame]
    if (!r) continue
    const img = sketchImgs.get(el.id)
    if (img) {
      // Fit the drawing inside the box (contain), white ground already laid.
      const scale = Math.min(r.w / img.width, r.h / img.height)
      const dw = img.width * scale
      const dh = img.height * scale
      ctx.drawImage(img, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh)
      ctx.strokeStyle = styleFor(el.kind).border
      ctx.lineWidth = 2
      drawRoundedRect(ctx, r.x, r.y, r.w, r.h, 8)
      ctx.stroke()
      continue
    }
    const s = styleFor(el.kind)
    ctx.fillStyle = s.fill
    ctx.strokeStyle = s.border
    ctx.lineWidth = 2
    drawRoundedRect(ctx, r.x, r.y, r.w, r.h, 8)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = s.text
    ctx.font = 'bold 13px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(kindBadge(el.kind), r.x + 8, r.y + 7)
    if (el.label) {
      ctx.font = '15px ui-sans-serif, system-ui, sans-serif'
      ctx.fillText(el.label, r.x + 8, r.y + 24)
    }
  }
  return canvas.toDataURL('image/png')
}

interface Interaction { id: string; type: 'move' | 'resize'; handle?: Handle; startX: number; startY: number; orig: WireRect }

export function WireframeDesigner({ selectedText, initialSpec, onSubmit, onCancel }: WireframeDesignerProps) {
  const [mode, setMode] = useState<'build' | 'annotate'>('build')
  const [activeFrame, setActiveFrame] = useState<FrameId>(BASE_FRAME)
  const [elements, setElements] = useState<WireElement[]>(initialSpec?.elements ?? [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [snap, setSnap] = useState(true)
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  // 'new' opens the sketch canvas to add a fresh sketch element; an id re-draws that element.
  const [sketching, setSketching] = useState<string | null>(null)
  const interactionRef = useRef<Interaction | null>(null)
  const [interacting, setInteracting] = useState(false)

  const frame = FRAME_SIZES[activeFrame]
  const displayW = Math.min(frame.w, DISPLAY_MAX_W)
  const scale = displayW / frame.w
  const displayH = frame.h * scale

  const selected = useMemo(() => elements.find((e) => e.id === selectedId) ?? null, [elements, selectedId])
  const visibleElements = useMemo(() => elements.filter((e) => e.rect[activeFrame]), [elements, activeFrame])

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onCancel])

  const seedRects = useCallback((base: WireRect): WireElement['rect'] => {
    const rect: WireElement['rect'] = {}
    for (const f of ENABLED_FRAMES) rect[f] = f === BASE_FRAME ? base : deriveRect(base, BASE_FRAME, f)
    return rect
  }, [])

  const addFromPalette = useCallback((item: PaletteItem) => {
    if (item.sketch) { setSketching('new'); return }
    setElements((prev) => {
      const offset = (prev.length % 6) * 24
      const base: WireRect = {
        x: clamp(item.size.x + offset, 0, FRAME_SIZES[BASE_FRAME].w - item.size.w),
        y: clamp(item.size.y + offset, 0, FRAME_SIZES[BASE_FRAME].h - item.size.h),
        w: item.size.w,
        h: item.size.h,
      }
      const id = crypto.randomUUID()
      setSelectedId(id)
      return [...prev, { id, kind: item.kind, label: item.defaultLabel, rect: seedRects(base), comments: [] }]
    })
    setActiveFrame(BASE_FRAME)
  }, [seedRects])

  // Finished the embedded sketch canvas: add a new sketch element, or replace an existing one's drawing.
  const handleSketchDone = useCallback((dataUrl: string) => {
    if (sketching === 'new') {
      const item = ALL_PALETTE.find((p) => p.sketch)!
      const base: WireRect = { ...item.size }
      const id = crypto.randomUUID()
      setElements((prev) => [...prev, { id, kind: 'sketch', label: 'Sketch', rect: seedRects(base), comments: [], sketch: dataUrl }])
      setSelectedId(id)
      setActiveFrame(BASE_FRAME)
    } else if (sketching) {
      setElements((prev) => prev.map((e) => (e.id === sketching ? { ...e, sketch: dataUrl } : e)))
    }
    setSketching(null)
  }, [sketching, seedRects])

  const updateRect = useCallback((id: string, patch: Partial<WireRect>) => {
    setElements((prev) => prev.map((el) => {
      if (el.id !== id) return el
      const cur = el.rect[activeFrame] ?? { x: 0, y: 0, w: 100, h: 100 }
      return { ...el, rect: { ...el.rect, [activeFrame]: { ...cur, ...patch } } }
    }))
  }, [activeFrame])

  const toggleShownOnFrame = useCallback((id: string) => {
    setElements((prev) => prev.map((el) => {
      if (el.id !== id) return el
      const rect = { ...el.rect }
      if (rect[activeFrame]) {
        delete rect[activeFrame]
      } else {
        const source = rect[BASE_FRAME] ? BASE_FRAME : (ENABLED_FRAMES.find((f) => rect[f]) ?? BASE_FRAME)
        const src = rect[source]
        rect[activeFrame] = src ? deriveRect(src, source, activeFrame) : { x: 40, y: 40, w: 200, h: 120 }
      }
      return { ...el, rect }
    }))
  }, [activeFrame])

  // Snap a proposed edge value to the grid and to sibling/frame edges + centers, collecting guide
  // lines for whichever axis snapped to a neighbor. Returns the adjusted delta to apply.
  const snapAxis = useCallback((movingEdges: number[], targets: number[]): { delta: number; guide: number | null } => {
    if (!snap) return { delta: 0, guide: null }
    let best: { delta: number; guide: number } | null = null
    for (const e of movingEdges) {
      for (const t of targets) {
        const d = t - e
        if (Math.abs(d) <= SNAP && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, guide: t }
      }
    }
    return best ? { delta: best.delta, guide: best.guide } : { delta: 0, guide: null }
  }, [snap])

  const beginInteraction = useCallback((e: React.PointerEvent, id: string, type: 'move' | 'resize', handle?: Handle) => {
    e.stopPropagation()
    const el = elements.find((x) => x.id === id)
    const r = el?.rect[activeFrame]
    setSelectedId(id)
    if (mode !== 'build' || !r) return
    interactionRef.current = { id, type, handle, startX: e.clientX, startY: e.clientY, orig: r }
    setInteracting(true)
  }, [elements, activeFrame, mode])

  useEffect(() => {
    if (!interacting) return
    const others = () => elements.filter((el) => el.id !== interactionRef.current?.id && el.rect[activeFrame])
      .map((el) => el.rect[activeFrame]!)

    const onMove = (e: PointerEvent) => {
      const it = interactionRef.current
      if (!it) return
      const dx = (e.clientX - it.startX) / scale
      const dy = (e.clientY - it.startY) / scale
      const F = FRAME_SIZES[activeFrame]
      const sibs = others()
      const xTargets = [0, F.w, F.w / 2, ...sibs.flatMap((r) => [r.x, r.x + r.w, r.x + r.w / 2])]
      const yTargets = [0, F.h, F.h / 2, ...sibs.flatMap((r) => [r.y, r.y + r.h, r.y + r.h / 2])]

      if (it.type === 'move') {
        let x = clamp(it.orig.x + dx, 0, F.w - it.orig.w)
        let y = clamp(it.orig.y + dy, 0, F.h - it.orig.h)
        const sx = snapAxis([x, x + it.orig.w, x + it.orig.w / 2], xTargets)
        const sy = snapAxis([y, y + it.orig.h, y + it.orig.h / 2], yTargets)
        x = snap && sx.guide === null ? snapToGrid(x) : x + sx.delta
        y = snap && sy.guide === null ? snapToGrid(y) : y + sy.delta
        x = clamp(x, 0, F.w - it.orig.w)
        y = clamp(y, 0, F.h - it.orig.h)
        setGuides({ x: sx.guide !== null ? [sx.guide] : [], y: sy.guide !== null ? [sy.guide] : [] })
        setElements((prev) => prev.map((el) => (el.id === it.id ? { ...el, rect: { ...el.rect, [activeFrame]: { ...it.orig, x, y } } } : el)))
        return
      }

      // resize — adjust the edges the handle controls, grid-snapped, honoring MIN_SIZE.
      const h = it.handle!
      let { x, y, w, h: hh } = it.orig
      if (h.includes('e')) w = snap ? snapToGrid(it.orig.w + dx) : it.orig.w + dx
      if (h.includes('s')) hh = snap ? snapToGrid(it.orig.h + dy) : it.orig.h + dy
      if (h.includes('w')) { const nx = snap ? snapToGrid(it.orig.x + dx) : it.orig.x + dx; w = it.orig.x + it.orig.w - nx; x = nx }
      if (h.includes('n')) { const ny = snap ? snapToGrid(it.orig.y + dy) : it.orig.y + dy; hh = it.orig.y + it.orig.h - ny; y = ny }
      if (w < MIN_SIZE) { if (h.includes('w')) x = it.orig.x + it.orig.w - MIN_SIZE; w = MIN_SIZE }
      if (hh < MIN_SIZE) { if (h.includes('n')) y = it.orig.y + it.orig.h - MIN_SIZE; hh = MIN_SIZE }
      x = clamp(x, 0, F.w); y = clamp(y, 0, F.h)
      w = clamp(w, MIN_SIZE, F.w - x); hh = clamp(hh, MIN_SIZE, F.h - y)
      setElements((prev) => prev.map((el) => (el.id === it.id ? { ...el, rect: { ...el.rect, [activeFrame]: { x, y, w, h: hh } } } : el)))
    }

    const onUp = () => { interactionRef.current = null; setInteracting(false); setGuides({ x: [], y: [] }) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [interacting, elements, activeFrame, scale, snap, snapAxis])

  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    setElements((prev) => prev.filter((e) => e.id !== selectedId))
    setSelectedId(null)
  }, [selectedId])

  const addNote = useCallback(() => {
    const text = noteDraft.trim()
    if (!text || !selectedId) return
    setElements((prev) => prev.map((el) => (el.id === selectedId ? { ...el, comments: [...el.comments, text] } : el)))
    setNoteDraft('')
  }, [noteDraft, selectedId])

  const removeNote = useCallback((id: string, index: number) => {
    setElements((prev) => prev.map((el) => (el.id === id ? { ...el, comments: el.comments.filter((_, i) => i !== index) } : el)))
  }, [])

  const [saving, setSaving] = useState(false)
  const handleSave = useCallback(async () => {
    if (elements.length === 0 || saving) return
    setSaving(true)
    try {
      const frames = ENABLED_FRAMES.filter((f) => elements.some((e) => e.rect[f]))
      const renders: WireframeSpec['renders'] = {}
      for (const f of frames) {
        const png = await renderFrame(f, elements)
        if (png) renders[f] = png
      }
      onSubmit({ frames, elements, renders })
    } finally {
      setSaving(false)
    }
  }, [elements, onSubmit, saving])

  const totalNotes = useMemo(() => elements.reduce((n, e) => n + e.comments.length, 0), [elements])

  const paletteBtn = 'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-cyan-500/50 transition-colors'
  const numInput = 'w-full px-1.5 py-1 text-[11px] rounded border border-border bg-background text-foreground'

  return (
    <div role="presentation" className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 overscroll-contain p-4" onClick={onCancel}>
      <div role="dialog" aria-label="Design a UI wireframe" aria-modal="true" className="bg-card border border-border rounded-xl shadow-xl overflow-hidden w-full max-w-5xl flex flex-col max-h-[92vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border flex-shrink-0 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Design a UI wireframe</h3>
            <p className="text-[11px] text-muted-foreground truncate">For: “{selectedText}”</p>
          </div>
          <div className="flex-shrink-0 flex items-center gap-1 text-[10px] font-semibold">
            <span className={mode === 'build' ? 'px-2 py-1 rounded-md bg-cyan-500/15 text-cyan-500' : 'px-2 py-1 rounded-md text-muted-foreground'}>1 · Build</span>
            <span className="text-muted-foreground">→</span>
            <span className={mode === 'annotate' ? 'px-2 py-1 rounded-md bg-cyan-500/15 text-cyan-500' : 'px-2 py-1 rounded-md text-muted-foreground'}>2 · Notes</span>
          </div>
        </div>

        {/* Breakpoint tabs + snap toggle */}
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border flex-shrink-0 overflow-x-auto">
          <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mr-1 flex-shrink-0">Frame</span>
          {ENABLED_FRAMES.map((f) => {
            const count = elements.filter((e) => e.rect[f]).length
            const isActive = f === activeFrame
            return (
              <button
                key={f}
                type="button"
                onClick={() => setActiveFrame(f)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${isActive ? 'bg-cyan-500/15 text-cyan-500 border border-cyan-500/40' : 'text-muted-foreground hover:text-foreground border border-transparent'}`}
              >
                {FRAME_SIZES[f].tab}
                <span className={`font-mono text-[9px] px-1 rounded ${isActive ? 'bg-cyan-500/20' : 'bg-muted'}`}>{count}</span>
              </button>
            )
          })}
          {mode === 'build' && (
            <button
              type="button"
              onClick={() => setSnap((v) => !v)}
              title="Snap to grid & align to other elements"
              className={`ml-auto flex-shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${snap ? 'bg-cyan-500/15 text-cyan-500 border-cyan-500/40' : 'text-muted-foreground hover:text-foreground border-border'}`}
            >
              Snap {snap ? 'on' : 'off'}
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* Palette — build mode only */}
          {mode === 'build' && (
            <div className="w-40 flex-shrink-0 border-r border-border p-2 space-y-2 overflow-y-auto">
              {PALETTE_GROUPS.map((grp) => (
                <div key={grp.group} className="space-y-1">
                  <span className="block px-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">{grp.group}</span>
                  {grp.items.map((item) => (
                    <button key={item.kind} type="button" onClick={() => addFromPalette(item)} className={paletteBtn}>
                      <span className="h-2.5 w-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: styleFor(item.kind).border }} />
                      {item.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Frame */}
          <div className="flex-1 min-w-0 overflow-auto bg-muted/40 p-6 flex items-start justify-center">
            <div className="flex flex-col items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{frame.label} · {frame.w}×{frame.h}</span>
              <div
                onClick={() => setSelectedId(null)}
                className="relative bg-white rounded-lg border border-border shadow-inner overflow-hidden"
                style={{ width: displayW, height: displayH }}
              >
                {visibleElements.map((el) => {
                  const r = el.rect[activeFrame]!
                  const s = styleFor(el.kind)
                  const isSel = el.id === selectedId
                  const noteCount = el.comments.length
                  return (
                    <div
                      key={el.id}
                      onPointerDown={(e) => beginInteraction(e, el.id, 'move')}
                      onClick={(e) => { e.stopPropagation(); setSelectedId(el.id) }}
                      className={`absolute rounded-md touch-none overflow-hidden ${mode === 'build' ? 'cursor-move' : 'cursor-pointer'} ${isSel ? 'ring-2 ring-cyan-500 z-10' : ''}`}
                      style={{
                        left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale,
                        backgroundColor: el.sketch ? '#ffffff' : s.fill, border: `2px solid ${s.border}`, color: s.text,
                      }}
                    >
                      {el.sketch ? (
                        <img src={el.sketch} alt={el.label} className="w-full h-full object-contain pointer-events-none" />
                      ) : (
                        <>
                          <div className="px-1.5 pt-1 text-[8px] font-bold uppercase tracking-wide leading-none">{kindBadge(el.kind)}</div>
                          {el.label && <div className="px-1.5 pt-0.5 text-[10px] leading-tight truncate">{el.label}</div>}
                        </>
                      )}
                      {mode === 'annotate' && noteCount > 0 && (
                        <div className="absolute top-0.5 right-0.5 min-w-3.5 h-3.5 px-1 rounded-full bg-cyan-600 text-white text-[9px] font-bold flex items-center justify-center leading-none">{noteCount}</div>
                      )}
                      {/* Resize handles — build mode, selected element only. */}
                      {mode === 'build' && isSel && HANDLES.map((hd) => (
                        <div
                          key={hd.id}
                          onPointerDown={(e) => beginInteraction(e, el.id, 'resize', hd.id)}
                          className="absolute w-2.5 h-2.5 bg-white border border-cyan-500 rounded-sm"
                          style={{ left: `calc(${hd.cx * 100}% - 5px)`, top: `calc(${hd.cy * 100}% - 5px)`, cursor: hd.cursor, touchAction: 'none' }}
                        />
                      ))}
                    </div>
                  )
                })}
                {/* Alignment guides */}
                {guides.x.map((gx, i) => (
                  <div key={`gx${i}`} className="absolute top-0 bottom-0 w-px bg-cyan-500/70 pointer-events-none" style={{ left: gx * scale }} />
                ))}
                {guides.y.map((gy, i) => (
                  <div key={`gy${i}`} className="absolute left-0 right-0 h-px bg-cyan-500/70 pointer-events-none" style={{ top: gy * scale }} />
                ))}
                {visibleElements.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-400 select-none pointer-events-none text-center px-4">
                    {mode === 'build'
                      ? (elements.length === 0 ? 'Click an element on the left to place it' : `No elements on ${frame.label} — add one, or toggle an element on via its properties`)
                      : 'No elements on this frame'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right panel: properties (build) or notes (annotate) */}
          <div className="w-52 flex-shrink-0 border-l border-border p-3 overflow-y-auto">
            {mode === 'build' ? (
              <>
                <span className="block text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Properties</span>
                {!selected ? (
                  <p className="text-[11px] text-muted-foreground">Select an element to edit it. Drag to move, grab a handle to resize.</p>
                ) : (
                  <div className="space-y-2.5">
                    <label className="block">
                      <span className="text-[10px] text-muted-foreground">Label</span>
                      <input
                        type="text"
                        value={selected.label}
                        onChange={(e) => setElements((prev) => prev.map((el) => (el.id === selected.id ? { ...el, label: e.target.value } : el)))}
                        className={`${numInput} mt-0.5`}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-muted-foreground">Kind</span>
                      <select
                        value={selected.kind}
                        onChange={(e) => setElements((prev) => prev.map((el) => (el.id === selected.id ? { ...el, kind: e.target.value as ElementKind } : el)))}
                        className={`${numInput} mt-0.5`}
                      >
                        {PALETTE_GROUPS.map((grp) => (
                          <optgroup key={grp.group} label={grp.group}>
                            {grp.items.map((p) => <option key={p.kind} value={p.kind}>{p.label}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                    {selected.sketch && (
                      <button type="button" onClick={() => setSketching(selected.id)} className="w-full px-2 py-1.5 text-[11px] font-medium rounded-lg border border-violet-500/40 text-violet-500 hover:bg-violet-500/10 transition-colors">
                        Redraw sketch
                      </button>
                    )}
                    {selected.rect[activeFrame] ? (
                      <div className="grid grid-cols-2 gap-1.5">
                        {(['x', 'y', 'w', 'h'] as const).map((dim) => (
                          <label key={dim} className="block">
                            <span className="text-[10px] text-muted-foreground uppercase">{dim}</span>
                            <input
                              type="number"
                              value={Math.round(selected.rect[activeFrame]?.[dim] ?? 0)}
                              onChange={(e) => updateRect(selected.id, { [dim]: Math.max(0, Number(e.target.value) || 0) })}
                              className={`${numInput} mt-0.5`}
                            />
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-muted-foreground">Hidden on {frame.label}.</p>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleShownOnFrame(selected.id)}
                      className="w-full px-2 py-1.5 text-[11px] font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {selected.rect[activeFrame] ? `Hide on ${frame.label}` : `Show on ${frame.label}`}
                    </button>
                    <button type="button" onClick={deleteSelected} className="w-full px-2 py-1.5 text-[11px] font-semibold rounded-lg border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors">
                      Delete element
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <span className="block text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Notes</span>
                {!selected ? (
                  <p className="text-[11px] text-muted-foreground">Click an element on the frame to pin notes to it. Notes are handed to the planner attached to that element — they never appear in the wireframe image.</p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="h-2.5 w-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: styleFor(selected.kind).border }} />
                      <span className="font-semibold text-foreground truncate">{selected.label || kindBadge(selected.kind)}</span>
                    </div>
                    {selected.comments.length > 0 && (
                      <ul className="space-y-1">
                        {selected.comments.map((c, i) => (
                          <li key={i} className="group flex items-start gap-1.5 text-[11px] text-foreground bg-muted/60 rounded px-1.5 py-1">
                            <span className="flex-1 leading-snug">{c}</span>
                            <button type="button" onClick={() => removeNote(selected.id, i)} className="text-muted-foreground hover:text-destructive flex-shrink-0" aria-label="Remove note">✕</button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNote() } }}
                      placeholder="e.g. sticky on scroll; links to /cart"
                      rows={3}
                      className="w-full px-1.5 py-1 text-[11px] rounded border border-border bg-background text-foreground resize-none"
                    />
                    <button
                      type="button"
                      onClick={addNote}
                      disabled={!noteDraft.trim()}
                      className="w-full px-2 py-1.5 text-[11px] font-semibold rounded-lg bg-cyan-600 text-white hover:bg-cyan-600/85 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Add note
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border flex-shrink-0">
          <span className="text-[11px] text-muted-foreground">
            {elements.length} element{elements.length === 1 ? '' : 's'}{totalNotes > 0 ? ` · ${totalNotes} note${totalNotes === 1 ? '' : 's'}` : ''}
          </span>
          <div className="flex items-center gap-2">
            {mode === 'build' ? (
              <>
                <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
                <button
                  type="button"
                  onClick={() => { setSelectedId(null); setMode('annotate') }}
                  disabled={elements.length === 0}
                  className="px-3 py-1.5 text-xs rounded-lg text-white font-semibold bg-cyan-600 hover:bg-cyan-600/85 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Next: add notes →
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => { setSelectedId(null); setMode('build') }} className="px-3 py-1.5 text-xs rounded-lg text-muted-foreground hover:text-foreground transition-colors">← Back to build</button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={elements.length === 0 || saving}
                  className="px-3 py-1.5 text-xs rounded-lg text-white font-semibold bg-cyan-600 hover:bg-cyan-600/85 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? 'Rendering…' : initialSpec ? 'Update wireframe' : 'Attach wireframe'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {sketching && (
        <SketchCanvas
          selectedText={sketching === 'new' ? 'New sketch element' : (selected?.label ?? 'Sketch element')}
          onSubmit={handleSketchDone}
          onCancel={() => setSketching(null)}
        />
      )}
    </div>
  )
}
