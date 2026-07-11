// Adapted from ndom91/open-plan-annotator (MIT licensed) ui/components/AnnotationCard.tsx
// — same per-type color mapping as Block.tsx (red/amber/green/accent), classes rewritten
// for SuplAgentics' theme tokens.
import type { Annotation } from './types'

interface TypeConfig { label: string; bulletClass: string; glyph: string; pillClass: string; previewClass: string }

const typeConfig: Record<Annotation['type'], TypeConfig> = {
  comment:     { label: 'Comment', bulletClass: 'bg-primary text-white', glyph: '?', pillClass: 'text-primary', previewClass: 'bg-primary/15 text-primary' },
  deletion:    { label: 'Delete',  bulletClass: 'bg-destructive text-white',    glyph: '−', pillClass: 'text-destructive',    previewClass: 'bg-destructive/15 text-destructive line-through decoration-red/70' },
  replacement: { label: 'Replace', bulletClass: 'bg-amber-500 text-white', glyph: '→', pillClass: 'text-amber-500',  previewClass: 'bg-amber-500/15 text-amber-500' },
  insertion:   { label: 'Insert',  bulletClass: 'bg-emerald-500 text-white', glyph: '+', pillClass: 'text-emerald-500',  previewClass: 'bg-emerald-500/15 text-emerald-500' },
  sketch:      { label: 'Sketch',  bulletClass: 'bg-violet-500 text-white', glyph: '✎', pillClass: 'text-violet-500',  previewClass: 'bg-violet-500/15 text-violet-500' },
  element:     { label: 'Element', bulletClass: 'bg-cyan-500 text-white', glyph: '▧', pillClass: 'text-cyan-500',  previewClass: 'bg-cyan-500/15 text-cyan-500' },
}

interface AnnotationCardProps { annotation: Annotation; index: number; isLast: boolean; onRemove: (id: string) => void; onEdit?: (annotation: Annotation) => void }

// 'deletion' marks a span for removal — there's no content to re-open and edit.
const EDITABLE: Record<Annotation['type'], boolean> = {
  comment: true, replacement: true, insertion: true, sketch: true, element: true, deletion: false,
}

export function AnnotationCard({ annotation, index, isLast, onRemove, onEdit }: AnnotationCardProps) {
  const cfg = typeConfig[annotation.type]
  const canEdit = !!onEdit && EDITABLE[annotation.type]

  return (
    <div className={`flex gap-2.5 ${!isLast ? 'pb-2.5' : ''}`}>
      <div className="flex-shrink-0 flex flex-col items-center">
        <div className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold leading-none ${cfg.bulletClass}`} aria-hidden="true">
          {cfg.glyph}
        </div>
        {!isLast && <div className="w-px flex-1 bg-border mt-1" aria-hidden="true" />}
      </div>
      <div
        className={`group relative flex-1 min-w-0 rounded-md border border-border bg-card px-2 pt-1.5 pb-2 ${canEdit ? 'cursor-pointer hover:border-cyan-500/50 transition-colors' : ''}`}
        onClick={canEdit ? () => onEdit!(annotation) : undefined}
        role={canEdit ? 'button' : undefined}
        title={canEdit ? 'Click to edit' : undefined}
      >
        <div className="flex items-center justify-between gap-2 h-4">
          <span className={`text-[10px] font-bold uppercase tracking-wide leading-none ${cfg.pillClass}`}>{cfg.label}</span>
          <div className="flex items-center gap-1.5">
            {canEdit && <span className="text-[9px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">edit</span>}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(annotation.id) }}
              className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
              title="Remove annotation"
              aria-label={`Remove annotation ${index + 1}`}
            >
              ✕
            </button>
          </div>
        </div>
        <div className={`mt-1.5 px-1.5 py-1 rounded text-[11px] font-mono leading-relaxed truncate ${cfg.previewClass}`}>
          {truncate(annotation.text, 50)}
        </div>
        {annotation.type === 'replacement' && annotation.replacement && (
          <p className="mt-1 text-[11px] text-amber-500 leading-relaxed"><span aria-hidden="true">→</span> {truncate(annotation.replacement, 60)}</p>
        )}
        {annotation.type === 'insertion' && annotation.replacement && (
          <p className="mt-1 text-[11px] text-emerald-500 leading-relaxed">+ {truncate(annotation.replacement, 60)}</p>
        )}
        {annotation.type === 'comment' && annotation.comment && (
          <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">{annotation.comment}</p>
        )}
        {annotation.type === 'sketch' && annotation.sketch && (
          <img
            src={annotation.sketch}
            alt={`UI sketch for "${truncate(annotation.text, 30)}"`}
            className="mt-1.5 w-full rounded border border-violet-500/40 bg-white"
          />
        )}
        {annotation.type === 'element' && annotation.element && (() => {
          const spec = annotation.element
          const renderFrames = spec.frames.filter((f) => spec.renders[f])
          const primary = spec.renders.desktop ?? (renderFrames[0] ? spec.renders[renderFrames[0]] : undefined)
          const noteCount = spec.elements.reduce((n, el) => n + el.comments.length, 0)
          const notePreview = spec.elements.flatMap((el) => el.comments.map((c) => ({ label: el.label || el.kind, c }))).slice(0, 2)
          return (
            <>
              {primary && (
                <img
                  src={primary}
                  alt={`UI wireframe for "${truncate(annotation.text, 30)}"`}
                  className="mt-1.5 w-full rounded border border-cyan-500/40 bg-white"
                />
              )}
              {/* Per-frame thumbnail strip when the wireframe spans more than one breakpoint. */}
              {renderFrames.length > 1 && (
                <div className="mt-1 flex gap-1">
                  {renderFrames.map((f) => (
                    <img key={f} src={spec.renders[f]} alt={f} title={f} className="h-8 w-auto rounded border border-border bg-white" />
                  ))}
                </div>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                {spec.elements.length} element{spec.elements.length === 1 ? '' : 's'}
                {' · '}{spec.frames.length} frame{spec.frames.length === 1 ? '' : 's'}
                {noteCount > 0 ? ` · ${noteCount} note${noteCount === 1 ? '' : 's'}` : ''}
              </p>
              {notePreview.map((n, i) => (
                <p key={i} className="mt-0.5 text-[10px] text-cyan-500/90 leading-snug truncate">• {n.label}: {n.c}</p>
              ))}
            </>
          )
        })()}
      </div>
    </div>
  )
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}
