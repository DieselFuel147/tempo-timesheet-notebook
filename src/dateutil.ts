// Local-date helpers. Everything is a YYYY-MM-DD string in the user's own
// timezone — no UTC juggling, because a worklog's date is a wall-clock date.

export function todayISO(): string {
  return toISO(new Date())
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + n)
  return toISO(dt)
}

/** ISO date of the Monday that starts the week containing `iso`. */
export function startOfWeek(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const weekday = new Date(y, m - 1, d).getDay() // 0 = Sunday
  return addDays(iso, -((weekday + 6) % 7))
}

/** The seven ISO dates (Monday..Sunday) of the week containing `iso`. */
export function weekDates(iso: string): string[] {
  const monday = startOfWeek(iso)
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index))
}

/** "Fri 9 May 2025" for the header. */
export function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** minutes-from-midnight -> "HH:mm" (wraps within a day). */
export function minutesToHHmm(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/** "1h 30m" | "90m" | "2h" | "90" | "" -> total minutes, or null for invalid/empty. */
export function parseDuration(input: string): number | null {
  const trimmed = input.trim()
  if (trimmed === '') return null
  const hMatch = trimmed.match(/(\d+)\s*h/i)
  const mMatch = trimmed.match(/(\d+)\s*m/i)
  const hours = hMatch ? parseInt(hMatch[1], 10) : 0
  const minutes = mMatch ? parseInt(mMatch[1], 10) : 0
  if (hours > 0 || minutes > 0) return hours * 60 + minutes
  const plainNum = parseInt(trimmed, 10)
  if (Number.isFinite(plainNum) && plainNum > 0) return plainNum
  return null
}
