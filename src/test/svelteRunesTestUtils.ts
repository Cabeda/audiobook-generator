/**
 * Svelte 5 Runes Testing Utilities
 *
 * These utilities help test code that uses Svelte 5 runes ($state, $derived, $effect)
 * outside of component context. Since runes require compiler transformation and
 * component context, we use patterns that work with Vitest's jsdom environment.
 */

import { vi } from 'vitest'

/**
 * Creates a reactive state wrapper that mimics $state behavior for testing.
 * This allows testing code that reads/writes reactive state without needing
 * the Svelte compiler.
 *
 * @example
 * const count = createTestState(0)
 * count.value = 5
 * expect(count.value).toBe(5)
 */
export function createTestState<T>(initialValue: T): {
  value: T
  subscribe: (fn: (v: T) => void) => () => void
} {
  let value = initialValue
  const subscribers = new Set<(v: T) => void>()

  return {
    get value() {
      return value
    },
    set value(newValue: T) {
      value = newValue
      subscribers.forEach((fn) => fn(value))
    },
    subscribe(fn: (v: T) => void) {
      subscribers.add(fn)
      return () => subscribers.delete(fn)
    },
  }
}

/**
 * Creates a mock audio element for testing audio playback
 */
export function createMockAudioElement(): HTMLAudioElement {
  const listeners: Record<string, (() => void)[]> = {}
  let currentTime = 0
  let duration = 10
  let paused = true
  let playbackRate = 1.0
  let src = ''

  const audio = {
    get currentTime() {
      return currentTime
    },
    set currentTime(value: number) {
      currentTime = value
      listeners['timeupdate']?.forEach((fn) => fn())
    },
    get duration() {
      return duration
    },
    set duration(value: number) {
      duration = value
    },
    get paused() {
      return paused
    },
    get playbackRate() {
      return playbackRate
    },
    set playbackRate(value: number) {
      playbackRate = value
    },
    get src() {
      return src
    },
    set src(value: string) {
      src = value
      // Trigger loadedmetadata after setting src
      setTimeout(() => {
        listeners['loadedmetadata']?.forEach((fn) => fn())
      }, 0)
    },
    play: vi.fn().mockImplementation(() => {
      paused = false
      return Promise.resolve()
    }),
    pause: vi.fn().mockImplementation(() => {
      paused = true
    }),
    addEventListener: vi.fn((event: string, handler: () => void) => {
      listeners[event] = listeners[event] || []
      listeners[event].push(handler)
    }),
    removeEventListener: vi.fn((event: string, handler: () => void) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((h) => h !== handler)
      }
    }),
    // Event handlers (for direct assignment)
    onloadedmetadata: null as (() => void) | null,
    ontimeupdate: null as (() => void) | null,
    onended: null as (() => void) | null,
    onerror: null as ((e: Event) => void) | null,
    // Helper to simulate events
    _emit(event: string) {
      listeners[event]?.forEach((fn) => fn())
      const handler = (this as Record<string, unknown>)[`on${event}`]
      if (typeof handler === 'function') {
        handler()
      }
    },
    // Helper to simulate playback completion
    _complete() {
      paused = true
      this._emit('ended')
    },
    // Helper to simulate time update
    _tick(seconds: number) {
      currentTime += seconds
      this._emit('timeupdate')
    },
  }

  return audio as unknown as HTMLAudioElement
}

/**
 * Creates a mock URL object for blob URL testing
 */
export function setupMockURL(): { createdUrls: string[]; revokedUrls: string[] } {
  const createdUrls: string[] = []
  const revokedUrls: string[] = []
  let urlCounter = 0

  URL.createObjectURL = vi.fn((_blob: Blob) => {
    const url = `blob:mock-url-${urlCounter++}`
    createdUrls.push(url)
    return url
  })

  URL.revokeObjectURL = vi.fn((url: string) => {
    revokedUrls.push(url)
  })

  return {
    createdUrls,
    revokedUrls,
  }
}

/**
 * Waits for a condition to be true, useful for testing async reactive updates
 */
export async function waitFor(
  condition: () => boolean,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 5000, interval = 50 } = options
  const startTime = Date.now()

  return new Promise((resolve, reject) => {
    const check = () => {
      if (condition()) {
        resolve()
        return
      }

      if (Date.now() - startTime > timeout) {
        reject(new Error('waitFor timeout exceeded'))
        return
      }

      setTimeout(check, interval)
    }

    check()
  })
}

/**
 * Flushes pending promises and microtasks
 */
export async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Creates a deferred promise that can be resolved/rejected externally
 */
export function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

/**
 * Mock for Web Speech API's SpeechSynthesis
 */
export function createMockSpeechSynthesis(): SpeechSynthesis {
  const utterances: SpeechSynthesisUtterance[] = []

  return {
    speaking: false,
    pending: false,
    paused: false,
    onvoiceschanged: null,
    getVoices: vi.fn(() => [
      {
        voiceURI: 'mock-voice',
        name: 'Mock Voice',
        lang: 'en-US',
        localService: true,
        default: true,
      } as SpeechSynthesisVoice,
    ]),
    speak: vi.fn((utterance: SpeechSynthesisUtterance) => {
      utterances.push(utterance)
    }),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  } as unknown as SpeechSynthesis
}
