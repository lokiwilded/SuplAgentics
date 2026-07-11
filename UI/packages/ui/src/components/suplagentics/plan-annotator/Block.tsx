// Adapted from ndom91/open-plan-annotator (MIT licensed) ui/components/Block.tsx. Segment
// splitting, annotation overlay logic, and the data-block-index/data-seg-* attributes (the
// offset resolver depends on these) are ported unchanged. Adapted: upstream's own theme
// classes (text-ink, bg-code-bg, bg-redline-bg, etc.) mapped onto SuplAgentics' existing
// tokens — red=deletion, amber=replacement, green=insertion, accent=comment — and syntax
// highlighting (upstream uses shiki) simplified to plain monospace for this first pass,
// since it's not core to the annotation mechanics and avoids a new heavy dependency.
import { createContext, useContext, useMemo } from 'react'
import type { Annotation } from './types'
import { renderInlineMarkdown } from './inlineMarkdown'
import type { Block, ListItem } from './markdown'
import { CommentTooltip } from './CommentTooltip'

const RemoveAnnotationContext = createContext<((id: string) => void) | undefined>(undefined)
export const RemoveAnnotationProvider = RemoveAnnotationContext.Provider

interface BlockProps {
  block: Block
  annotations: Annotation[]
  onRemoveAnnotation?: (id: string) => void
}

interface Segment {
  text: string
  originalStart: number
  originalEnd: number
  annotation?: Annotation
}

function splitIntoSegments(text: string, annotations: Annotation[]): Segment[] {
  const sorted = [...annotations].sort((a, b) => a.startOffset - b.startOffset)
  const segments: Segment[] = []
  let cursor = 0

  for (const ann of sorted) {
    if (ann.startOffset > cursor) segments.push({ text: text.slice(cursor, ann.startOffset), originalStart: cursor, originalEnd: ann.startOffset })
    segments.push({ text: text.slice(ann.startOffset, ann.endOffset), originalStart: ann.startOffset, originalEnd: ann.endOffset, annotation: ann })
    cursor = ann.endOffset
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), originalStart: cursor, originalEnd: text.length })

  return segments
}

function AnnotationIndex({ annotation, annotations }: { annotation: Annotation; annotations: Annotation[] }) {
  const index = annotations.findIndex(ann => ann.id === annotation.id) + 1
  const onRemove = useContext(RemoveAnnotationContext)
  const colorClass = annotation.type === 'deletion' ? 'bg-destructive text-white' : annotation.type === 'replacement' ? 'bg-amber-500 text-white' : annotation.type === 'insertion' ? 'bg-emerald-500 text-white' : annotation.type === 'sketch' ? 'bg-violet-500 text-white' : annotation.type === 'element' ? 'bg-cyan-500 text-white' : 'bg-primary text-white'
  if (index <= 0) return null
  if (!onRemove) return <sup className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] font-bold ml-0.5 ${colorClass}`}>{index}</sup>
  return (
    <button
      type="button"
      onMouseDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onRemove(annotation.id) }}
      className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] font-bold ml-0.5 hover:opacity-70 transition-opacity ${colorClass}`}
      title="Remove annotation"
      aria-label={`Remove annotation ${index}`}
    >
      {index}
    </button>
  )
}

function renderSegments(segments: Segment[], annotations: Annotation[], useInline = true) {
  return segments.map((seg, i) => {
    const content = useInline ? renderInlineMarkdown(seg.text) : seg.text
    const segSourceAttr = useInline ? { 'data-seg-source': seg.text } : {}

    if (!seg.annotation) {
      return <span key={i} data-seg-start={seg.originalStart} data-seg-end={seg.originalEnd} {...segSourceAttr}>{content}</span>
    }

    if (seg.annotation.type === 'deletion') {
      return (
        <span key={i} data-seg-start={seg.originalStart} data-seg-end={seg.originalEnd} {...segSourceAttr}>
          <span className="bg-destructive/15 text-destructive line-through decoration-red/80 decoration-2" title="Marked for removal">{content}</span>
          <AnnotationIndex annotation={seg.annotation} annotations={annotations} />
        </span>
      )
    }
    if (seg.annotation.type === 'replacement') {
      return (
        <span key={i} data-seg-start={seg.originalStart} data-seg-end={seg.originalEnd} {...segSourceAttr}>
          <span className="bg-destructive/15 text-destructive line-through decoration-red/75 decoration-2">{content}</span>
          <span className="bg-amber-500/15 text-amber-500 border-b-2 border-amber-500/60 ml-1 not-italic no-underline" data-replacement="true">{seg.annotation.replacement}</span>
          <AnnotationIndex annotation={seg.annotation} annotations={annotations} />
        </span>
      )
    }
    if (seg.annotation.type === 'insertion') {
      return (
        <span key={i} data-seg-start={seg.originalStart} data-seg-end={seg.originalEnd} {...segSourceAttr}>
          {content}
          <span className="bg-emerald-500/15 text-emerald-500 border-b-2 border-emerald-500/60 ml-1" data-replacement="true">+{seg.annotation.replacement}</span>
          <AnnotationIndex annotation={seg.annotation} annotations={annotations} />
        </span>
      )
    }
    if (seg.annotation.type === 'sketch') {
      return (
        <span key={i} data-seg-start={seg.originalStart} data-seg-end={seg.originalEnd} {...segSourceAttr}>
          <span className="bg-violet-500/15 border-b-2 border-violet-500/70" title="UI sketch attached" role="note">{content}</span>
          <AnnotationIndex annotation={seg.annotation} annotations={annotations} />
        </span>
      )
    }
    if (seg.annotation.type === 'element') {
      return (
        <span key={i} data-seg-start={seg.originalStart} data-seg-end={seg.originalEnd} {...segSourceAttr}>
          <span className="bg-cyan-500/15 border-b-2 border-cyan-500/70" title="UI wireframe attached" role="note">{content}</span>
          <AnnotationIndex annotation={seg.annotation} annotations={annotations} />
        </span>
      )
    }
    return (
      <span key={i} data-seg-start={seg.originalStart} data-seg-end={seg.originalEnd} {...segSourceAttr}>
        {seg.annotation.comment ? (
          <CommentTooltip comment={seg.annotation.comment}>{content}</CommentTooltip>
        ) : (
          <span className="bg-primary/15 border-b-2 border-primary/70 cursor-help" role="note">{content}</span>
        )}
        <AnnotationIndex annotation={seg.annotation} annotations={annotations} />
      </span>
    )
  })
}

function listClassName(marker: ListItem['marker'], nested = false): string {
  return marker === 'ordered' ? `${nested ? 'mt-2' : 'my-3'} list-decimal space-y-1 pl-6` : `${nested ? 'mt-2' : 'my-3'} list-disc space-y-1 pl-6`
}

function splitItemSegments(content: string, itemStart: number, itemEnd: number, annotations: Annotation[]): Segment[] {
  const itemAnns = annotations.filter(a => a.startOffset < itemEnd && a.endOffset > itemStart).sort((a, b) => a.startOffset - b.startOffset)
  const segments: Segment[] = []
  let cursor = itemStart

  for (const ann of itemAnns) {
    const annStart = Math.max(ann.startOffset, itemStart)
    const annEnd = Math.min(ann.endOffset, itemEnd)
    if (annStart > cursor) segments.push({ text: content.slice(cursor, annStart), originalStart: cursor, originalEnd: annStart })
    segments.push({ text: content.slice(annStart, annEnd), originalStart: annStart, originalEnd: annEnd, annotation: ann })
    cursor = annEnd
  }
  if (cursor < itemEnd) segments.push({ text: content.slice(cursor, itemEnd), originalStart: cursor, originalEnd: itemEnd })

  return segments
}

function renderListGroups(items: ListItem[], content: string, itemAnnotations: Annotation[], allAnnotations: Annotation[], nested = false) {
  const groups: Array<{ marker: ListItem['marker']; items: ListItem[] }> = []
  for (const item of items) {
    const currentGroup = groups[groups.length - 1]
    if (currentGroup && currentGroup.marker === item.marker) { currentGroup.items.push(item); continue }
    groups.push({ marker: item.marker, items: [item] })
  }

  return groups.map((group, groupIndex) => {
    const ListTag = group.marker === 'ordered' ? 'ol' : 'ul'
    const listProps = group.marker === 'ordered' ? { start: group.items[0]?.order } : {}
    return (
      <ListTag key={`${group.marker}-${groupIndex}`} className={listClassName(group.marker, nested)} {...listProps}>
        {group.items.map((item, itemIndex) => {
          const itemSegments = splitItemSegments(content, item.start, item.end, itemAnnotations)
          return (
            <li key={`${group.marker}-${groupIndex}-${itemIndex}`} className="text-[13px] text-foreground leading-relaxed">
              {renderSegments(itemSegments, allAnnotations)}
              {item.children.length > 0 && renderListGroups(item.children, content, itemAnnotations, allAnnotations, true)}
            </li>
          )
        })}
      </ListTag>
    )
  })
}

export function BlockComponent({ block, annotations, onRemoveAnnotation }: BlockProps) {
  const blockAnnotations = useMemo(() => annotations.filter(a => a.blockIndex === block.index), [annotations, block.index])
  const segments = useMemo(() => splitIntoSegments(block.content, blockAnnotations), [block.content, blockAnnotations])
  const inner = renderBlock(block, segments, blockAnnotations, annotations)
  return <RemoveAnnotationProvider value={onRemoveAnnotation}>{inner}</RemoveAnnotationProvider>
}

function renderBlock(block: Block, segments: Segment[], blockAnnotations: Annotation[], annotations: Annotation[]) {
  switch (block.type) {
    case 'heading': {
      const level = Math.min(Math.max(block.level ?? 1, 1), 6)
      const sizeClasses: Record<number, string> = {
        1: 'text-lg font-bold leading-tight mt-0 mb-4 text-foreground',
        2: 'text-base font-bold leading-snug mt-6 mb-2 pb-1 text-foreground border-b border-border',
        3: 'text-sm font-bold mt-4 mb-1.5 text-foreground',
        4: 'text-sm font-semibold mt-3 mb-1 text-foreground',
        5: 'text-[11px] font-semibold uppercase tracking-widest mt-3 mb-1 text-muted-foreground',
        6: 'text-[10px] font-semibold uppercase tracking-widest mt-2 mb-1 text-muted-foreground',
      }
      const classes = sizeClasses[level] ?? sizeClasses[1]
      const Tag = `h${level}` as keyof React.JSX.IntrinsicElements
      return <Tag data-block-index={block.index} className={classes}>{renderSegments(segments, annotations)}</Tag>
    }

    case 'code':
      return (
        <div data-block-index={block.index} className="mt-2 mb-4 rounded-lg bg-muted border border-border overflow-hidden">
          {block.lang && (
            <div className="px-3 py-1.5 border-b border-border">
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">{block.lang}</span>
            </div>
          )}
          <div data-seg-start={0} data-seg-end={block.content.length} className="px-3 py-2 overflow-x-auto">
            <pre className="text-[11px] font-mono text-foreground whitespace-pre">{renderSegments(segments, annotations, false)}</pre>
          </div>
        </div>
      )

    case 'list':
      return <div data-block-index={block.index}>{renderListGroups(block.listItems ?? [], block.content, blockAnnotations, annotations)}</div>

    case 'table': {
      const alignClass = (align?: 'left' | 'center' | 'right') => align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'
      return (
        <div data-block-index={block.index} className="my-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[12px] text-foreground">
            {block.headerRow && (
              <thead>
                <tr className="border-b border-border bg-muted">
                  {block.headerRow.map((cell, ci) => {
                    const cellSegments = splitItemSegments(block.content, cell.start, cell.end, blockAnnotations)
                    return <th key={ci} className={`px-3 py-1.5 font-semibold ${alignClass(cell.align)}`}>{renderSegments(cellSegments, annotations)}</th>
                  })}
                </tr>
              </thead>
            )}
            {block.bodyRows && (
              <tbody>
                {block.bodyRows.map((row, ri) => (
                  <tr key={ri} className="border-b border-border/50 last:border-0">
                    {row.map((cell, ci) => {
                      const cellSegments = splitItemSegments(block.content, cell.start, cell.end, blockAnnotations)
                      return <td key={ci} className={`px-3 py-1.5 ${alignClass(cell.align)}`}>{renderSegments(cellSegments, annotations)}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
      )
    }

    case 'hr':
      return <hr data-block-index={block.index} className="my-6 border-0 h-px bg-border" />

    case 'blockquote':
      return <blockquote data-block-index={block.index} className="my-4 pl-4 border-l-2 border-border py-0.5 pr-2 text-[13px] text-muted-foreground italic leading-relaxed">{renderSegments(segments, annotations)}</blockquote>

    default:
      return <p data-block-index={block.index} className="text-[13px] text-foreground leading-relaxed my-2.5">{renderSegments(segments, annotations)}</p>
  }
}
