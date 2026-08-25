import { describe, expect, it } from 'vitest'
import {
  guideSearchableText,
  parseInlineSegments,
  parseUserGuide,
  plainText,
  searchGuide,
  truncateForDisplay,
} from './guideModel'

describe('parseUserGuide', () => {
  it('extracts the document title and one section per H2 with slug ids', () => {
    const doc = parseUserGuide('# My Guide\n\nIntro text.\n\n## First Section\n\nBody.\n\n## Second Section\n\nMore.')
    expect(doc.title).toBe('My Guide')
    expect(doc.sections.map((section) => section.id)).toEqual(['first-section', 'second-section'])
    expect(doc.sections[0].title).toBe('First Section')
  })

  it('de-duplicates section ids when headings repeat', () => {
    const doc = parseUserGuide('## Same\n\n## Same')
    expect(doc.sections.map((section) => section.id)).toEqual(['same', 'same-2'])
  })

  it('joins consecutive paragraph lines and collapses consecutive bullets', () => {
    const doc = parseUserGuide('## S\n\nLine one.\nLine two.\n\n- alpha\n- beta\n\nAfter list.')
    const blocks = doc.sections[0].blocks
    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toEqual({
      kind: 'paragraph',
      segments: [{ text: 'Line one. Line two.', style: 'plain' }],
    })
    expect(blocks[1].kind).toBe('bullets')
    if (blocks[1].kind === 'bullets') {
      expect(blocks[1].items.map(plainText)).toEqual(['alpha', 'beta'])
    }
    expect(blocks[2].kind).toBe('paragraph')
  })

  it('parses callout tones from bold leads and defaults to note', () => {
    const doc = parseUserGuide('## S\n\n> **Tip:** Do the thing.\n\n> Just a note.')
    const [tip, note] = doc.sections[0].blocks as Extract<
      (typeof doc.sections)[number]['blocks'][number],
      { kind: 'callout' }
    >[]
    expect(tip).toMatchObject({ kind: 'callout', tone: 'tip' })
    expect(plainText(tip.segments)).toBe('Do the thing.')
    expect(note).toMatchObject({ kind: 'callout', tone: 'note' })
    expect(plainText(note.segments)).toBe('Just a note.')
  })

  it('parses pipe tables with a separator row', () => {
    const doc = parseUserGuide('## S\n\n| Level | Meaning |\n| --- | --- |\n| Error | stops push |\n| Warning | keeps going |')
    const table = doc.sections[0].blocks.find((block) => block.kind === 'table')
    expect(table).toEqual({
      kind: 'table',
      header: [
        [{ text: 'Level', style: 'plain' }],
        [{ text: 'Meaning', style: 'plain' }],
      ],
      rows: [
        [
          [{ text: 'Error', style: 'plain' }],
          [{ text: 'stops push', style: 'plain' }],
        ],
        [
          [{ text: 'Warning', style: 'plain' }],
          [{ text: 'keeps going', style: 'plain' }],
        ],
      ],
    })
  })

  it('gives H3 sub-headings stable anchor ids scoped to the document', () => {
    const doc = parseUserGuide('## One\n\n### Sub A\n\n## Two\n\n### Sub A')
    const anchors = doc.sections.flatMap((section) =>
      section.blocks.filter((block) => block.kind === 'heading').map((block) => (block.kind === 'heading' ? block.id : '')),
    )
    expect(anchors).toEqual(['sub-a', 'sub-a-2'])
  })

  it('derives each section summary from its first paragraph, truncated', () => {
    const long = 'x'.repeat(200)
    const doc = parseUserGuide(`## S\n\n${long}\n\n- bullet only here`)
    expect(doc.sections[0].summary).toHaveLength(140)
    expect(doc.sections[0].summary.endsWith('…')).toBe(true)
  })
})

describe('parseInlineSegments', () => {
  it('splits bold, italic, and code runs out of plain text', () => {
    expect(parseInlineSegments('use **ABC-123** keys and *notes* plus `cmd`')).toEqual([
      { text: 'use ', style: 'plain' },
      { text: 'ABC-123', style: 'bold' },
      { text: ' keys and ', style: 'plain' },
      { text: 'notes', style: 'italic' },
      { text: ' plus ', style: 'plain' },
      { text: 'cmd', style: 'code' },
    ])
  })

  it('returns a single plain segment for unmarked or empty input', () => {
    expect(parseInlineSegments('nothing special')).toEqual([{ text: 'nothing special', style: 'plain' }])
    expect(parseInlineSegments('')).toEqual([{ text: '', style: 'plain' }])
  })
})

describe('searchGuide', () => {
  const doc = parseUserGuide(
    '# Guide\n\n## Timeline\n\nDrag blocks around.\n\n## Settings\n\nTokens live in the OS keychain.',
  )

  it('matches sections case-insensitively across all block text', () => {
    expect(searchGuide(doc, 'KEYCHAIN').map((hit) => hit.sectionId)).toEqual(['settings'])
  })

  it('returns a snippet centred on the match with ellipses when clipped', () => {
    const longText = 'filler '.repeat(40)
    const wideDoc = parseUserGuide(`## Big\n\n${longText}needle ${longText}`)
    const [hit] = searchGuide(wideDoc, 'needle')
    expect(hit.sectionId).toBe('big')
    expect(hit.snippet.startsWith('…')).toBe(true)
    expect(hit.snippet).toContain('needle')
  })

  it('returns nothing for blank queries or no matches', () => {
    expect(searchGuide(doc, '   ')).toEqual([])
    expect(searchGuide(doc, 'quantum')).toEqual([])
  })

  it('includes titles in searchable text', () => {
    expect(guideSearchableText(doc.sections[0]).startsWith('Timeline')).toBe(true)
  })
})

describe('truncateForDisplay', () => {
  it('leaves short text alone and trims long text onto an ellipsis boundary', () => {
    expect(truncateForDisplay('short', 10)).toBe('short')
    expect(truncateForDisplay('abcdefghijk', 5)).toBe('abcd…')
  })
})
