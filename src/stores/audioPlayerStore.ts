import { writable, derived } from 'svelte/store'
import logger from '../lib/utils/logger'
import type { Chapter } from '../lib/types/book'

export interface AudioPlayerState {
  // Current playback
  bookId: number | null
  bookTitle: string | null
  chapterId: string | null
  chapterTitle: string | null
  segmentIndex: number
  currentTime: number
  duration: number
  chapterDuration: number

  // Playback state
  isPlaying: boolean
  isMinimized: boolean
  isBuffering: boolean

  // Audio segments cache (segment index -> blob URL)
  audioSegments: Map<number, string>

  // TTS settings (preserved from when playback started)
  voice: string
  quantization: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
  device: 'auto' | 'wasm' | 'webgpu' | 'cpu'
  selectedModel: 'kokoro' | 'piper'
  playbackSpeed: number
}

const STORAGE_KEY = 'audiobook_player_state'

// Default state
const defaultState: AudioPlayerState = {
  bookId: null,
  bookTitle: null,
  chapterId: null,
  chapterTitle: null,
  segmentIndex: 0,
  currentTime: 0,
  duration: 0,
  chapterDuration: 0,
  isPlaying: false,
  isMinimized: false,
  isBuffering: false,
  audioSegments: new Map(),
  voice: '',
  quantization: 'q8',
  device: 'auto',
  selectedModel: 'kokoro',
  playbackSpeed: 1.0,
}

// Load initial state from localStorage
function loadState(): AudioPlayerState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      // Don't restore isPlaying state - always start paused
      return {
        ...defaultState,
        ...parsed,
        isPlaying: false,
        audioSegments: new Map(), // Don't persist blob URLs
      }
    }
  } catch (e) {
    logger.warn('Failed to load audio player state:', e)
  }
  return defaultState
}

// Create the store
function createAudioPlayerStore() {
  const { subscribe, set, update } = writable<AudioPlayerState>(loadState())

  // Debounced save to localStorage
  let saveTimeout: ReturnType<typeof setTimeout> | null = null
  function scheduleSave(state: AudioPlayerState) {
    if (saveTimeout) clearTimeout(saveTimeout)
    saveTimeout = setTimeout(() => {
      try {
        // Don't save blob URLs or isPlaying state
        const toSave = {
          ...state,
          audioSegments: undefined,
          isPlaying: false,
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
      } catch (e) {
        logger.warn('Failed to save audio player state:', e)
      }
    }, 500)
  }

  return {
    subscribe,

    // Start playback with a chapter
    startPlayback: (
      bookId: number | null,
      bookTitle: string,
      chapter: Chapter,
      settings: {
        voice: string
        quantization: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
        device?: 'auto' | 'wasm' | 'webgpu' | 'cpu'
        selectedModel?: 'kokoro' | 'piper'
        playbackSpeed?: number
      },
      startPlaying: boolean = true,
      minimized: boolean = false
    ) => {
      update((state) => {
        const newState = {
          ...state,
          bookId,
          bookTitle,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          segmentIndex: 0,
          currentTime: 0,
          isPlaying: startPlaying,
          isMinimized: minimized,
          voice: settings.voice,
          quantization: settings.quantization,
          device: settings.device || 'auto',
          selectedModel: settings.selectedModel || 'kokoro',
          playbackSpeed: settings.playbackSpeed || 1.0,
        }
        scheduleSave(newState)
        return newState
      })
    },

    // Resume playback from saved state
    resumePlayback: (chapter: Chapter) => {
      update((state) => ({
        ...state,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        isPlaying: true,
      }))
    },

    // Update playback position
    updatePosition: (segmentIndex: number, currentTime: number, duration: number) => {
      update((state) => {
        const newState = {
          ...state,
          segmentIndex,
          currentTime,
          duration,
        }
        scheduleSave(newState)
        return newState
      })
    },

    // Update the total chapter duration (seconds)
    setChapterDuration: (chapterDuration: number) => {
      update((state) => {
        const newState = { ...state, chapterDuration }
        scheduleSave(newState)
        return newState
      })
    },

    // Play/pause
    play: () => {
      update((state) => ({ ...state, isPlaying: true }))
    },

    pause: () => {
      update((state) => ({ ...state, isPlaying: false }))
    },

    togglePlayPause: () => {
      update((state) => ({ ...state, isPlaying: !state.isPlaying }))
    },

    // Minimize/maximize
    minimize: () => {
      update((state) => ({ ...state, isMinimized: true }))
    },

    maximize: () => {
      update((state) => ({ ...state, isMinimized: false }))
    },

    // Update audio segments cache
    setAudioSegment: (index: number, blobUrl: string) => {
      update((state) => {
        const newSegments = new Map(state.audioSegments)
        newSegments.set(index, blobUrl)
        return { ...state, audioSegments: newSegments }
      })
    },

    clearAudioSegments: () => {
      update((state) => {
        // Revoke all blob URLs
        state.audioSegments.forEach((url) => URL.revokeObjectURL(url))
        return { ...state, audioSegments: new Map() }
      })
    },

    // Update playback speed
    setPlaybackSpeed: (speed: number) => {
      update((state) => {
        const newState = { ...state, playbackSpeed: speed }
        scheduleSave(newState)
        return newState
      })
    },

    // Buffering state (current segment generation pending)
    setBuffering: (flag: boolean) => {
      update((state) => {
        const newState = { ...state, isBuffering: flag }
        scheduleSave(newState)
        return newState
      })
    },

    // Stop and clear
    stop: () => {
      update((state) => {
        // Revoke all blob URLs
        state.audioSegments.forEach((url) => URL.revokeObjectURL(url))

        const newState = { ...defaultState }
        try {
          localStorage.removeItem(STORAGE_KEY)
        } catch (e) {
          logger.warn('Failed to clear audio player state:', e)
        }
        return newState
      })
    },

    // Reset to default state
    reset: () => {
      set(defaultState)
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch (e) {
        logger.warn('Failed to clear audio player state:', e)
      }
    },
  }
}

export const audioPlayerStore = createAudioPlayerStore()

// Derived stores for convenience
export const isPlayerActive = derived(audioPlayerStore, ($player) => $player.chapterId !== null)

export const isPlayerMinimized = derived(audioPlayerStore, ($player) => $player.isMinimized)

export const currentPlaybackInfo = derived(audioPlayerStore, ($player) => ({
  bookTitle: $player.bookTitle,
  chapterTitle: $player.chapterTitle,
  progress:
    $player.chapterDuration > 0
      ? $player.currentTime / $player.chapterDuration
      : $player.duration > 0
        ? $player.currentTime / $player.duration
        : 0,
  isPlaying: $player.isPlaying,
}))
