// Cross-panel linking: scroll a block into view in the OTHER panel. Panels tag
// their cards with data attributes; lookups go through the document because
// which ancestor scrolls differs per layout (split columns vs StackedPanels).
// An unmounted target panel simply yields no match, so the jump is a no-op —
// stacked mode deliberately never auto-switches panels.

export type LinkSide = 'notebook' | 'timeline'

/** How long the attention pulse plays after a cross-panel jump. */
export const LINK_PULSE_MS = 1100

function scrollBlockIntoView(attribute: string, id: string): boolean {
  const node = document.querySelector<HTMLElement>(`[${attribute}="${CSS.escape(id)}"]`)
  if (!node) return false
  node.scrollIntoView({ behavior: 'smooth', block: 'center' })
  return true
}

export function scrollToNotebookBlock(id: string): boolean {
  return scrollBlockIntoView('data-notebook-block-id', id)
}

export function scrollToTimelineBlock(id: string): boolean {
  return scrollBlockIntoView('data-timeline-block-id', id)
}
