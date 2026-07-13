import { useMemo } from 'react'
import useMediaQuery from '@mui/material/useMediaQuery'
import { createAppTheme, type ThemeMode } from './theme'
import type { Appearance } from './appearance'

// Builds a MUI theme from the user's appearance preference. "Auto" follows the
// OS appearance; "light"/"dark" pin the theme regardless of OS setting. Light
// mode matches the "Ledger" demo; dark mode is a warm dark variant of the same
// design language.
export function useAppTheme(appearance: Appearance) {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)')
  const mode: ThemeMode = appearance === 'auto' ? (prefersDark ? 'dark' : 'light') : appearance
  return useMemo(() => createAppTheme(mode), [mode])
}
