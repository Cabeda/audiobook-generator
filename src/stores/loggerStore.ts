import { writable, type Writable } from 'svelte/store'
import logger from '../lib/utils/logger'

// Storage key
const LOGGER_SEND_TO_BACKEND_KEY = 'audiobook_logger_send_to_backend'
const LOGGER_BACKEND_URL_KEY = 'audiobook_logger_backend_url'

// Helper to create a localStorage-synced writable store
function persistedWritable<T>(key: string, defaultValue: T): Writable<T> {
  let initialValue = defaultValue

  // Load from localStorage in browser
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(key)
      if (stored) {
        initialValue = JSON.parse(stored) as T
      }
    } catch (e) {
      // Use console directly here to avoid circular dependency
      console.warn(`Failed to load ${key} from localStorage:`, e)
    }
  }

  const store = writable<T>(initialValue)

  // Subscribe to changes and persist to localStorage
  if (typeof window !== 'undefined') {
    store.subscribe((value) => {
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch (e) {
        // Use console directly here to avoid circular dependency with logger
        // This is intentional as the logger depends on this store
        console.warn(`Failed to save ${key} to localStorage:`, e)
      }
    })
  }

  return store
}

// Logger configuration stores with localStorage persistence
export const loggerSendToBackend = persistedWritable<boolean>(LOGGER_SEND_TO_BACKEND_KEY, false)
export const loggerBackendUrl = persistedWritable<string>(
  LOGGER_BACKEND_URL_KEY,
  'https://audiobook-logs.vercel.app/api/logs'
)

// Subscribe to changes and update logger configuration
loggerSendToBackend.subscribe((value) => {
  logger.configure({ sendToBackend: value })
})

loggerBackendUrl.subscribe((value) => {
  logger.configure({ backendUrl: value })
})
