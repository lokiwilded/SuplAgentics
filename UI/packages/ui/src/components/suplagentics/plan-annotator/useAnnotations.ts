// Ported from ndom91/open-plan-annotator (MIT licensed) ui/hooks/useAnnotations.ts — logic
// adapted: localStorage is now an offline cache; the canonical store is a server-side sidecar
// (.annotations.json next to the plan file) so annotations sync across devices (e.g. desktop →
// phone). On mount we fetch from the server; on change we write to localStorage immediately and
// debounce-write to the server.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Annotation, WireframeSpec } from './types'
import type { ResolvedSelection } from './offsetResolver'

const STORAGE_PREFIX = 'suplagentics:plan-annotations:'

function loadAnnotationsLocal(key: string): Annotation[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch { return [] }
}

function saveAnnotationsLocal(key: string, annotations: Annotation[]) {
  try {
    if (annotations.length === 0) localStorage.removeItem(STORAGE_PREFIX + key)
    else localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(annotations))
  } catch {}
}

// Server-side persistence: GET/PUT /api/suplagentics/plans/annotations?path=<planPath>
// The planKey passed in is derived from the plan's file path — we use it directly as the query param.
async function fetchAnnotationsServer(planKey: string): Promise<Annotation[] | null> {
  try {
    const res = await fetch(`/api/suplagentics/plans/annotations?path=${encodeURIComponent(planKey)}`)
    if (!res.ok) return null
    const data = await res.json()
    return Array.isArray(data.annotations) ? data.annotations : []
  } catch { return null }
}

async function saveAnnotationsServer(planKey: string, annotations: Annotation[]): Promise<boolean> {
  try {
    const res = await fetch(`/api/suplagentics/plans/annotations?path=${encodeURIComponent(planKey)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ annotations }),
    })
    return res.ok
  } catch { return false }
}

export function useAnnotations(planKey: string | null) {
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const initialized = useRef(false)
  const serverSyncRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Hydrate: try server first (canonical), fall back to localStorage cache
  useEffect(() => {
    if (!planKey || initialized.current) return
    initialized.current = true

    fetchAnnotationsServer(planKey).then((serverAnnotations) => {
      if (serverAnnotations && serverAnnotations.length > 0) {
        setAnnotations(serverAnnotations)
        saveAnnotationsLocal(planKey, serverAnnotations) // update local cache
      } else {
        const local = loadAnnotationsLocal(planKey)
        if (local.length > 0) setAnnotations(local)
      }
    })
  }, [planKey])

  // Persist: localStorage immediately (offline cache), server debounced (canonical store)
  useEffect(() => {
    if (!planKey || !initialized.current) return
    saveAnnotationsLocal(planKey, annotations)

    // Debounce server writes — avoids hammering the API on rapid annotation changes
    if (serverSyncRef.current) clearTimeout(serverSyncRef.current)
    serverSyncRef.current = setTimeout(() => {
      saveAnnotationsServer(planKey, annotations)
    }, 800)

    return () => {
      if (serverSyncRef.current) clearTimeout(serverSyncRef.current)
    }
  }, [planKey, annotations])

  const hasOverlap = useCallback(
    (blockIndex: number, start: number, end: number) =>
      annotations.some(a => a.blockIndex === blockIndex && a.startOffset < end && a.endOffset > start),
    [annotations],
  )

  const addAnnotation = useCallback(
    (selection: ResolvedSelection, type: Annotation['type'], extra?: { comment?: string; replacement?: string; sketch?: string; element?: WireframeSpec }) => {
      if (hasOverlap(selection.blockIndex, selection.startOffset, selection.endOffset)) return
      const annotation: Annotation = {
        id: crypto.randomUUID(),
        type,
        text: selection.text,
        comment: extra?.comment,
        replacement: extra?.replacement,
        sketch: extra?.sketch,
        element: extra?.element,
        blockIndex: selection.blockIndex,
        startOffset: selection.startOffset,
        endOffset: selection.endOffset,
        createdAt: new Date().toISOString(),
      }
      setAnnotations(prev => [...prev, annotation])
    },
    [hasOverlap],
  )

  const addDeletion = useCallback((sel: ResolvedSelection) => addAnnotation(sel, 'deletion'), [addAnnotation])
  const addComment = useCallback((sel: ResolvedSelection, comment: string) => addAnnotation(sel, 'comment', { comment }), [addAnnotation])
  const addReplacement = useCallback((sel: ResolvedSelection, replacement: string) => addAnnotation(sel, 'replacement', { replacement }), [addAnnotation])
  const addInsertion = useCallback((sel: ResolvedSelection, insertText: string) => addAnnotation(sel, 'insertion', { replacement: insertText }), [addAnnotation])
  const addSketch = useCallback((sel: ResolvedSelection, sketch: string) => addAnnotation(sel, 'sketch', { sketch }), [addAnnotation])
  const addElement = useCallback((sel: ResolvedSelection, element: WireframeSpec) => addAnnotation(sel, 'element', { element }), [addAnnotation])
  const removeAnnotation = useCallback((id: string) => setAnnotations(prev => prev.filter(a => a.id !== id)), [])
  const clearAnnotations = useCallback(() => setAnnotations([]), [])

  // Editing an existing annotation in place (re-opened from the sidebar) — patches the fields that
  // changed without touching its anchor (blockIndex/offsets) or id.
  const updateAnnotation = useCallback(
    (id: string, patch: Partial<Pick<Annotation, 'comment' | 'replacement' | 'sketch' | 'element'>>) =>
      setAnnotations(prev => prev.map(a => (a.id === id ? { ...a, ...patch } : a))),
    [],
  )

  return { annotations, addDeletion, addComment, addReplacement, addInsertion, addSketch, addElement, updateAnnotation, removeAnnotation, clearAnnotations }
}