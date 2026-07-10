import type { Entry } from '../shared/types'
import type { ValidationIssue } from '../shared/validation'
import { entryDurationMinutes, defaultConfig } from '../shared/validation'
import { formatHours } from './dateutil'
import { TicketField } from './TicketField'

interface Props {
  entry: Entry
  issues: ValidationIssue[]
  onPatch: (patch: Partial<Entry>) => void
  onDelete: () => void
}

export function EntryRow({ entry, issues, onPatch, onDelete }: Props) {
  const errors = issues.filter((i) => i.level === 'error')
  const warnings = issues.filter((i) => i.level === 'warning')
  const ticketInvalid = errors.some((i) => i.code === 'INVALID_TICKET')

  const duration = entryDurationMinutes(entry)
  const synced = !!entry.tempoWorklogId
  const rowClass = [
    'entry',
    errors.length ? 'error' : warnings.length ? 'warning' : '',
    synced ? 'synced' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={rowClass}>
      <div className="entry-main">
        <div className="times">
          <input
            type="time"
            value={entry.start}
            onChange={(e) => onPatch({ start: e.target.value })}
            aria-label="Start time"
          />
          <span className="dash">–</span>
          <input
            type="time"
            value={entry.end}
            onChange={(e) => onPatch({ end: e.target.value })}
            aria-label="End time"
          />
          <span className="duration">
            {duration !== null && duration > 0 ? formatHours(duration) : '—'}
          </span>
        </div>

        <TicketField
          value={entry.ticketKey}
          invalid={ticketInvalid}
          onChange={(ticketKey) => onPatch({ ticketKey })}
          onAdmin={() => onPatch({ ticketKey: defaultConfig.adminTicket })}
        />

        <input
          className="summary"
          value={entry.summary}
          placeholder="What were you doing?"
          onChange={(e) => onPatch({ summary: e.target.value })}
          aria-label="Summary"
        />

        <div className="entry-actions">
          {synced && (
            <span className="synced-badge" title={`Logged to Tempo (worklog ${entry.tempoWorklogId})`}>
              ✓ Tempo
            </span>
          )}
          <button type="button" className="delete-btn" title="Delete entry" onClick={onDelete}>
            ×
          </button>
        </div>
      </div>

      {issues.length > 0 && (
        <ul className="entry-issues">
          {issues.map((i, idx) => (
            <li key={idx} className={i.level}>
              {i.level === 'error' ? '⛔' : '⚠️'} {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
