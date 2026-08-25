# Timesheet Notebook Guide

Log your day as you go in a plain notebook, see it laid out on a timeline, then push clean worklogs to Tempo. Everything stays on your machine until you push.
This exists as a faster, easier way to log time "as you go" into Tempo. 

> **Tip:** Use the Notebook section as your full time note taking destination, not just a time logging tool. The summary is what gets pushed to tempo, so it can be reduced with local AI or re-written yourself.

## First steps

From a fresh install to your first pushed day. Open **Settings** (gear icon in the header) - every connection lives there. You can jot down time before connecting anything, but autocomplete needs Jira and pushing needs Tempo.

### Connect Jira

- Set **Jira base URL** to your Atlassian site root, e.g. `https://your-company.atlassian.net`.
- Enter your account email, then create an API token at `id.atlassian.com/manage-profile/security/api-tokens` using **Create API token** - the plain token, *not* the "with scopes" option, which the app cannot use yet.
- The app signs in as you and only reads: your profile, issue summaries, and ticket search. Your account just needs **Browse Projects** on the projects you log against - never write access.
- Press **Save**. Once connected, the header shows your display name and time zone, and ticket fields autocomplete as you type.

### Connect Tempo

- Go to **Tempo → Settings → DATA ACCESS → API integration → New Token → Custom Access** and grant exactly one scope: **Worklogs Scope · View and Manage**. Leave every other scope off.
- Paste the token into **Tempo API token** in Settings. The base URL already points at the public API root (`https://api.tempo.io/4`) - change it only if you use a self-hosted instance.
- Both tokens are stored in the macOS Keychain, never in the app database.

> **Tip:** Use **Clear saved token** next to either field to remove a stored token from the Keychain.

### General preferences

- Be sure to set your personal Jira admin ticket for logging general tasks, quickly selectable from the icon next to the ticket field in an entry.
- Configure your preferred start and end work day times, along with min/max warning thresholds. These are purely to drive the warnings, no bearing on other functionality.
- Set your preferred Max summary length, this controls how many characters auto filled or generated summaries can contain as this is what gets pushed to Tempo. If you manual type a summary it is not limited.
- Desktop notifications can be enabled in the "Reminders" section with a configurable interval of no activity. 

### Optional: set up local AI summaries

The **Suggest** button drafts a worklog description from an entry's notes using a small model that runs entirely on your machine. It needs two things installed once:

- A llama.cpp `llama-server` binary - e.g. via Homebrew, which lands at `/opt/homebrew/bin/llama-server`.
- A GGUF model file - Gemma-3-1b (e.g. `gemma-3-1b-it-Q4_K_M.gguf`) is a good fit for short summaries.

Then in **Settings → AI (local summaries)**: paste both absolute paths into the path fields, switch on **Enable local AI summaries**, and adjust the idle shutdown if you like (the model process stops after that many idle seconds). The status bar shows `ai · loaded/unloaded` while enabled. Nothing is ever sent to an external service.

### Log and push your first day

- Pick the date in the toolbar, click into the empty entry at the bottom of the Notebook, and type what you did.
- Fill in a ticket key (autocomplete suggests matches once Jira is connected) - the entry then tracks live time while open.
- After a few minutes of no activity, end time will be set or press **Close** on the entry when you move on; its end locks to the current minute.
- When the day looks right, hit **Dry run** to preview exactly what Tempo would receive, then **Push**.

## Getting around

The whole app is one window: a header, a date toolbar, the Notebook and Timeline views of the same day, and a stats strip at the bottom.

- **Header** - app title with your Jira identity underneath, a clock with a logging/idle dot, then icons for this user guide, the activity log, and Settings. An update badge appears here when a new version is available.
- **Date toolbar** - step to the previous/next day or jump back to today, plus the **Dry run** and **Push** buttons.
- **Two views, one day** - the Notebook is where you write; the Timeline shows the same entries as movable bars. On wide windows they sit side-by-side with a draggable splitter; on narrow ones they stack and swap via tabs. The timeline can be hidden entirely with its panel toggle.
- **Status bar** - running totals: `blocks`, `tickets`, `ready` (unsynced), `synced`, `tracked` (day total), `week` total, `errors`, `warnings`, and the AI state when enabled.

## Logging your day

- Each entry card has freeform notes, a ticket field, start/end times, and the summary that will be uploaded.
- While an entry is open it follows the current time. Closing manually locks the end; leaving the app idle long enough also closes the entry automatically - keep typing in it to resume. Manually closed entries stay closed.
- The most recently closed entry shows a dashed outline while the day ends with it: type into that slot to continue the same note instead of starting a new entry.
- The ticket field autocompletes known keys from Jira (uppercase, shape `ABC-123`). It turns red for malformed keys but still works offline as plain text.
- The small admin button stamps the configured general-admin ticket (default `ADMINTICKET-123`, adjustable in Settings).
- **UNTRACKED** entries are deliberate gap-fillers for time you do not want to log: they render on the timeline and count towards nothing - validation ignores them and pushes skip them.
- The uploaded summary is your explicit **summary override** if set, otherwise the first line of your notes trimmed to the character limit (an ellipsis marks truncation). Press **Suggest** to have the local AI draft one from the notes.
- Editing times by duration adjusts the end time; everything autosaves as you type.
- Editing an already-synced entry clears its synced marker so it goes out again on your next push. Pushes always create worklogs - the earlier copy in Tempo stays until you delete it there.

> **Tip:** Notes are for your future self: the note text itself never leaves this machine.

## Timeline

- Tap a closed block to reveal drag pins, gap-absorb controls, and merge actions; tap elsewhere to deselect.
- Drag the pins to reshape a block's edges, or drag the block body to move it in time.
- Double-click empty timeline space to create a new entry sized to that gap.
- Entries sharing a ticket key share a colour and stay visually connected across gaps in the day.
- Skinny bars along the right edge are worklogs already confirmed in Tempo - use the filter icon to show or hide them.
- The timeline column can be resized (splitter), collapsed (panel toggle), or swapped with the notebook on narrow windows.

## Pushing to Tempo

- **Dry run** builds the exact HTTP request Tempo would receive - auth redacted - and sends nothing.
- **Push** uploads every closed, timed entry that has a valid ticket key and a non-empty summary, except entries already synced and anything UNTRACKED.
- Ticket existence is verified against Jira at push time (results are cached), so typos surface before anything is created.
- If any summary would be uploaded truncated, a confirmation dialog lists them: accept each as-is or rewrite it before the push continues.
- Failures are reported per entry through a toast and the activity log; a bad entry never blocks the rest of the day.
- Successfully pushed entries are marked synced, skipped on later pushes, and appear as skinny bars in the timeline.

Any **error** blocks the entire day's push until fixed; **warnings** are informational and never stop a push.

### Validation rules

| Rule | Level | Meaning |
| --- | --- | --- |
| Invalid ticket key | Error | Empty or not shaped like `ABC-123`. |
| Impossible times | Error | Closed entries need both start and end; end must be after start; open entries cannot have an end. |
| Overlap | Error | Two closed entries cover the same minutes. |
| Too short / too long | Warning | Single entry under the minimum length (default 10 min) or over the maximum (default 4h). |
| Early / late | Warning | Starts or ends outside normal working hours (default 08:00–18:00). |
| No note text | Warning | Entry has no description - add detail for what you did. |
| Day low / day high | Warning | Total logged hours outside the expected range (default 4–12h). UNTRACKED time is ignored here. |

All thresholds are adjustable in **Settings → Validation thresholds**.

## Settings reference

### Connections

Jira base URL, account email, and API token; Tempo base URL and API token. Tokens go to the Keychain on save; **Clear saved token** removes them. Trailing slashes on base URLs are trimmed automatically.

### Validation thresholds

General-admin ticket key, normal-hours window, minimum entry minutes, maximum entry hours, minimum and maximum logged hours per day, and the summary character limit (never below 20).

### AI (local summaries)

Enable switch, `llama-server` binary path, GGUF model path, idle shutdown seconds, and the system prompt sent with every Suggest request (with a reset-to-default button). With AI disabled or misconfigured, Suggest simply reports that it is unavailable.

### Reminders

A macOS notification when your entries have gone stale: enable the reminder and set the idle minutes before it fires. Reminders only arrive during normal working hours on weekdays, and macOS asks for notification permission the moment you enable it.

### Appearance and updates

Switch between light and dark themes or auto to follow system.

### Updates

The app checks for updates on its own; when one is found a badge appears on the header's update icon and the install completes from Settings.

## Activity log

The clipboard icon in the header opens a running list of recent dry-run and push outcomes, including per-entry errors. Toasts after each action link straight to it.

## Privacy and storage

- All data lives in a single local database in the app's data folder - there is no server and no cloud sync.
- Jira and Tempo tokens live only in the macOS Keychain, so backups of the database never contain secrets.
- Pushes send only the ticket key, summary, and time span. Note text never leaves this machine, and the AI summarizer runs locally.
