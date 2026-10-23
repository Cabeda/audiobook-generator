/**
 * Persisted stores.
 *
 * localStorage-backed writable stores for preferences that outlive a session.
 * Used by the TTS settings and the reader preferences; anything the app
 * "remembers" goes through here so remembering works the same everywhere.
 */

import { writable, type Writable } from 'svelte/store'
import logger from '../lib/utils/logger'

/** A localStorage-synced writable; falls back to the default when unset. */
export function persistedWritable<T>(key: string, defaultValue: T): Writable<T> {
  let initialValue = defaultValue

  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(key)
      if (stored) {
        initialValue = JSON.parse(stored) as T
      }
    } catch (e) {
      logger.warn(`Failed to load ${key} from localStorage:`, e)
    }
  }

  const store = writable<T>(initialValue)

  if (typeof window !== 'undefined') {
    store.subscribe((value) => {
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch (e) {
        logger.warn(`Failed to save ${key} to localStorage:`, e)
      }
    })
  }

  return store
}

/** Like persistedWritable, but the default is computed only when nothing is stored. */
export function persistedWritableWithAdaptiveDefault<T>(
  key: string,
  getDefault: () => T
): Writable<T> {
  let hasStoredValue = false
  let storedValue: T | undefined

  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(key)
      if (stored !== null) {
        hasStoredValue = true
        storedValue = JSON.parse(stored) as T
      }
    } catch (e) {
      logger.warn(`Failed to load ${key} from localStorage:`, e)
    }
  }

  return persistedWritable(key, hasStoredValue ? (storedValue as T) : getDefault())
}
