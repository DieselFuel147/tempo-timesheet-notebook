import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'

// Thin, failure-tolerant wrapper over the Tauri notification plugin: outside
// Tauri (plain `dev:web`) or without user consent everything degrades to a
// silent no-op instead of throwing into the reminder loop.

export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (await isPermissionGranted()) return true
    const granted = (await requestPermission()) === 'granted'
    if (!granted) {
      // Unbundled `tauri dev` binaries can't register with UNUserNotificationCenter
      // on macOS, so this is the expected path there — surfaced for debugging.
      console.warn('[notifications] permission not granted; reminders stay silent')
    }
    return granted
  } catch (cause) {
    console.warn('[notifications] permission check failed:', cause)
    return false
  }
}

export async function sendReminder(payload: { title: string; body: string }): Promise<boolean> {
  try {
    await sendNotification(payload)
    return true
  } catch (cause) {
    console.warn('[notifications] send failed:', cause)
    return false
  }
}
