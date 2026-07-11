// Adapted from ndom91/open-plan-annotator (MIT licensed) ui/components/AnnotationToolbar.tsx
// — floating toolbar on text selection, positioning and arrow-key navigation logic ported
// unchanged, classes mapped onto SuplAgentics' theme tokens (cn()/clsx/tailwind-merge
// dropped in favor of plain template literals, matching this codebase's existing style).
import { useDeviceInfo } from '@/lib/device'
import type { ResolvedSelection } from './offsetResolver'

export type ToolbarAction = 'deletion' | 'comment' | 'replacement' | 'insertion' | 'sketch' | 'element'

interface AnnotationToolbarProps {
  rect: DOMRect
  selections: ResolvedSelection[]
  onAction: (action: ToolbarAction, selections: ResolvedSelection[]) => void
  onDismiss: () => void
}

export function AnnotationToolbar({ rect, selections, onAction, onDismiss }: AnnotationToolbarProps) {
  // On mobile, positioning next to the selection (as this does on desktop) collides directly
  // with the OS/browser's own native selection popup (Copy/Share/Select all/...), which always
  // renders right next to the selection too — verified live, they stack on top of each other.
  // Pinning to the bottom of the screen instead sidesteps that collision entirely, at the cost of
  // the toolbar no longer tracking exactly where the selection is (an acceptable trade since the
  // selection itself stays visibly highlighted regardless of where this toolbar renders).
  const { isMobile } = useDeviceInfo()
  const top = isMobile ? undefined : rect.top + window.scrollY - 44
  const left = isMobile ? undefined : rect.left + rect.width / 2

  function handleToolbarKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const buttons = (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button')
      const current = Array.from(buttons).indexOf(e.target as HTMLButtonElement)
      if (current === -1) return
      const next = e.key === 'ArrowRight' ? (current + 1) % buttons.length : (current - 1 + buttons.length) % buttons.length
      buttons[next].focus()
    }
  }

  const btn = `flex min-h-9 items-center ${isMobile ? 'gap-1 px-1.5' : 'gap-1.5 px-2'} py-1 rounded-md text-[11px] font-medium cursor-pointer transition-colors`

  return (
    <div
      role="toolbar"
      aria-label="Annotation actions"
      onKeyDown={handleToolbarKeyDown}
      style={isMobile ? undefined : { top, left, transform: 'translateX(-50%)' }}
      className={
        isMobile
          // Fixed to the bottom of the viewport, decoupled entirely from the selection's own
          // position — see the comment above for why. max-w bounded + justify-center so it never
          // overflows a narrow phone screen the way tracking the selection's x-position could.
          ? 'fixed z-50 left-1/2 -translate-x-1/2 bottom-[calc(var(--oc-safe-area-bottom,0px)+16px)] flex items-center justify-center gap-0.5 bg-card rounded-xl border border-border shadow-lg px-1.5 py-1 max-w-[calc(100vw-24px)]'
          : 'absolute z-50 flex items-center gap-1 bg-card rounded-xl border border-border shadow-lg pl-3 pr-1 py-1'
      }
    >
      {!isMobile && (
        <>
          <span className="font-mono text-[9px] font-semibold uppercase tracking-widest text-muted-foreground select-none">Selection</span>
          <div className="w-px h-4 bg-border mx-1" />
        </>
      )}
      <button type="button" onClick={() => { onAction('deletion', selections); onDismiss() }} className={`${btn} text-destructive hover:bg-destructive/10`} title="Delete (D)">
        <kbd className="font-mono text-[10px] px-1 rounded bg-muted border border-border">D</kbd> delete
      </button>
      <button type="button" onClick={() => { onAction('replacement', selections); onDismiss() }} className={`${btn} text-amber-500 hover:bg-amber-500/10`} title="Replace (R)">
        <kbd className="font-mono text-[10px] px-1 rounded bg-muted border border-border">R</kbd> replace
      </button>
      <button type="button" onClick={() => { onAction('insertion', selections); onDismiss() }} className={`${btn} text-emerald-500 hover:bg-emerald-500/10`} title="Insert (S)">
        <kbd className="font-mono text-[10px] px-1 rounded bg-muted border border-border">S</kbd> insert
      </button>
      <button type="button" onClick={() => { onAction('comment', selections); onDismiss() }} className={`${btn} text-primary hover:bg-primary/10`} title="Comment (C)">
        <kbd className="font-mono text-[10px] px-1 rounded bg-muted border border-border">C</kbd> comment
      </button>
      <button type="button" onClick={() => { onAction('sketch', selections); onDismiss() }} className={`${btn} text-violet-500 hover:bg-violet-500/10`} title="Sketch a UI for this (K)">
        <kbd className="font-mono text-[10px] px-1 rounded bg-muted border border-border">K</kbd> sketch
      </button>
      <button type="button" onClick={() => { onAction('element', selections); onDismiss() }} className={`${btn} text-cyan-500 hover:bg-cyan-500/10`} title="Design a UI wireframe for this (E)">
        <kbd className="font-mono text-[10px] px-1 rounded bg-muted border border-border">E</kbd> element
      </button>
    </div>
  )
}
