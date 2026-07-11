// Adapted from ndom91/open-plan-annotator (MIT licensed) ui/components/AnnotationSidebar.tsx
import type { Annotation } from './types'
import { AnnotationCard } from './AnnotationCard'

interface AnnotationSidebarProps { annotations: Annotation[]; onRemove: (id: string) => void; onEdit?: (annotation: Annotation) => void }

export function AnnotationSidebar({ annotations, onRemove, onEdit }: AnnotationSidebarProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Annotations</h3>
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 font-mono text-[10px] font-medium text-background">
          {annotations.length}
        </span>
      </div>
      {annotations.length === 0 ? (
        <div className="text-[11px] text-muted-foreground text-center py-6">Select text in the plan to annotate it.</div>
      ) : (
        <div>
          {annotations.map((ann, i) => (
            <AnnotationCard key={ann.id} annotation={ann} index={i} isLast={i === annotations.length - 1} onRemove={onRemove} onEdit={onEdit} />
          ))}
        </div>
      )}
    </div>
  )
}
