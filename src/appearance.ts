// Per-device display preference. Stored only in localStorage — never touches
// the backend settings API (see shared/settings.ts) — and applies immediately.
export type Appearance = 'auto' | 'dark' | 'light'

const STORAGE_KEY = 'tempo.appearance'

function isAppearance(value: unknown): value is Appearance {
  return value === 'auto' || value === 'dark' || value === 'light'
}

export function readAppearance(): Appearance {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isAppearance(stored) ? stored : 'auto'
  } catch {
    return 'auto'
  }
}

export function writeAppearance(value: Appearance): void {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // localStorage unavailable (e.g. disabled/private mode) — ignore, the
    // preference simply won't persist across launches.
  }
}
