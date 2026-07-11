// Simplified, embedded replacement for ndom91/open-plan-annotator's App.tsx (MIT licensed).
// Core annotation mechanics (selection -> toolbar -> popover -> annotation list ->
// approve/deny) ported faithfully; dropped entirely: ThemeProvider (this dashboard has its
// own dark/light via a .dark class), Header/DocumentChrome/VersionSidebar/TableOfContents/
// UpdateBanner/DiffViewer (upstream is a standalone full-page app with version history and
// an update-checker; here this renders as a modal inside the Improvement page reviewing a
// single suggestion, not a multi-version document). approve()/deny() are callback props —
// this component has no fetch/routing logic of its own, unlike upstream's useDecision hook
// which called fixed /api/approve /api/deny endpoints.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDeviceInfo } from '@/lib/device'
import { useMessageTTS } from '@/hooks/useMessageTTS'
import { statFileMtime } from '@/lib/openchamberConfig'
import { Icon } from '@/components/icon/Icon'
import { useAnnotations } from './useAnnotations'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'
import { useTextSelection } from './useTextSelection'
import { parseMarkdownToBlocks } from './markdown'
import { type ResolvedSelection, resolveSelection } from './offsetResolver'
import { AnnotationSidebar } from './AnnotationSidebar'
import { AnnotationToolbar, type ToolbarAction } from './AnnotationToolbar'
import { TextInputPopover } from './CommentPopover'
import { SketchCanvas } from './SketchCanvas'
import { WireframeDesigner } from './WireframeDesigner'
import { PlanDocument } from './PlanDocument'
import type { Annotation } from './types'

interface PlanAnnotatorProps {
  title: string
  plan: string
  planKey: string
  onApprove: (annotations: Annotation[]) => void | Promise<void>
  // Resolves to whether the feedback actually sent — false/rejects means annotations are
  // preserved and the annotator stays open so the user can retry, instead of silently losing
  // their review because of a transient send failure.
  onDeny: (annotations: Annotation[]) => Promise<boolean>
  onCancel: () => void
  // Optional: when reviewing a real plan file on disk (the Plans panel), pass its path plus a
  // reload callback. The annotator watches the file's mtime and, if it changes while open (e.g.
  // the planner revises it), shows a "This plan has been updated" banner — clicking Refresh calls
  // onReload to pull the new content in. Omitted by the Improvement page (its plans are transient
  // suggestion bodies, not files), which simply gets no banner.
  planPath?: string
  onReload?: () => void | Promise<void>
}

export default function PlanAnnotator({ title, plan, planKey, onApprove, onDeny, onCancel, planPath, onReload }: PlanAnnotatorProps) {
  const { isMobile } = useDeviceInfo()
  // Reuses OpenChamber's own existing TTS system (voice provider, rate/pitch/voice all already
  // configured on the Voice settings page) rather than building a separate speech mechanism —
  // this is the same hook chat messages already use to read a reply aloud.
  const { isPlaying: isSpeaking, play: speak, stop: stopSpeaking } = useMessageTTS()
  const { annotations, addDeletion, addComment, addReplacement, addInsertion, addSketch, addElement, updateAnnotation, removeAnnotation, clearAnnotations } = useAnnotations(planKey)
  const selection = useTextSelection()
  const [working, setWorking] = useState<'approve' | 'deny' | null>(null)
  // Desktop shows the annotation list in a permanent side column (no room to spare on mobile for
  // that, so it's a toggleable overlay there instead — otherwise there was no way at all to see
  // or remove an annotation once made on a phone).
  const [mobileAnnotationsOpen, setMobileAnnotationsOpen] = useState(false)

  const [popover, setPopover] = useState<{ mode: 'comment' | 'replacement' | 'insertion'; selections: ResolvedSelection[] } | null>(null)
  // A sketch is one drawing anchored to one span (unlike text notes, which fan out across every
  // selected range), so we hold just the first selection while the canvas is open.
  const [sketchSel, setSketchSel] = useState<ResolvedSelection | null>(null)
  // A wireframe, like a sketch, is one artifact anchored to one span — hold the first selection
  // while the designer is open.
  const [elementSel, setElementSel] = useState<ResolvedSelection | null>(null)

  // Editing an existing annotation (re-opened by clicking it in the sidebar). Each holds the target
  // annotation id; on submit we patch that annotation in place rather than adding a new one.
  const [editText, setEditText] = useState<{ id: string; mode: 'comment' | 'replacement' | 'insertion'; text: string; initial: string } | null>(null)
  const [editSketchId, setEditSketchId] = useState<string | null>(null)
  const [editElement, setEditElement] = useState<{ id: string; spec: NonNullable<Annotation['element']>; text: string } | null>(null)

  const handleEditAnnotation = useCallback((ann: Annotation) => {
    if (ann.type === 'comment') setEditText({ id: ann.id, mode: 'comment', text: ann.text, initial: ann.comment ?? '' })
    else if (ann.type === 'replacement') setEditText({ id: ann.id, mode: 'replacement', text: ann.text, initial: ann.replacement ?? '' })
    else if (ann.type === 'insertion') setEditText({ id: ann.id, mode: 'insertion', text: ann.text, initial: ann.replacement ?? '' })
    else if (ann.type === 'sketch') setEditSketchId(ann.id)
    else if (ann.type === 'element' && ann.element) setEditElement({ id: ann.id, spec: ann.element, text: ann.text })
    // 'deletion' has nothing to edit — no-op.
  }, [])

  const anyEditOpen = editText !== null || editSketchId !== null || editElement !== null

  // Staleness detection: record the file's mtime at (re)load time, poll it, and flag when the file
  // on disk has advanced past what's shown. `plan` changing (a reload happened) resets the baseline.
  const [isStale, setIsStale] = useState(false)
  const [reloading, setReloading] = useState(false)
  const loadedMtimeRef = useRef<number | null>(null)
  const baselineInitedRef = useRef(false)

  useEffect(() => {
    // Reset the baseline whenever the shown content changes (initial open, or after a refresh).
    baselineInitedRef.current = false
    setIsStale(false)
  }, [plan])

  useEffect(() => {
    if (!planPath || !onReload) return
    let cancelled = false
    const check = async () => {
      const mtime = await statFileMtime(planPath)
      if (cancelled || mtime === null) return
      if (!baselineInitedRef.current) {
        loadedMtimeRef.current = mtime
        baselineInitedRef.current = true
        return
      }
      if (loadedMtimeRef.current !== null && mtime > loadedMtimeRef.current) {
        setIsStale(true)
      }
    }
    void check()
    const timer = window.setInterval(() => void check(), 5000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [planPath, onReload, plan])

  const handleRefreshStale = useCallback(async () => {
    if (!onReload || reloading) return
    setReloading(true)
    try {
      await onReload()
      // `plan` will change as a result, which resets the baseline + clears isStale via the effect
      // above; clear eagerly too so the banner disappears immediately on click.
      setIsStale(false)
    } finally {
      setReloading(false)
    }
  }, [onReload, reloading])

  const blocks = useMemo(() => parseMarkdownToBlocks(plan), [plan])

  const selectionRef = useRef(selection)
  selectionRef.current = selection

  const getResolvedSelection = useCallback((): ResolvedSelection[] | null => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return null
    return resolveSelection(sel)
  }, [])

  const handleToolbarAction = useCallback((action: ToolbarAction, sels: ResolvedSelection[]) => {
    if (action === 'deletion') {
      for (const sel of sels) addDeletion(sel)
      window.getSelection()?.removeAllRanges()
    } else if (action === 'sketch') {
      setSketchSel(sels[0] ?? null)
      window.getSelection()?.removeAllRanges()
    } else if (action === 'element') {
      setElementSel(sels[0] ?? null)
      window.getSelection()?.removeAllRanges()
    } else {
      setPopover({ mode: action, selections: sels })
    }
  }, [addDeletion])

  const handlePopoverSubmit = useCallback((text: string) => {
    if (!popover) return
    const { mode, selections: sels } = popover
    for (const sel of sels) {
      if (mode === 'comment') addComment(sel, text)
      else if (mode === 'replacement') addReplacement(sel, text)
      else if (mode === 'insertion') addInsertion(sel, text)
    }
    setPopover(null)
    window.getSelection()?.removeAllRanges()
  }, [popover, addComment, addReplacement, addInsertion])

  async function handleApprove() {
    if (working) return
    setWorking('approve')
    try { await onApprove(annotations); clearAnnotations() }
    finally { setWorking(null) }
  }

  async function handleDeny() {
    if (working || annotations.length === 0) return
    setWorking('deny')
    try {
      const sent = await onDeny(annotations)
      if (sent) clearAnnotations()
    } finally { setWorking(null) }
  }

  useKeyboardShortcuts({
    getSelection: getResolvedSelection,
    onAction: handleToolbarAction,
    onApprove: handleApprove,
    onDeny: handleDeny,
    onCancel,
    hasAnnotations: annotations.length > 0,
    decided: working !== null,
    enabled: !popover && !sketchSel && !elementSel && !anyEditOpen,
  })

  // Don't let a plan keep reading itself aloud after the reviewer has already left the screen.
  useEffect(() => () => stopSpeaking(), [stopSpeaking])

  const popoverText = popover ? popover.selections.map(s => s.text).join('\n') : ''
  const hasAnnotations = annotations.length > 0

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <div className="flex-shrink-0 flex items-center gap-3 px-4 h-12 border-b border-border bg-card">
        <button onClick={onCancel} title="Close without deciding (Esc)" className="text-muted-foreground hover:text-foreground text-sm px-1">←</button>
        <span className="text-xs font-bold truncate flex-1">{title}</span>
        <button
          type="button"
          onClick={() => (isSpeaking ? stopSpeaking() : speak(plan))}
          title={isSpeaking ? 'Stop reading' : 'Read plan aloud'}
          className={
            isSpeaking
              ? 'flex-shrink-0 flex items-center justify-center h-7 w-7 rounded-md text-primary bg-primary/10'
              : 'flex-shrink-0 flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-interactive-hover'
          }
        >
          <Icon name={isSpeaking ? 'stop' : 'volume-up'} className="h-3.5 w-3.5" />
        </button>
        {/* Keyboard-shortcut hints are meaningless on a phone (no physical keyboard) and just
            eat scarce header width there — desktop keeps the full hint, mobile drops it. */}
        {!isMobile && (
          <span className="text-[10px] text-muted-foreground flex-shrink-0">Select text to annotate — D delete, R replace, S insert, C comment, K sketch, E element</span>
        )}
        {isMobile && annotations.length > 0 && (
          <button
            type="button"
            onClick={() => setMobileAnnotationsOpen(true)}
            className="flex-shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground"
          >
            {annotations.length} note{annotations.length === 1 ? '' : 's'}
          </button>
        )}
        {/* One contextual primary action, not two — sending annotated feedback and approving
            as-is are mutually exclusive outcomes for the same review, not separate buttons. */}
        <button
          onClick={hasAnnotations ? handleDeny : handleApprove}
          disabled={working !== null}
          className={
            hasAnnotations
              ? 'flex-shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-destructive/40 text-destructive bg-destructive/10 disabled:opacity-40 disabled:cursor-not-allowed'
              : 'flex-shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-primary/40 text-primary bg-primary/15 disabled:opacity-40 disabled:cursor-not-allowed'
          }
        >
          {working
            ? (hasAnnotations ? 'Sending…' : 'Approving…')
            : (hasAnnotations ? `Send for Review (${annotations.length})` : 'Approve')}
        </button>
      </div>

      {isStale && (
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 border-b border-amber-500/40 bg-amber-500/10">
          <Icon name="refresh" className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
          <span className="text-xs text-amber-600 dark:text-amber-400 flex-1">This plan has been updated — refresh to see changes.</span>
          <button
            type="button"
            onClick={() => void handleRefreshStale()}
            disabled={reloading}
            className="flex-shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15 disabled:opacity-40"
          >
            {reloading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 overflow-y-auto px-4 py-6 sm:px-8">
          <div className="max-w-3xl mx-auto bg-card border border-border rounded-xl px-6 py-6">
            <PlanDocument blocks={blocks} annotations={annotations} onRemoveAnnotation={removeAnnotation} />
          </div>
        </div>
        {!isMobile && (
          <aside className="w-64 flex-shrink-0 border-l border-border px-3 py-4 overflow-y-auto">
            <AnnotationSidebar annotations={annotations} onRemove={removeAnnotation} onEdit={handleEditAnnotation} />
          </aside>
        )}
      </div>

      {isMobile && mobileAnnotationsOpen && (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/40" onClick={() => setMobileAnnotationsOpen(false)}>
          <div
            className="w-full max-h-[70vh] overflow-y-auto bg-card border-t border-border rounded-t-2xl px-4 pt-3 pb-[calc(var(--oc-safe-area-bottom,0px)+16px)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-bold">Annotations</span>
              <button type="button" onClick={() => setMobileAnnotationsOpen(false)} className="text-muted-foreground hover:text-foreground text-sm px-1">✕</button>
            </div>
            <AnnotationSidebar annotations={annotations} onRemove={removeAnnotation} onEdit={handleEditAnnotation} />
          </div>
        </div>
      )}

      {selection.isActive && selection.resolved && selection.rect && !popover && !sketchSel && !elementSel && !anyEditOpen && working === null && (
        <AnnotationToolbar rect={selection.rect} selections={selection.resolved} onAction={handleToolbarAction} onDismiss={() => window.getSelection()?.removeAllRanges()} />
      )}

      {popover && (
        <TextInputPopover mode={popover.mode} selectedText={popoverText} onSubmit={handlePopoverSubmit} onCancel={() => setPopover(null)} />
      )}

      {sketchSel && (
        <SketchCanvas
          selectedText={sketchSel.text}
          onSubmit={(dataUrl) => { addSketch(sketchSel, dataUrl); setSketchSel(null) }}
          onCancel={() => setSketchSel(null)}
        />
      )}

      {elementSel && (
        <WireframeDesigner
          selectedText={elementSel.text}
          onSubmit={(spec) => { addElement(elementSel, spec); setElementSel(null) }}
          onCancel={() => setElementSel(null)}
        />
      )}

      {/* Editing an existing annotation, re-opened from the sidebar. */}
      {editText && (
        <TextInputPopover
          mode={editText.mode}
          selectedText={editText.text}
          initialValue={editText.initial}
          onSubmit={(text) => {
            updateAnnotation(editText.id, editText.mode === 'comment' ? { comment: text } : { replacement: text })
            setEditText(null)
          }}
          onCancel={() => setEditText(null)}
        />
      )}

      {editSketchId && (
        <SketchCanvas
          selectedText="Redraw sketch"
          onSubmit={(dataUrl) => { updateAnnotation(editSketchId, { sketch: dataUrl }); setEditSketchId(null) }}
          onCancel={() => setEditSketchId(null)}
        />
      )}

      {editElement && (
        <WireframeDesigner
          selectedText={editElement.text}
          initialSpec={editElement.spec}
          onSubmit={(spec) => { updateAnnotation(editElement.id, { element: spec }); setEditElement(null) }}
          onCancel={() => setEditElement(null)}
        />
      )}
    </div>
  )
}
