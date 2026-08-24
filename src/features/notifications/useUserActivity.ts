import { useEffect, useRef } from 'react'

/**
 * Tracks the last genuine interaction with the app (clicks, keys, scroll,
 * focus) as a millisecond timestamp. Deliberately broader than the notebook's
 * typing-activity ref: the inactivity reminder should fire even when the user
 * has been working in other apps and simply hasn't touched the timesheet.
 */
export function useUserActivity(): { current: number } {
  const lastActivityRef = useRef(Date.now())

  useEffect(() => {
    const mark = () => {
      lastActivityRef.current = Date.now()
    }
    window.addEventListener('pointerdown', mark, { passive: true })
    window.addEventListener('keydown', mark)
    window.addEventListener('wheel', mark, { passive: true })
    window.addEventListener('focus', mark)
    return () => {
      window.removeEventListener('pointerdown', mark)
      window.removeEventListener('keydown', mark)
      window.removeEventListener('wheel', mark)
      window.removeEventListener('focus', mark)
    }
  }, [])

  return lastActivityRef
}
