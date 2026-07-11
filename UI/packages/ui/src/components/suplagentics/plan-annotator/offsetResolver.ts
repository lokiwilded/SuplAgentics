// Ported directly from ndom91/open-plan-annotator (MIT licensed) ui/utils/offsetResolver.ts
// — pure DOM traversal logic (window.Selection/Range APIs), no styling dependency, so no
// adaptation needed. Maps a raw browser text selection to block index + character offsets
// within that block's markdown source, so annotations survive re-renders.
import { renderedToSourceOffset } from './inlineMarkdown'

export interface ResolvedSelection {
  blockIndex: number
  startOffset: number
  endOffset: number
  text: string
}

export function resolveSelection(selection: Selection): ResolvedSelection[] | null {
  if (selection.isCollapsed || !selection.anchorNode || !selection.focusNode) return null

  const range = selection.getRangeAt(0)
  if (isInsideReplacement(range.startContainer) || isInsideReplacement(range.endContainer)) return null

  const anchorBlock = findBlockElement(selection.anchorNode)
  const focusBlock = findBlockElement(selection.focusNode)
  if (!anchorBlock || !focusBlock) return null

  if (anchorBlock === focusBlock) {
    const result = resolveSingleBlock(range, anchorBlock)
    return result ? [result] : null
  }

  return resolveMultiBlock(range, anchorBlock, focusBlock)
}

function resolveSingleBlock(range: Range, block: HTMLElement): ResolvedSelection | null {
  const blockIndex = parseInt(block.dataset.blockIndex ?? '-1', 10)
  if (blockIndex < 0) return null

  const text = range.toString()
  if (text.trim().length === 0) return null

  let startSeg = findSegmentElement(range.startContainer)
  let endSeg = findSegmentElement(range.endContainer)

  if (!startSeg) startSeg = block.querySelector<HTMLElement>('[data-seg-start]')
  if (!endSeg) {
    const segs = block.querySelectorAll<HTMLElement>('[data-seg-end]')
    endSeg = segs.length > 0 ? segs[segs.length - 1] : null
  }
  if (!startSeg || !endSeg) return null

  const segStart = parseInt(startSeg.dataset.segStart ?? '0', 10)
  const segEnd = parseInt(endSeg.dataset.segEnd ?? '0', 10)

  let startOffset: number
  if (startSeg.contains(range.startContainer)) {
    const preRange = document.createRange()
    preRange.selectNodeContents(startSeg)
    preRange.setEnd(range.startContainer, range.startOffset)
    startOffset = segStart + toSourceOffset(startSeg, preRange.toString().length)
  } else {
    startOffset = segStart
  }

  let endOffset: number
  if (startSeg === endSeg && startSeg.contains(range.endContainer)) {
    const fullPreRange = document.createRange()
    fullPreRange.selectNodeContents(startSeg)
    fullPreRange.setEnd(range.endContainer, range.endOffset)
    endOffset = segStart + toSourceOffset(startSeg, fullPreRange.toString().length)
    if (endOffset > segEnd) endOffset = segEnd
  } else if (endSeg.contains(range.endContainer)) {
    const endSegStart = parseInt(endSeg.dataset.segStart ?? '0', 10)
    const preRangeEnd = document.createRange()
    preRangeEnd.selectNodeContents(endSeg)
    preRangeEnd.setEnd(range.endContainer, range.endOffset)
    endOffset = endSegStart + toSourceOffset(endSeg, preRangeEnd.toString().length)
  } else {
    endOffset = segEnd
  }

  return { blockIndex, startOffset, endOffset, text }
}

function resolveMultiBlock(range: Range, anchorBlock: HTMLElement, focusBlock: HTMLElement): ResolvedSelection[] | null {
  const cmp = anchorBlock.compareDocumentPosition(focusBlock)
  const firstBlock = cmp & Node.DOCUMENT_POSITION_FOLLOWING ? anchorBlock : focusBlock
  const lastBlock = firstBlock === anchorBlock ? focusBlock : anchorBlock

  const firstIndex = parseInt(firstBlock.dataset.blockIndex ?? '-1', 10)
  const lastIndex = parseInt(lastBlock.dataset.blockIndex ?? '-1', 10)
  if (firstIndex < 0 || lastIndex < 0) return null

  const root = firstBlock.closest('article') ?? firstBlock.parentElement
  if (!root) return null

  const blockElements = Array.from(root.querySelectorAll<HTMLElement>('[data-block-index]'))
    .filter(el => {
      const idx = parseInt(el.dataset.blockIndex ?? '-1', 10)
      return idx >= firstIndex && idx <= lastIndex
    })
    .sort((a, b) => parseInt(a.dataset.blockIndex!, 10) - parseInt(b.dataset.blockIndex!, 10))

  const results: ResolvedSelection[] = []

  for (let i = 0; i < blockElements.length; i++) {
    const block = blockElements[i]
    const blockIndex = parseInt(block.dataset.blockIndex!, 10)
    const contentLength = getBlockContentLength(block)
    if (contentLength === 0) continue

    const isFirst = i === 0
    const isLast = i === blockElements.length - 1

    let startOffset: number
    let endOffset: number

    if (isFirst) {
      startOffset = computeStartOffset(range, block)
      if (startOffset < 0) continue
      endOffset = contentLength
    } else if (isLast) {
      startOffset = 0
      endOffset = computeEndOffset(range, block)
      if (endOffset <= 0) continue
    } else {
      startOffset = 0
      endOffset = contentLength
    }

    if (startOffset >= endOffset) continue

    const text = collectSegmentText(block, startOffset, endOffset)
    if (text.trim().length === 0) continue

    results.push({ blockIndex, startOffset, endOffset, text })
  }

  return results.length > 0 ? results : null
}

function computeStartOffset(range: Range, block: HTMLElement): number {
  const seg = findSegmentElement(range.startContainer)
  if (!seg || !block.contains(seg)) return 0
  const segStart = parseInt(seg.dataset.segStart ?? '0', 10)
  const preRange = document.createRange()
  preRange.selectNodeContents(seg)
  preRange.setEnd(range.startContainer, range.startOffset)
  return segStart + toSourceOffset(seg, preRange.toString().length)
}

function computeEndOffset(range: Range, block: HTMLElement): number {
  const seg = findSegmentElement(range.endContainer)
  if (!seg || !block.contains(seg)) return getBlockContentLength(block)
  const segStart = parseInt(seg.dataset.segStart ?? '0', 10)
  const preRangeEnd = document.createRange()
  preRangeEnd.selectNodeContents(seg)
  preRangeEnd.setEnd(range.endContainer, range.endOffset)
  return segStart + toSourceOffset(seg, preRangeEnd.toString().length)
}

function getBlockContentLength(block: HTMLElement): number {
  let max = 0
  for (const seg of block.querySelectorAll<HTMLElement>('[data-seg-end]')) {
    const end = parseInt(seg.dataset.segEnd ?? '0', 10)
    if (end > max) max = end
  }
  return max
}

function collectSegmentText(block: HTMLElement, startOffset: number, endOffset: number): string {
  let text = ''
  for (const seg of block.querySelectorAll<HTMLElement>('[data-seg-start]')) {
    if (seg.dataset.replacement === 'true') continue
    const segStart = parseInt(seg.dataset.segStart ?? '0', 10)
    const segEnd = parseInt(seg.dataset.segEnd ?? '0', 10)
    if (segEnd <= startOffset || segStart >= endOffset) continue
    const segText = seg.textContent ?? ''
    const overlapStart = Math.max(0, startOffset - segStart)
    const overlapEnd = Math.min(segText.length, endOffset - segStart)
    text += segText.slice(overlapStart, overlapEnd)
  }
  return text
}

function toSourceOffset(seg: HTMLElement, renderedLen: number): number {
  const source = seg.dataset.segSource
  if (source) return renderedToSourceOffset(source, renderedLen)
  return renderedLen
}

function findBlockElement(node: Node): HTMLElement | null {
  let current: Node | null = node
  while (current && current !== document.body) {
    if (current instanceof HTMLElement && current.dataset.blockIndex !== undefined) return current
    current = current.parentNode
  }
  return null
}

function findSegmentElement(node: Node): HTMLElement | null {
  let current: Node | null = node
  while (current && current !== document.body) {
    if (current instanceof HTMLElement && current.dataset.segStart !== undefined) return current
    current = current.parentNode
  }
  return null
}

function isInsideReplacement(node: Node): boolean {
  let current: Node | null = node
  while (current && current !== document.body) {
    if (current instanceof HTMLElement && current.dataset.replacement === 'true') return true
    current = current.parentNode
  }
  return false
}
