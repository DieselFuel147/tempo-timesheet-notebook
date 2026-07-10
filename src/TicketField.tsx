import { useEffect, useRef, useState } from 'react'
import PsychologyIcon from '@mui/icons-material/Psychology'
import { api, type TicketSuggestion } from './api'
import { defaultConfig } from '../shared/validation'

interface Props {
  value: string
  invalid: boolean
  onChange: (key: string) => void
  onAdmin: () => void
}

// Ticket input with debounced Jira autocomplete. Turns red when the value is
// non-empty but not a valid key. Autocomplete is best-effort: if Jira isn't
// reachable, the field still works as a plain text input.
export function TicketField({ value, invalid, onChange, onAdmin }: Props) {
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<TicketSuggestion[]>([])
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const query = useRef(value)
  query.current = value

  useEffect(() => {
    if (!open) return
    const handle = setTimeout(() => {
      api
        .tickets(query.current.trim())
        .then((list) => setSuggestions(list.slice(0, 8)))
        .catch(() => setSuggestions([]))
    }, 250)
    return () => clearTimeout(handle)
  }, [value, open])

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [])

  function choose(s: TicketSuggestion) {
    onChange(s.key)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(suggestions[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="ticket-field" ref={boxRef}>
      <div className={invalid ? 'ticket-field-group invalid' : 'ticket-field-group'}>
        <input
          className="ticket-input"
          value={value}
          placeholder="ABC-123"
          spellCheck={false}
          autoCapitalize="characters"
          onChange={(e) => {
            onChange(e.target.value.toUpperCase())
            setOpen(true)
            setActive(0)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="admin-icon-btn"
          title={`Log as general admin (${defaultConfig.adminTicket})`}
          onClick={onAdmin}
        >
          <PsychologyIcon sx={{ fontSize: 18 }} />
        </button>
      </div>
      {open && suggestions.length > 0 && (
        <ul className="ticket-suggestions">
          {suggestions.map((s, i) => (
            <li
              key={s.key}
              className={i === active ? 'active' : undefined}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(s)
              }}
            >
              <span className="sugg-key">{s.key}</span>
              <span className="sugg-summary">{s.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
