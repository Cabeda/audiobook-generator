import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveGenerationState,
  getGenerationState,
  getInterruptedGeneration,
  clearGenerationState,
  markChapterCompleted,
  type GenerationState,
} from './generationStateStore'

describe('generationStateStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  const mockState: GenerationState = {
    bookId: 1,
    bookTitle: 'The Sign of the Four',
    chapterIds: ['ch1', 'ch2', 'ch3'],
    completedChapterIds: [],
    currentChapterIndex: 0,
    startedAt: Date.now(),
    model: 'kokoro',
    voice: 'af_heart',
    quantization: 'q8',
    device: 'wasm',
  }

  describe('saveGenerationState', () => {
    it('should persist state to localStorage', () => {
      saveGenerationState(mockState)
      const stored = localStorage.getItem('audiobook_generation_state')
      expect(stored).not.toBeNull()
      expect(JSON.parse(stored!)).toEqual(mockState)
    })
  })

  describe('getGenerationState', () => {
    it('should return null when no state exists', () => {
      expect(getGenerationState()).toBeNull()
    })

    it('should return the persisted state', () => {
      saveGenerationState(mockState)
      const result = getGenerationState()
      expect(result).toEqual(mockState)
    })
  })

  describe('markChapterCompleted', () => {
    it('should add chapter to completedChapterIds', () => {
      saveGenerationState(mockState)
      markChapterCompleted('ch1')
      const state = getGenerationState()
      expect(state?.completedChapterIds).toContain('ch1')
      expect(state?.currentChapterIndex).toBe(1)
    })

    it('should not duplicate chapter IDs', () => {
      saveGenerationState(mockState)
      markChapterCompleted('ch1')
      markChapterCompleted('ch1')
      const state = getGenerationState()
      expect(state?.completedChapterIds.filter((id) => id === 'ch1')).toHaveLength(1)
    })

    it('should do nothing when no state exists', () => {
      markChapterCompleted('ch1')
      expect(getGenerationState()).toBeNull()
    })
  })

  describe('getInterruptedGeneration', () => {
    it('should return null when no state exists', () => {
      expect(getInterruptedGeneration()).toBeNull()
    })

    it('should return state when generation was interrupted', () => {
      saveGenerationState(mockState)
      const result = getInterruptedGeneration()
      expect(result).toEqual(mockState)
    })

    it('should return null and clear state when all chapters are completed', () => {
      const completedState: GenerationState = {
        ...mockState,
        completedChapterIds: ['ch1', 'ch2', 'ch3'],
      }
      saveGenerationState(completedState)
      const result = getInterruptedGeneration()
      expect(result).toBeNull()
      expect(getGenerationState()).toBeNull()
    })

    it('should return null and clear state when state is older than 24 hours', () => {
      const staleState: GenerationState = {
        ...mockState,
        startedAt: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
      }
      saveGenerationState(staleState)
      const result = getInterruptedGeneration()
      expect(result).toBeNull()
      expect(getGenerationState()).toBeNull()
    })

    it('should return state when partially completed and recent', () => {
      const partialState: GenerationState = {
        ...mockState,
        completedChapterIds: ['ch1'],
        currentChapterIndex: 1,
      }
      saveGenerationState(partialState)
      const result = getInterruptedGeneration()
      expect(result).not.toBeNull()
      expect(result?.completedChapterIds).toEqual(['ch1'])
    })
  })

  describe('clearGenerationState', () => {
    it('should remove state from localStorage', () => {
      saveGenerationState(mockState)
      clearGenerationState()
      expect(getGenerationState()).toBeNull()
    })

    it('should not throw when no state exists', () => {
      expect(() => clearGenerationState()).not.toThrow()
    })
  })
})
