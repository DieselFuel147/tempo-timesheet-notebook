// The markdown file stays the single editable source of truth; Vite inlines
// it as a string at build time so dev mode and the packaged Tauri app both
// ship the same content with zero runtime file access.
import guideMarkdown from '../../../docs/user-guide.md?raw'

export const USER_GUIDE_MARKDOWN: string = guideMarkdown
