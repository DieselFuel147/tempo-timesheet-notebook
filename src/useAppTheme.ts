import { useMemo } from 'react'
import useMediaQuery from '@mui/material/useMediaQuery'
import { createAppTheme, type ThemeMode } from './theme'

// Builds a MUI theme that follows the OS appearance. Light mode matches the
// "Ledger" demo; dark mode is a warm dark variant of the same design language.
export function useAppTheme() {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)')
  const mode: ThemeMode = prefersDark ? 'dark' : 'light'
  return useMemo(() => createAppTheme(mode), [mode])
}
