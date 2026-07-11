// Adapted from ndom91/open-plan-annotator (MIT licensed) ui/hooks/useKeyboardShortcuts.ts
// — the D/R/S/C selection shortcuts and Cmd/Ctrl+Enter approve/deny logic port unchanged;
// the upstream "D" (no selection) diff-toggle shortcut is dropped since version history /
// DiffViewer isn't part of this vendored scope.
import { useEffect } from 'react'
import type { ToolbarAction } from './AnnotationToolbar'
import type { ResolvedSelection } from './offsetResolver'

interface ShortcutHandlers {
  getSelection: () => ResolvedSelection[] | null
  onAction: (action: ToolbarAction, selections: ResolvedSelection[]) => void
  onApprove: () => void
  onDeny: () => void
  onCancel: () => void
  hasAnnotations: boolean
  decided: boolean
  // Suspend all annotator-level shortcuts (including Escape) while a sub-modal like the sketch
  // canvas or text popover owns the keyboard — otherwise Escape there would also close the whole
  // review, and D/R/S/K would fire behind the modal.
  enabled?: boolean
}

export function useKeyboardShortcuts({ getSelection, onAction, onApprove, onDeny, onCancel, hasAnnotations, decided, enabled = true }: ShortcutHandlers) {
  useEffect(() => {
    if (!enabled) return
    function handleKeyDown(e: KeyboardEvent) {
      // Escape always closes, even while "decided" (submitting) — a stuck full-screen overlay
      // with no other way out is worse than letting someone bail mid-submit.
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
        return
      }

      if (decided) return

      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault()
        onApprove()
        return
      }

      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault()
        if (hasAnnotations) onDeny()
        return
      }

      const sels = getSelection()
      if (!sels) return

      if (e.key.toLowerCase() === 'd' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        onAction('deletion', sels)
        window.getSelection()?.removeAllRanges()
      } else if (e.key.toLowerCase() === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        onAction('comment', sels)
      } else if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        onAction('replacement', sels)
      } else if (e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        onAction('insertion', sels)
      } else if (e.key.toLowerCase() === 'k' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        onAction('sketch', sels)
      } else if (e.key.toLowerCase() === 'e' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        onAction('element', sels)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [getSelection, onAction, onApprove, onDeny, onCancel, hasAnnotations, decided, enabled])
}
