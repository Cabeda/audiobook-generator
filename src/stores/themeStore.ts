import { writable } from 'svelte/store'
import logger from '../lib/utils/logger'

const APP_THEME_KEY = 'app_theme'

export type Theme = 'light' | 'dark'

// Check for system preference in browser
function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'

  try {
    const saved = localStorage.getItem(APP_THEME_KEY)
    if (saved === 'dark' || saved === 'light') {
      return saved
    }
    // Default to system preference
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark'
    }
  } catch (e) {
    logger.warn('Failed to load theme from localStorage:', e)
  }

  return 'light'
}

export const appTheme = writable<Theme>(getInitialTheme())

// Persist theme changes to localStorage
if (typeof window !== 'undefined') {
  appTheme.subscribe((theme) => {
    try {
      localStorage.setItem(APP_THEME_KEY, theme)
      document.body.setAttribute('data-theme', theme)
    } catch (e) {
      logger.warn('Failed to save theme to localStorage:', e)
    }
  })
}

export function toggleTheme() {
  appTheme.update((current) => (current === 'light' ? 'dark' : 'light'))
}
