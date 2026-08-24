import { useCallback, useEffect, useRef, useState } from 'react'
import type { Update } from '@tauri-apps/plugin-updater'

export interface PendingUpdate {
  version: string
  notes: string
}

export type UpdaterPhase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'upToDate' }
  | { kind: 'available'; update: PendingUpdate }
  | { kind: 'downloading'; receivedBytes: number; totalBytes: number | null }
  | { kind: 'ready'; version: string }
  | { kind: 'error'; message: string }

const AUTO_CHECK_DELAY_MS = 4000

// Wraps tauri-plugin-updater for the whole app. One instance lives in App so
// the header badge and the settings section share the same phase. The launch
// check is silent on failure (dev builds and offline machines just stay idle);
// manual checks surface errors.
export function useAppUpdater() {
  const [phase, setPhase] = useState<UpdaterPhase>({ kind: 'idle' })
  const updateRef = useRef<Update | null>(null)
  const runningRef = useRef(false)

  const runCheck = useCallback(async (announceErrors: boolean) => {
    if (runningRef.current) return
    runningRef.current = true
    setPhase({ kind: 'checking' })
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()
      if (update) {
        updateRef.current = update
        setPhase({ kind: 'available', update: { version: update.version, notes: update.body ?? '' } })
      } else {
        updateRef.current = null
        setPhase({ kind: 'upToDate' })
      }
    } catch (error) {
      updateRef.current = null
      setPhase(announceErrors ? { kind: 'error', message: (error as Error).message } : { kind: 'idle' })
    } finally {
      runningRef.current = false
    }
  }, [])

  const install = useCallback(async () => {
    const update = updateRef.current
    if (!update || runningRef.current) return
    runningRef.current = true
    let receivedBytes = 0
    let totalBytes: number | null = null
    setPhase({ kind: 'downloading', receivedBytes: 0, totalBytes: null })
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          totalBytes = event.data.contentLength ?? null
        } else if (event.event === 'Progress') {
          receivedBytes += event.data.chunkLength
        } else {
          return
        }
        setPhase({ kind: 'downloading', receivedBytes, totalBytes })
      })
      setPhase({ kind: 'ready', version: update.version })
    } catch (error) {
      setPhase({ kind: 'error', message: (error as Error).message })
    } finally {
      runningRef.current = false
    }
  }, [])

  const restartToUpdate = useCallback(async () => {
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => void runCheck(false), AUTO_CHECK_DELAY_MS)
    return () => clearTimeout(timer)
  }, [runCheck])

  return {
    phase,
    checkForUpdate: useCallback(() => void runCheck(true), [runCheck]),
    install,
    restartToUpdate,
  }
}

export type AppUpdater = ReturnType<typeof useAppUpdater>
