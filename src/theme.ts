import { createTheme, type Theme } from '@mui/material/styles'

export type ThemeMode = 'light' | 'dark'

// Shared type families. IBM Plex is bundled locally via @fontsource (see main.tsx)
// so it works offline in the packaged Tauri app.
export const SANS_FONT = "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif"
export const MONO_FONT = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace"

// Earthy block palette used by the editor left-borders and the ruler blocks.
// Keyed by mode so dark mode gets slightly lifted, higher-contrast variants.
export const blockColorsByMode: Record<ThemeMode, string[]> = {
  light: ['#2F6E5C', '#8A6A2F', '#4A5D8A', '#7A4A5D'],
  dark: ['#4E9E86', '#B79A55', '#7488BD', '#B07C90'],
}

export function blockColors(mode: ThemeMode): string[] {
  return blockColorsByMode[mode]
}

// Surface tokens the shell reuses (instruction strip, ruled paper, ruler panel,
// gap stripes, connectors) so App.tsx never hardcodes light-only rgba overlays.
interface LedgerTokens {
  barBg: string
  barText: string
  instructionBar: string
  ruledPaperBase: string
  ruledPaperLine: string
  rulerPanel: string
  rulerTickMajor: string
  rulerTickMinor: string
  rulerAxis: string
  gapStripe: string
  pinBorder: string
  ticketBadgeBg: string
  headerCaption: string
  footerAccent: string
}

const ledgerTokensByMode: Record<ThemeMode, LedgerTokens> = {
  light: {
    barBg: '#1F2B22',
    barText: '#EDEFE7',
    instructionBar: '#E2E5D8',
    ruledPaperBase: '#EDEFE7',
    ruledPaperLine: '#DEE2D2',
    rulerPanel: '#F4F5EF',
    rulerTickMajor: '#B9C0AE',
    rulerTickMinor: '#DDE1D4',
    rulerAxis: '#D7DBCC',
    gapStripe: '#C99089',
    pinBorder: '#F4F5EF',
    ticketBadgeBg: 'rgba(31,43,34,0.35)',
    headerCaption: '#B9C7BC',
    footerAccent: '#E7C9BF',
  },
  dark: {
    barBg: '#1C231B',
    barText: '#ECEDE3',
    instructionBar: '#20231D',
    ruledPaperBase: '#22241E',
    ruledPaperLine: '#2B2E26',
    rulerPanel: '#1E201A',
    rulerTickMajor: '#4A5142',
    rulerTickMinor: '#33372D',
    rulerAxis: '#3A3F33',
    gapStripe: '#8A5F58',
    pinBorder: '#12130F',
    ticketBadgeBg: 'rgba(0,0,0,0.4)',
    headerCaption: '#8FA394',
    footerAccent: '#D8A99E',
  },
}

export function ledgerTokens(mode: ThemeMode): LedgerTokens {
  return ledgerTokensByMode[mode]
}

// Allow reading ledger tokens straight off the theme in sx callbacks.
declare module '@mui/material/styles' {
  interface Theme {
    ledger: LedgerTokens
    blockColors: string[]
    monoFont: string
  }
  interface ThemeOptions {
    ledger?: LedgerTokens
    blockColors?: string[]
    monoFont?: string
  }
}

const lightPalette = {
  mode: 'light' as const,
  primary: { main: '#1F2B22' },
  secondary: { main: '#B5402C' },
  warning: { main: '#A9822E' },
  success: { main: '#3F7A54' },
  error: { main: '#B5402C' },
  info: { main: '#4A5D8A' },
  background: { default: '#DED9CA', paper: '#EDEFE7' },
  text: { primary: '#1F2B22', secondary: '#55645A' },
  divider: '#D7DBCC',
}

const darkPalette = {
  mode: 'dark' as const,
  primary: { main: '#7FB79F', contrastText: '#12130F' },
  secondary: { main: '#D9765F' },
  warning: { main: '#D7A64B' },
  success: { main: '#6FB58A' },
  error: { main: '#D9765F' },
  info: { main: '#8296C4' },
  background: { default: '#161712', paper: '#22241E' },
  text: { primary: '#ECEDE3', secondary: '#A6AC9C' },
  divider: '#33372D',
}

export function createAppTheme(mode: ThemeMode): Theme {
  return createTheme({
    palette: mode === 'light' ? lightPalette : darkPalette,
    shape: { borderRadius: 6 },
    typography: {
      fontFamily: SANS_FONT,
      button: { textTransform: 'none', fontWeight: 500 },
    },
    ledger: ledgerTokens(mode),
    blockColors: blockColors(mode),
    monoFont: MONO_FONT,
    components: {
      MuiButton: {
        styleOverrides: {
          root: { textTransform: 'none' },
        },
      },
    },
  })
}
