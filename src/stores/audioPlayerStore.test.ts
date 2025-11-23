import { describe, it, expect } from 'vitest'
import { get } from 'svelte/store'
import { audioPlayerStore } from './audioPlayerStore'

describe('audioPlayerStore', () => {
  it('startPlayback sets state and stop clears it', () => {
    const chapter = { id: 'ch1', title: 'Chapter 1', content: 'Hello' }
    audioPlayerStore.startPlayback(1, 'Book', chapter, {
      voice: 'en_US',
      quantization: 'q8',
      device: 'auto',
      selectedModel: 'kokoro',
      playbackSpeed: 1.0,
    })

    const state = get(audioPlayerStore)
    expect(state.chapterId).toBe('ch1')
    expect(state.bookId).toBe(1)
    expect(state.isPlaying).toBe(true)
    expect(state.isMinimized).toBe(false)

    // Minimize and verify
    audioPlayerStore.minimize()
    expect(get(audioPlayerStore).isMinimized).toBe(true)

    // Stop should reset to default
    audioPlayerStore.stop()
    const stopped = get(audioPlayerStore)
    expect(stopped.chapterId).toBeNull()
    expect(stopped.bookId).toBeNull()
    expect(stopped.isPlaying).toBe(false)
    expect(stopped.isMinimized).toBe(false)
  })
})
