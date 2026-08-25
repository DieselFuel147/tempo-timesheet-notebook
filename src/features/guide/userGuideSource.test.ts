import { describe, expect, it } from 'vitest'
import { parseUserGuide, plainText } from './guideModel'
import { USER_GUIDE_MARKDOWN } from './userGuideSource'

// Guards against authoring surprises in the real guide file: content placed
// above the first H2 must surface as the document preamble, not vanish.
describe('shipped user guide', () => {
  const doc = parseUserGuide(USER_GUIDE_MARKDOWN)

  it('has a title and at least one section', () => {
    expect(doc.title.length).toBeGreaterThan(0)
    expect(doc.sections.length).toBeGreaterThan(0)
  })

  it('keeps the intro tip visible in the preamble', () => {
    const callouts = doc.preamble.filter((block) => block.kind === 'callout')
    expect(callouts.length).toBeGreaterThan(0)
    const joined = callouts.map((block) => plainText(block.segments)).join(' ')
    expect(joined).toContain('full time note taking destination')
  })
})
