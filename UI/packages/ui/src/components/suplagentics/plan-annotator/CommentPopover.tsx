// Adapted from ndom91/open-plan-annotator (MIT licensed) ui/components/CommentPopover.tsx
// (upstream calls it TextInputPopover) — focus trap, Escape-to-close, and Cmd/Ctrl+Enter
// submit logic ported unchanged, classes mapped onto SuplAgentics' theme tokens.
import { useEffect, useRef, useState } from 'react'

interface TextInputPopoverProps {
  mode: 'comment' | 'replacement' | 'insertion'
  selectedText: string
  // Prefill for editing an existing annotation (re-opened from the sidebar). Empty when adding new.
  initialValue?: string
  onSubmit: (text: string) => void
  onCancel: () => void
}

const config = {
  comment:     { title: 'Add Comment',   placeholder: 'What should be changed here?', button: 'Comment', buttonClass: 'bg-primary hover:bg-primary/85' },
  replacement: { title: 'Replace With',  placeholder: 'Enter replacement text…',      button: 'Replace', buttonClass: 'bg-amber-500 hover:bg-amber-500/85' },
  insertion:   { title: 'Insert After',  placeholder: 'Enter text to insert…',        button: 'Insert',  buttonClass: 'bg-emerald-500 hover:bg-emerald-500/85' },
}

export function TextInputPopover({ mode, selectedText, initialValue, onSubmit, onCancel }: TextInputPopoverProps) {
  const [text, setText] = useState(initialValue ?? '')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { title, placeholder, button, buttonClass } = config[mode]

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onCancel])

  useEffect(() => {
    const dialog = inputRef.current?.closest('[role="dialog"]')
    if (!dialog) return
    function handleTrapKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const focusable = dialog!.querySelectorAll<HTMLElement>('textarea, button:not([disabled]), [tabindex]:not([tabindex="-1"])')
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleTrapKeyDown)
    return () => document.removeEventListener('keydown', handleTrapKeyDown)
  }, [])

  function handleSubmit() {
    const trimmed = text.trim()
    if (trimmed) onSubmit(trimmed)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit() }
  }

  return (
    <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 overscroll-contain" onClick={onCancel}>
      <div role="dialog" aria-labelledby="popover-title" aria-modal="true" className="bg-card border border-border rounded-xl shadow-xl overflow-hidden w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
        <div className="p-5">
          <h3 id="popover-title" className="text-sm font-semibold text-foreground mb-1">{title}</h3>
          <p className="text-[11px] text-muted-foreground mb-3 truncate">{mode === 'insertion' ? `After: "${selectedText}"` : `"${selectedText}"`}</p>
          <textarea
            ref={inputRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            aria-label={title}
            rows={3}
            className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-muted text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary transition-colors"
          />
          <div className="flex items-center justify-end gap-2 mt-3">
            <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!text.trim()}
              className={`px-3 py-1.5 text-xs rounded-lg text-white font-semibold disabled:opacity-30 disabled:cursor-not-allowed transition-colors ${buttonClass}`}
            >
              {button}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
