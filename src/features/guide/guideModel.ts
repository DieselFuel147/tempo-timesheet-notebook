// Structured model for the built-in user guide. docs/user-guide.md is the
// single source of truth: this module turns its markdown subset into typed
// data (no third-party parser) that GuideDialog renders as MUI components.
//
// Supported constructs (authoring contract for the guide file):
//   `# H1`          document title (first one wins)
//   `## H2`         a navigable section (slug becomes its deep-link id)
//   `### H3`        sub-heading inside a section (also an anchor)
//   paragraphs      consecutive non-blank lines joined with spaces
//   `- bullets`     flat bullet lists
//   `> callouts`    `**Tip:**` / `**Note:**` / `**Warning:**` lead sets the tone
//   tables          GitHub-style pipe tables with a `---` separator row
//   inline          **bold**, *italic*, `` `code` ``

export type InlineStyle = 'plain' | 'bold' | 'italic' | 'code'

export interface InlineSegment {
  text: string
  style: InlineStyle
}

export type CalloutTone = 'tip' | 'note' | 'warning'

export type GuideBlock =
  | { kind: 'paragraph'; segments: InlineSegment[] }
  | { kind: 'heading'; id: string; segments: InlineSegment[] }
  | { kind: 'bullets'; items: InlineSegment[][] }
  | { kind: 'callout'; tone: CalloutTone; segments: InlineSegment[] }
  | { kind: 'table'; header: InlineSegment[][]; rows: InlineSegment[][][] }

export interface GuideSection {
  /** Stable deep-link id (slugified heading, de-duplicated across the doc). */
  id: string
  title: string
  /** First paragraph's plain text, truncated — shown under the title in the nav. */
  summary: string
  blocks: GuideBlock[]
}

export interface GuideDoc {
  title: string
  sections: GuideSection[]
}

const INLINE_PATTERN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g

export function parseInlineSegments(text: string): InlineSegment[] {
  const segments: InlineSegment[] = []
  let cursor = 0
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const start = match.index
    const raw = match[0]
    if (start > cursor) segments.push({ text: text.slice(cursor, start), style: 'plain' })
    if (raw.startsWith('`')) segments.push({ text: raw.slice(1, -1), style: 'code' })
    else if (raw.startsWith('**')) segments.push({ text: raw.slice(2, -2), style: 'bold' })
    else segments.push({ text: raw.slice(1, -1), style: 'italic' })
    cursor = start + raw.length
  }
  if (cursor < text.length || segments.length === 0) {
    segments.push({ text: text.slice(cursor), style: 'plain' })
  }
  return segments
}

export function plainText(segments: InlineSegment[]): string {
  return segments.map((segment) => segment.text).join('')
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Slug that never collides with an id already handed out for this document. */
class IdAllocator {
  private readonly used = new Set<string>()

  allocate(text: string): string {
    const base = slugify(text) || 'section'
    let id = base
    let counter = 2
    while (this.used.has(id)) {
      id = `${base}-${counter}`
      counter += 1
    }
    this.used.add(id)
    return id
  }
}

// The tone word may be written as **Tip:** (colon inside the bold) or **Tip**:
const CALLOUT_LEAD_PATTERN = /^\*\*(tip|note|warning):?\*\*:?\s*/i

function parseCallout(lines: string[]): Extract<GuideBlock, { kind: 'callout' }> {
  const text = lines.join(' ').trim()
  const lead = text.match(CALLOUT_LEAD_PATTERN)
  if (!lead) return { kind: 'callout', tone: 'note', segments: parseInlineSegments(text) }
  const tone = lead[1].toLowerCase() as CalloutTone
  return { kind: 'callout', tone, segments: parseInlineSegments(text.slice(lead[0].length)) }
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

const SUMMARY_MAX_CHARS = 140

export function truncateForDisplay(text: string, maxChars = SUMMARY_MAX_CHARS): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars - 1).trimEnd()}…`
}

function deriveSummary(blocks: GuideBlock[]): string {
  for (const block of blocks) {
    if (block.kind === 'paragraph') return truncateForDisplay(plainText(block.segments))
  }
  return ''
}

export function parseUserGuide(markdown: string): GuideDoc {
  const lines = markdown.split(/\r?\n/)
  const sectionIds = new IdAllocator()
  const anchorIds = new IdAllocator()
  const sections: GuideSection[] = []
  let title = ''
  let paragraphBuffer: string[] = []
  // Bullets are accumulated until a non-bullet line so consecutive `- ` lines
  // collapse into one list block instead of one block per bullet.
  let bulletsBuffer: InlineSegment[][] | null = null

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0 || sections.length === 0) {
      paragraphBuffer = []
      return
    }
    sections[sections.length - 1].blocks.push({
      kind: 'paragraph',
      segments: parseInlineSegments(paragraphBuffer.join(' ').trim()),
    })
    paragraphBuffer = []
  }

  const flushBullets = () => {
    if (!bulletsBuffer || sections.length === 0) {
      bulletsBuffer = null
      return
    }
    sections[sections.length - 1].blocks.push({ kind: 'bullets', items: bulletsBuffer })
    bulletsBuffer = null
  }

  const flushAll = () => {
    flushParagraph()
    flushBullets()
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]

    if (/^###\s+/.test(line)) {
      flushAll()
      const text = line.replace(/^###\s+/, '').trim()
      sections[sections.length - 1]?.blocks.push({
        kind: 'heading',
        id: anchorIds.allocate(text),
        segments: parseInlineSegments(text),
      })
      continue
    }

    if (/^##\s+/.test(line)) {
      flushAll()
      const text = line.replace(/^##\s+/, '').trim()
      sections.push({
        id: sectionIds.allocate(text),
        title: plainText(parseInlineSegments(text)),
        summary: '',
        blocks: [],
      })
      continue
    }

    if (/^#\s+/.test(line) && !title) {
      title = plainText(parseInlineSegments(line.replace(/^#\s+/, '').trim()))
      continue
    }

    if (/^>\s?/.test(line)) {
      flushAll()
      const quoted: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^>\s?/, '').trim())
        i += 1
      }
      i -= 1
      if (quoted.some((entry) => entry.length > 0)) {
        sections[sections.length - 1]?.blocks.push(parseCallout(quoted.filter(Boolean)))
      }
      continue
    }

    if (line.startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushAll()
      const header = splitTableRow(line).map(parseInlineSegments)
      const rows: InlineSegment[][][] = []
      i += 2
      while (i < lines.length && lines[i].startsWith('|')) {
        rows.push(splitTableRow(lines[i]).map(parseInlineSegments))
        i += 1
      }
      i -= 1
      sections[sections.length - 1]?.blocks.push({
        kind: 'table',
        header,
        rows,
      })
      continue
    }

    if (/^-\s+/.test(line)) {
      flushParagraph()
      if (!bulletsBuffer) bulletsBuffer = []
      bulletsBuffer.push(parseInlineSegments(line.replace(/^-\s+/, '').trim()))
      continue
    }

    if (line.trim().length === 0) {
      flushAll()
      continue
    }

    flushBullets()
    paragraphBuffer.push(line.trim())
  }

  flushAll()

  for (const section of sections) {
    section.summary = deriveSummary(section.blocks)
  }

  return { title, sections }
}

export interface GuideSearchHit {
  sectionId: string
  sectionTitle: string
  snippet: string
}

const SNIPPET_CONTEXT = 48

/** Flattens a section to searchable plain text (title first so it ranks naturally). */
export function guideSearchableText(section: GuideSection): string {
  const parts: string[] = [section.title]
  for (const block of section.blocks) {
    switch (block.kind) {
      case 'paragraph':
      case 'heading':
      case 'callout':
        parts.push(plainText(block.segments))
        break
      case 'bullets':
        for (const item of block.items) parts.push(plainText(item))
        break
      case 'table':
        parts.push(...block.header.map(plainText), ...block.rows.flat().map(plainText))
        break
    }
  }
  return parts.join(' ')
}

export function searchGuide(doc: GuideDoc, query: string): GuideSearchHit[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return []
  const hits: GuideSearchHit[] = []
  for (const section of doc.sections) {
    const haystack = guideSearchableText(section)
    const index = haystack.toLowerCase().indexOf(needle)
    if (index < 0) continue
    const start = Math.max(0, index - SNIPPET_CONTEXT)
    const end = Math.min(haystack.length, index + needle.length + SNIPPET_CONTEXT)
    const snippet = `${start > 0 ? '…' : ''}${haystack.slice(start, end).trim()}${end < haystack.length ? '…' : ''}`
    hits.push({ sectionId: section.id, sectionTitle: section.title, snippet })
  }
  return hits
}
