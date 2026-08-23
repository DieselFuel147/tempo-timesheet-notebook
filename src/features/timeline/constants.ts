/** Vertical pixels each minute of block duration occupies on the ruler. */
export const PX_PER_MINUTE = 4

// Purely so a zero/one-minute block still has a clickable hit area; must stay
// small enough that it never causes visual overlap with the next block.
export const MIN_BLOCK_PIXEL_FLOOR = 4

// Width of the left-hand gutter reserved for "HH:00" hour labels on the ruler.
export const RULER_GUTTER = 44

// Draggable notebook/timeline split (desktop row layout only). Bounds keep both
// panels usable regardless of how far the handle is dragged.
export const DEFAULT_TIMELINE_WIDTH = 380
export const MIN_TIMELINE_WIDTH = 280
export const MAX_TIMELINE_WIDTH = 760
