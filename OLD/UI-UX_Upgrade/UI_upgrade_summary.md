# Timesheet Notebook — UI/UX Summary

## Purpose

A split-view UI for converting freeform written notes into discrete, timestamped
time entries with minimal manual effort. The core problem it solves: notes get
written continuously and irregularly throughout the day, but time entries need
clean start/end boundaries and short summaries. This design infers those
boundaries from *when* you type, rather than asking you to manually log time
separately from your notes.

## Layout

Two panels, side by side (stacked on mobile):

- **Left — the notebook.** A ruled-paper editor made of stacked text blocks
  ("entries"), each with its own timestamp chip. This is where all typing
  happens.
- **Right — the ruler.** A vertical timeline that mirrors the notebook. Each
  entry renders as a colored block positioned and sized by its actual
  start/end time; gaps between entries render as hatched space.

The two panels always represent the same underlying data — the notebook is
the input surface, the ruler is the readout/adjustment surface.

## Data model

Everything is a flat, chronologically-ordered list of **entries** (called
`blocks` in the code):

```
{
  id, start, end,       // in minutes from session start; null = not started yet
  text,                 // the note content
  closed,                // true once the entry is finalized
  summary,               // manual override for the auto-generated summary
  ticketId,              // free-text ticket reference, e.g. "ABC-1234"
}
```

A per-entry `summary` override rides alongside the text; otherwise the
summary is auto-derived from the entry's own text (first ~7 words). Summaries
are always per-entry — entries never share a summary, even when they share a
ticket ID (see Ticket-based grouping, below).

## Core behaviors

### 1. Auto-segmentation via idle detection
Typing continuously stays within one entry. When you stop typing for longer
than a pause threshold, the entry you were writing closes automatically (its
end time is fixed) — no manual action needed for the common case of "write,
pause, write about something else."

### 2. An entry is always available to type into, immediately
Regardless of whether the idle timer has fired yet, there is always exactly
one blank "type a note…" entry sitting at the bottom of the notebook. Typing
into it does two things at once:
- If a different entry is still open (idle timer hasn't closed it yet), that
  entry closes immediately, right now — this is the manual "I'm done with
  this, start a new one" shortcut, so the user is never blocked on waiting
  out the pause threshold.
- The blank entry itself becomes the new active entry.

This means the pause threshold can be tuned generously (e.g. several minutes)
without ever forcing the user to wait — deliberately switching tasks is
always one tap + keystroke away.

### 3. Every entry stays editable — only the most recent one adjusts time
Any entry, closed or not, can be tapped into and typed into at any time — you
can always go back and add more detail to a note from earlier in the day.
Editing text on its own never touches an entry's timestamps, with one
deliberate exception:

- The single most-recently-closed entry (directly above the blank one) is
  additionally marked (dashed outline, "tap to continue" hint), because
  typing into it does one extra thing: its end time silently extends to
  *now*, absorbing whatever idle gap has passed since it closed. This only
  commits on the **first keystroke**, not on tap/focus alone, so accidentally
  tapping into it never costs any time.
- Every other, older entry is editable the same way, but purely as a text
  edit — its start/end/closed state never changes no matter what you type
  into it.

This split exists because "the entry I was just writing" and "an entry from
earlier" mean different things when you come back to them: the first is
almost always a literal continuation of the same stretch of work, the second
is a deliberate retroactive edit that shouldn't silently rewrite when that
work happened.

### 4. Manual boundary adjustment (drag pins)
Every closed entry on the ruler has two small draggable handles ("pins") at
its top and bottom edges. Dragging a pin directly resizes that entry's
start or end time, clamped so it can't overlap its neighbors. This is the
fallback for "the automatic boundary is close but not quite right."

### 5. Edge-arrow gap absorption
Tapping a closed entry on the ruler expands it, revealing chevron buttons on
any edge that borders a real gap. Tapping the chevron snaps that edge outward
to fully swallow the adjacent gap in one action — for cases where the elapsed
real time *was* spent on that task (a meeting, a call, heads-down thinking)
even though nothing was typed. This is a shortcut for "drag the pin all the
way," not a different mechanism.

### 6. Ticket ID, and two distinct ways entries relate to each other

Every entry has a **ticket ID field** — free text, formatted like `ABC-1234`,
no validation. It's a primary, prominent field on each note (not buried in
the summary), since it's the field a real integration would use to route the
entry to the right place.

Ticket ID drives two *separate* mechanisms, which is worth keeping distinct:

**a. Automatic same-ticket grouping (visual only, no merging of data).**
Any entries that share the same non-empty ticket ID — however far apart in
time, with anything else in between — automatically get the same color and a
dashed connector line drawn across the ruler linking them, plus a small
count badge. This is purely a "these are the same piece of work" visual cue.
It does **not** combine their durations, does **not** give them a shared
summary, and requires no manual action — it falls out of typing the same
ticket ID into two entries. Entries with different (or no) ticket ID never
share a color this way.

**b. Merge (manual, consecutive entries only).**
Tapping an entry on the ruler to expand it offers "Merge with previous" /
"Merge with next" whenever an adjacent entry (immediately before/after it in
time, no other real entry between them) is also closed. Unlike (a), this
actually **fuses the two entries into one**: their text is concatenated,
their time span becomes one continuous range (closing whatever gap sat
between them), and they collapse into a single entry with one summary. This
is deliberately scoped to only ever join two *consecutive* entries — it's not
a way to link entries from opposite ends of the day. If you want to associate
notes written far apart under one piece of work without touching their
individual times, that's what the ticket ID is for (a), not this.

A simple way to hold the distinction: **ticket ID says "this is the same
work"; Merge says "this is actually the same entry."**

### 7. Editable summaries
Every entry shows an auto-generated short summary derived from its own text,
with a pencil icon to override it manually. This is the field that would
eventually be replaceable with an AI-generated summary from the full note
text — the manual-override path is already there to slot that in later.

## Interaction principles worth preserving

- **Every state-changing action requires a real gesture, not just focus.**
  Reopening the most recent entry never silently changes its time from a tap
  alone — only an actual keystroke commits it. Merge is a direct, explicit
  button per action (no ambiguous multi-select state to leave dangling).
  This avoids accidental data loss from stray taps.
- **Tap-to-reveal, not hover.** All secondary controls (pins, gap-absorb
  arrows, merge buttons) only appear once an entry is explicitly expanded by
  tapping it, rather than relying on hover states — this was a deliberate
  mobile-first choice since hover doesn't exist on touch.
- **The editor and the timeline are two views of one source of truth**, but
  the editor should be implementation-isolated from anything that
  re-renders on a timer (live "now" ticking for the ruler). Coupling them
  caused the mobile virtual keyboard to drop on every re-render tick in the
  prototype — worth remembering as a concrete pitfall if re-implementing
  with a different state/rendering approach.
- **Colors are assigned by chronological order, not by identity** — entries
  cycle through a small fixed palette as they're written, except that entries
  sharing a ticket ID all adopt whichever color was assigned to the earliest
  entry with that ticket ID. This keeps the ruler visually scannable without
  needing a color-per-ticket legend.

## Visual language (can be restyled freely)

The prototype used a "ledger" aesthetic — ruled paper, monospace timestamps,
a vertical ruler with tick marks, brass-colored drag pins, stamp-red accents
for gaps/warnings — but none of this is load-bearing. A later MUI-based pass
kept every behavior above identical and only swapped presentation (`Paper`,
`Chip`, `IconButton`, a custom theme) for the raw styled `div`s. The
behaviors in this doc are the part worth carrying forward; the specific
color palette and typography are not.

## Fields to add for real use (not yet in the prototype)

- `ticketName` per entry — the ticket ID field is implemented as free text;
  resolving it to a display name (and validating it's a real ticket) would
  come from a Jira ticket search/autocomplete, cached once looked up.
- A `synced` / `tempoWorklogId` field per entry once Tempo submission is
  wired up, so re-sending is idempotent.
- A review/submit step, separate from the always-live notebook view, where
  the day's entries are reviewed and sent to Tempo as a batch — this UI is
  deliberately scoped to *capture and shape* the entries, not to handle
  submission.