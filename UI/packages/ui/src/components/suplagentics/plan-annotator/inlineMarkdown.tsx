// Ported from ndom91/open-plan-annotator (MIT licensed) ui/utils/inlineMarkdown.tsx — the
// offset-mapping logic (tokenize/renderedToSourceOffset) is pure text processing, ported
// unchanged. Only the rendered JSX in renderInlineMarkdown is adapted: upstream's own
// theme classes (text-ink, bg-inset, text-link) replaced with SuplAgentics' tokens.
import type { ReactNode } from 'react'

interface InlineToken {
  type: 'text' | 'bold' | 'italic' | 'code' | 'link' | 'boldItalic'
  content: string
  href?: string
}

const INLINE_PATTERNS = [
  { regex: /(\*{3}|_{3})(.+?)\1/g, type: 'boldItalic' as const },
  { regex: /(\*{2}|_{2})(.+?)\1/g, type: 'bold' as const },
  { regex: /(?<!\w)\*(.+?)\*(?!\w)|(?<!\w)_(.+?)_(?!\w)/g, type: 'italic' as const },
  { regex: /`([^`]+)`/g, type: 'code' as const },
  { regex: /\[([^\]]+)\]\(([^)]+)\)/g, type: 'link' as const },
]

function tokenize(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  const matches: { start: number; end: number; token: InlineToken }[] = []

  for (const { regex, type } of INLINE_PATTERNS) {
    const re = new RegExp(regex.source, regex.flags)
    let m: RegExpExecArray | null = re.exec(text)
    while (m !== null) {
      let content: string
      let href: string | undefined
      if (type === 'link') { content = m[1]; href = m[2] }
      else if (type === 'boldItalic' || type === 'bold') content = m[2]
      else if (type === 'italic') content = m[1] || m[2]
      else content = m[1]
      matches.push({ start: m.index, end: m.index + m[0].length, token: { type, content, href } })
      m = re.exec(text)
    }
  }

  matches.sort((a, b) => a.start - b.start)
  const filtered: typeof matches = []
  let lastEnd = 0
  for (const m of matches) {
    if (m.start >= lastEnd) { filtered.push(m); lastEnd = m.end }
  }

  let cursor = 0
  for (const m of filtered) {
    if (m.start > cursor) tokens.push({ type: 'text', content: text.slice(cursor, m.start) })
    tokens.push(m.token)
    cursor = m.end
  }
  if (cursor < text.length) tokens.push({ type: 'text', content: text.slice(cursor) })

  return tokens
}

export function renderedToSourceOffset(markdownSource: string, renderedOffset: number): number {
  const tokens = tokenize(markdownSource)
  let renderedCursor = 0
  let sourceCursor = 0

  for (const token of tokens) {
    const renderedLen = token.content.length
    let sourceLen: number
    if (token.type === 'text') sourceLen = token.content.length
    else sourceLen = findSourceLength(markdownSource, sourceCursor, token)

    if (renderedCursor + renderedLen >= renderedOffset) {
      const intraRendered = renderedOffset - renderedCursor
      if (token.type === 'text') return sourceCursor + intraRendered
      const openingSyntaxLen = computeOpeningSyntaxLength(token)
      return sourceCursor + openingSyntaxLen + intraRendered
    }

    renderedCursor += renderedLen
    sourceCursor += sourceLen
  }

  return sourceCursor
}

function findSourceLength(source: string, cursor: number, token: InlineToken): number {
  switch (token.type) {
    case 'boldItalic': { const m = source.slice(cursor).match(/^(\*{3}|_{3}).+?\1/); return m ? m[0].length : token.content.length }
    case 'bold': { const m = source.slice(cursor).match(/^(\*{2}|_{2}).+?\1/); return m ? m[0].length : token.content.length }
    case 'italic': { const m = source.slice(cursor).match(/^\*(.+?)\*|^_(.+?)_/); return m ? m[0].length : token.content.length }
    case 'code': { const m = source.slice(cursor).match(/^`[^`]+`/); return m ? m[0].length : token.content.length }
    case 'link': { const m = source.slice(cursor).match(/^\[[^\]]+\]\([^)]+\)/); return m ? m[0].length : token.content.length }
    default: return token.content.length
  }
}

function computeOpeningSyntaxLength(token: InlineToken): number {
  switch (token.type) {
    case 'boldItalic': return 3
    case 'bold': return 2
    case 'italic': return 1
    case 'code': return 1
    case 'link': return 1
    default: return 0
  }
}

export function renderInlineMarkdown(text: string): ReactNode[] {
  const tokens = tokenize(text)
  return tokens.map((token, i) => {
    switch (token.type) {
      case 'bold':
        return <strong key={i} className="font-semibold text-foreground">{token.content}</strong>
      case 'italic':
        return <em key={i} className="italic">{token.content}</em>
      case 'boldItalic':
        return <strong key={i} className="font-semibold text-foreground italic">{token.content}</strong>
      case 'code':
        return <code key={i} className="text-[0.85em] font-mono bg-muted border border-border rounded-sm px-1 py-px">{token.content}</code>
      case 'link':
        return (
          <a key={i} href={token.href} className="text-primary underline decoration-accent/40 underline-offset-2 hover:decoration-accent/70 transition-colors duration-200" target="_blank" rel="noopener noreferrer">
            {token.content}
          </a>
        )
      default:
        return <span key={i}>{token.content}</span>
    }
  })
}
