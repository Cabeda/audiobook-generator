import type { Writable } from 'svelte/store'

/**
 * Creates a throttled Map store updater that batches rapid updates.
 * Instead of creating a new Map on every call, it collects pending
 * updates and flushes them on the next animation frame.
 */
export function createThrottledMapUpdater<K, V>(store: Writable<Map<K, V>>) {
  const pending = new Map<K, V>()
  let rafId: number | null = null

  function flush() {
    if (pending.size === 0) return
    store.update((map) => {
      const newMap = new Map(map)
      for (const [k, v] of pending) {
        newMap.set(k, v)
      }
      pending.clear()
      return newMap
    })
    rafId = null
  }

  return {
    /** Queue an update — will be flushed on next animation frame */
    set(key: K, value: V) {
      pending.set(key, value)
      if (rafId === null) {
        rafId = requestAnimationFrame(flush)
      }
    },
    /** Immediately flush all pending updates */
    flush() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      flush()
    },
    /** Cancel any pending updates */
    cancel() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      pending.clear()
    },
  }
}
