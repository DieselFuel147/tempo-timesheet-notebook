// Per-device layout preference: whether the Timeline panel starts hidden in
// the side-by-side (above-md) layout. Stored only in localStorage — never
// touches the backend settings API (see shared/settings.ts). Stacked mode
// ignores it entirely; StackedPanels always offers both panels.
const STORAGE_KEY = 'tempo.timelineCollapsed'

export function readTimelineCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeTimelineCollapsed(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(value))
  } catch {
    // localStorage unavailable (e.g. disabled/private mode) — ignore, the
    // preference simply won't persist across launches.
  }
}
