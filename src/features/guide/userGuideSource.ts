// The markdown file stays the single editable source of truth; Vite inlines
// it as a string at build time so dev mode and the packaged Tauri app both
// ship the same content with zero runtime file access.
import guideMarkdown from '../../../docs/user-guide.md?raw'

export const USER_GUIDE_MARKDOWN: string = guideMarkdown

// ?raw modules aren't reliably wired into HMR, so an edited guide would
// otherwise keep serving stale text until a manual reload. Accept the update
// and take the cheap way out: one full window reload in dev.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload())
}
