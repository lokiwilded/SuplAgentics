// Ported directly from ndom91/open-plan-annotator (MIT licensed) ui/components/PlanDocument.tsx
import type { Annotation } from './types'
import type { Block } from './markdown'
import { BlockComponent } from './Block'

interface PlanDocumentProps {
  blocks: Block[]
  annotations: Annotation[]
  onRemoveAnnotation?: (id: string) => void
}

export function PlanDocument({ blocks, annotations, onRemoveAnnotation }: PlanDocumentProps) {
  return (
    <article className="plan-content">
      {blocks.map(block => (
        <BlockComponent key={block.index} block={block} annotations={annotations} onRemoveAnnotation={onRemoveAnnotation} />
      ))}
    </article>
  )
}
