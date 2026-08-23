import { useEffect, useState } from 'react'
import { api } from '@app/api'

// Poll the local model's loaded/unloaded state for the status bar, but only
// while AI is enabled so we don't invoke the command needlessly.
export function useAiStatus(enabled: boolean): boolean {
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setRunning(false)
      return
    }
    let cancelled = false
    const poll = () => {
      api
        .aiStatus()
        .then((status) => {
          if (!cancelled) setRunning(status.running)
        })
        .catch(() => {
          if (!cancelled) setRunning(false)
        })
    }
    poll()
    const handle = setInterval(poll, 4000)
    return () => {
      cancelled = true
      clearInterval(handle)
    }
  }, [enabled])

  return running
}
