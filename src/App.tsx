import { useEffect, useState } from 'react'
import type { JiraProfile } from '../shared/types'

export function App() {
  const [status, setStatus] = useState('checking…')
  const [profile, setProfile] = useState<JiraProfile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setStatus(d.ok ? 'connected' : 'unexpected response'))
      .catch(() => setStatus('backend not reachable'))

    fetch('/api/profile')
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setProfile(d)))
      .catch((e) => setError(String(e)))
  }, [])

  return (
    <main className="app">
      <h1>Tempo Timesheet Tool</h1>
      <p className="muted">Backend: {status}</p>
      {profile && (
        <p>
          Signed in as <strong>{profile.displayName}</strong> ({profile.timeZone})
        </p>
      )}
      {error && <p className="error">Profile check failed: {error}</p>}
      <p className="muted">Day-view UI coming next.</p>
    </main>
  )
}
