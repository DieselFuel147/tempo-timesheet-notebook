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

/** minutes-from-midnight -> "9:45 am" / "12:30 pm" (wraps within a day). */
export function minutesTo12hTime(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440
  const hours24 = Math.floor(m / 60)
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  return `${hours12}:${String(m % 60).padStart(2, '0')} ${m < 720 ? 'am' : 'pm'}`
}

// Masked "h:mm am/pm" entry helpers backing the notebook's start/end fields.
// The native time input paints empty segments with real-looking digits that
// are indistinguishable from entered ones, so the field is built from a plain
// text input plus these pure helpers instead.

export interface Time12hDraft {
  hour: string
  minute: string
  /** True once the hour can no longer grow (single digit 2–9, or two digits). */
  hourClosed: boolean
  meridiem: 'am' | 'pm' | null
}

export const EMPTY_TIME_12H_DRAFT: Time12hDraft = { hour: '', minute: '', hourClosed: false, meridiem: null }

/** Progressive draft rendering: "" -> "9" -> "9:4" -> "9:45 pm"; unfinished
 * meridiem renders as "--" once the digits are complete. */
export function format12hDraft(draft: Time12hDraft): string {
  let out = draft.hour
  if (draft.hourClosed) out += `:${draft.minute}`
  if (draft.meridiem !== null) out += ` ${draft.meridiem}`
  else if (draft.hourClosed && draft.minute.length === 2) out += ' --'
  return out
}

/** Parses free keystrokes into a draft: digits fill hour then minutes (with
 * smart flow — "9" closes the hour, "1" waits for a second digit, an
 * impossible pair rolls into minutes), "a"/"p" set the meridiem. Parsing its
 * own formatted output is stable, so committed values seed edits cleanly. */
export function parse12hDraftInput(input: string): Time12hDraft {
  const draft: Time12hDraft = { ...EMPTY_TIME_12H_DRAFT }
  for (const rawChar of input.toLowerCase()) {
    if (rawChar === 'a' || rawChar === 'p') {
      draft.meridiem = rawChar === 'a' ? 'am' : 'pm'
      continue
    }
    if (rawChar < '0' || rawChar > '9') continue
    if (!draft.hourClosed && draft.hour.length < 2) {
      if (draft.hour.length === 0) {
        draft.hour = rawChar
        draft.hourClosed = rawChar > '1'
      } else if (draft.hour === '1' && rawChar <= '2') {
        // 11 or 12
        draft.hour += rawChar
        draft.hourClosed = true
      } else if (draft.hour === '0') {
        // Leading-zero hours are always two digits: 01..09
        draft.hour += rawChar
        draft.hourClosed = true
      } else {
        draft.hourClosed = true
        draft.minute = rawChar
      }
    } else if (draft.minute.length < 2) {
      draft.minute += rawChar
    }
  }
  return draft
}

/** Minutes-from-midnight for a fully entered draft, or null while any part
 * (hour, both minute digits, meridiem) is missing or out of range. */
export function complete12hDraftMinutes(draft: Time12hDraft): number | null {
  if (!draft.hourClosed || draft.minute.length !== 2 || draft.meridiem === null) return null
  const hours = Number(draft.hour)
  const mins = Number(draft.minute)
  if (hours < 1 || hours > 12 || mins > 59) return null
  return (hours % 12) * 60 + mins + (draft.meridiem === 'pm' ? 720 : 0)
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
