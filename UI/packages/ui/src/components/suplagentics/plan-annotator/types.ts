// Ported from ndom91/open-plan-annotator (MIT licensed) server/types.ts — the Annotation
// shape is the load-bearing contract between selection resolution, the annotation list,
// and the CriticMarkup serializer. Kept identical to upstream so the serializer (ported
// separately into server/lib/criticmarkup.js / ui/lib/criticmarkup.ts) doesn't drift.
export interface Annotation {
  id: string
  type: 'deletion' | 'comment' | 'insertion' | 'replacement' | 'sketch' | 'element'
  text: string
  comment?: string
  replacement?: string
  // Data URL (image/png) of a UI sketch drawn against the selected span — only set when
  // type === 'sketch'. The server describes it via the vision agent before feeding the planner.
  sketch?: string
  // Structured wireframe spec — only set when type === 'element'. Unlike a freehand sketch, this
  // carries the semantic element tree (kind + label + per-frame layout) so the planner reads intent
  // deterministically rather than guessing from pixels; the clean per-frame PNG renders are a visual
  // backup. See WireframeSpec.
  element?: WireframeSpec
  blockIndex: number
  startOffset: number
  endOffset: number
  createdAt: string
}

// The wireframe/component designer's output. A structured superset of the freehand `sketch`:
// the element tree is authoritative (fed to the planner as deterministic markdown) and `renders`
// are clean per-frame PNGs (no comment pins baked in) the vision agent consults for exact visuals.

// Open registry — string-widened so named Astro/Shopify component replicas slot in later without a
// data-model change. The known primitives get nicer default rendering; anything else still round-trips.
export type ElementKind =
  | 'box' | 'button' | 'text' | 'image' | 'input'
  | 'card' | 'nav' | 'list' | 'container'
  | (string & {})

// The device frames the designer can lay out on one canvas. Rects are stored per frame so one
// element list drives every viewport (responsive overrides), not a separate document per size.
export type FrameId = 'desktop' | 'tabletLandscape' | 'tabletPortrait' | 'phonePortrait'

// A box in a frame's own backing-pixel coordinate space (see FRAME_SIZES in WireframeDesigner).
export interface WireRect { x: number; y: number; w: number; h: number }

export interface WireElement {
  id: string
  kind: ElementKind
  label: string
  // Per-frame layout. An element absent from a frame simply isn't shown there.
  rect: Partial<Record<FrameId, WireRect>>
  // Notes anchored to THIS element by id — deliberately kept out of the rendered PNG so the vision
  // layer never sees comment clutter, while the planner still knows exactly what each note attaches to.
  comments: string[]
  // Optional freehand PNG (image/png data URL) drawn for this element — set when kind === 'sketch'.
  // Rendered inside the element's box on the frame, so a wireframe can carry hand-drawn detail where a
  // labelled rectangle isn't enough.
  sketch?: string
}

export interface WireframeSpec {
  frames: FrameId[]
  elements: WireElement[]
  // Clean image/png data URLs per frame, no comment pins. Optional per frame — a frame with no
  // elements need not be rendered.
  renders: Partial<Record<FrameId, string>>
}
