import type { NotebookBlock } from '@shared/types'
import { isPersistedNotebookBlock } from '@shared/notebook'

// Chronological color assignment with shared-ticket grouping: blocks sharing a
// non-empty ticket ID adopt the earliest color assigned to that ticket; every
// other persisted block cycles through the palette. Used by both the editor
// left-borders and the ruler so a ticket keeps one color across both surfaces.
export function assignBlockColors(blocks: NotebookBlock[], palette: string[]): Map<string, string> {
  const byBlock = new Map<string, string>()
  const byTicket = new Map<string, string>()
  let next = 0
  for (const block of blocks) {
    if (!isPersistedNotebookBlock(block)) continue
    const ticketId = block.ticketId.trim()
    let color: string
    if (ticketId) {
      if (!byTicket.has(ticketId)) {
        byTicket.set(ticketId, palette[next % palette.length])
        next += 1
      }
      color = byTicket.get(ticketId) as string
    } else {
      color = palette[next % palette.length]
      next += 1
    }
    byBlock.set(block.id, color)
  }
  return byBlock
}
