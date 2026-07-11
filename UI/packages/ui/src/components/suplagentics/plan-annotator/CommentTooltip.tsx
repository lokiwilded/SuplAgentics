// Adapted from ndom91/open-plan-annotator (MIT licensed) ui/components/CommentTooltip.tsx
// — the positioning math (viewport-aware flip above/below, portal rendering) ported
// unchanged; only the rendered classes are mapped onto SuplAgentics' theme tokens.
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface CommentTooltipProps { comment: string; children: ReactNode }

interface Anchor { top: number; bottom: number; center: number; placement: 'above' | 'below' }
interface Box { left: number; top: number; arrowLeft: number }

const GAP = 8
const MARGIN = 8
const MAX_WIDTH = 320
const MIN_SPACE_ABOVE = 72
const ARROW_INSET = 12

export function CommentTooltip({ comment, children }: CommentTooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [box, setBox] = useState<Box | null>(null)

  const measureAnchor = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const placement: Anchor['placement'] = rect.top >= MIN_SPACE_ABOVE ? 'above' : 'below'
    setAnchor({ top: rect.top, bottom: rect.bottom, center: rect.left + rect.width / 2, placement })
  }, [])

  const show = useCallback(() => measureAnchor(), [measureAnchor])
  const hide = useCallback(() => { setAnchor(null); setBox(null) }, [])

  useLayoutEffect(() => {
    if (!anchor) return
    const tip = tooltipRef.current
    if (!tip) return
    const rect = tip.getBoundingClientRect()
    const width = Math.min(rect.width, MAX_WIDTH)
    const height = rect.height
    const maxLeft = window.innerWidth - MARGIN - width
    const left = Math.min(Math.max(anchor.center - width / 2, MARGIN), Math.max(MARGIN, maxLeft))
    const top = anchor.placement === 'above' ? anchor.top - GAP - height : anchor.bottom + GAP
    const arrowLeft = Math.min(Math.max(anchor.center - left, ARROW_INSET), width - ARROW_INSET)
    setBox({ left, top, arrowLeft })
  }, [anchor])

  useLayoutEffect(() => {
    if (!anchor) return
    const handler = () => measureAnchor()
    window.addEventListener('scroll', handler, true)
    window.addEventListener('resize', handler)
    return () => { window.removeEventListener('scroll', handler, true); window.removeEventListener('resize', handler) }
  }, [anchor, measureAnchor])

  return (
    <span
      ref={triggerRef}
      className="bg-primary/15 border-b-2 border-primary/70 cursor-help"
      role="note"
      aria-label={`Comment: ${comment}`}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {anchor && typeof document !== 'undefined' && createPortal(
        <span
          ref={tooltipRef}
          role="tooltip"
          style={{ position: 'fixed', top: box ? box.top : anchor.top, left: box ? box.left : anchor.center, maxWidth: MAX_WIDTH, visibility: box ? 'visible' : 'hidden' }}
          className="pointer-events-none z-[60] block w-max rounded-md bg-card border border-border px-3 py-2 shadow-lg text-[11px] text-foreground leading-relaxed whitespace-pre-wrap"
        >
          <span
            style={box ? { left: box.arrowLeft } : { left: '50%' }}
            className={anchor.placement === 'above'
              ? 'absolute -translate-x-1/2 top-full w-0 h-0 border-x-[5px] border-x-transparent border-t-[5px] border-t-bdr'
              : 'absolute -translate-x-1/2 bottom-full w-0 h-0 border-x-[5px] border-x-transparent border-b-[5px] border-b-bdr'}
          />
          {comment}
        </span>,
        document.body,
      )}
    </span>
  )
}
