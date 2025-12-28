import { describe, it, expect, beforeEach, vi } from 'vitest'
import { get } from 'svelte/store'
import {
  segmentProgress,
  initChapterSegments,
  markSegmentGenerated,
  markChapterGenerationComplete,
  clearChapterSegments,
  isSegmentGenerated,
  getGeneratedSegment,
  getChapterSegmentProgress,
  segmentProgressPercentage,
  loadChapterSegmentProgress,
} from './segmentProgressStore'
import type { AudioSegment } from '../lib/types/audio'

// Mock the libraryDB module at the top level
vi.mock('../lib/libraryDB', () => ({
  getChapterSegments: vi.fn(),
}))

describe('segmentProgressStore', () => {
  beforeEach(() => {
    // Clear the store before each test
    segmentProgress.set(new Map())
    // Reset all mocks
    vi.clearAllMocks()
  })

  describe('initChapterSegments', () => {
    it('should initialize segment tracking for a chapter', () => {
      const segments = [
        { index: 0, text: 'First sentence.', id: 'seg-0' },
        { index: 1, text: 'Second sentence.', id: 'seg-1' },
        { index: 2, text: 'Third sentence.', id: 'seg-2' },
      ]

      initChapterSegments('chapter-1', segments)

      const progress = get(segmentProgress).get('chapter-1')
      expect(progress).toBeDefined()
      expect(progress?.totalSegments).toBe(3)
      expect(progress?.generatedIndices.size).toBe(0)
      expect(progress?.isGenerating).toBe(true)
      expect(progress?.segmentTexts.get(0)).toBe('First sentence.')
    })
  })

  describe('markSegmentGenerated', () => {
    it('should mark a segment as generated', () => {
      const segments = [
        { index: 0, text: 'First sentence.', id: 'seg-0' },
        { index: 1, text: 'Second sentence.', id: 'seg-1' },
      ]
      initChapterSegments('chapter-1', segments)

      const audioSegment: AudioSegment = {
        id: 'seg-0',
        chapterId: 'chapter-1',
        index: 0,
        text: 'First sentence.',
        audioBlob: new Blob(['audio data']),
        duration: 2.5,
        startTime: 0,
      }

      markSegmentGenerated('chapter-1', audioSegment)

      const progress = get(segmentProgress).get('chapter-1')
      expect(progress?.generatedIndices.has(0)).toBe(true)
      expect(progress?.generatedSegments.get(0)).toBe(audioSegment)
    })
  })

  describe('markChapterGenerationComplete', () => {
    it('should mark generation as complete', () => {
      const segments = [{ index: 0, text: 'First sentence.', id: 'seg-0' }]
      initChapterSegments('chapter-1', segments)

      expect(get(segmentProgress).get('chapter-1')?.isGenerating).toBe(true)

      markChapterGenerationComplete('chapter-1')

      expect(get(segmentProgress).get('chapter-1')?.isGenerating).toBe(false)
    })
  })

  describe('isSegmentGenerated', () => {
    it('should return true for generated segments', () => {
      const segments = [{ index: 0, text: 'First sentence.', id: 'seg-0' }]
      initChapterSegments('chapter-1', segments)

      expect(isSegmentGenerated('chapter-1', 0)).toBe(false)

      const audioSegment: AudioSegment = {
        id: 'seg-0',
        chapterId: 'chapter-1',
        index: 0,
        text: 'First sentence.',
        audioBlob: new Blob(['audio data']),
        duration: 2.5,
        startTime: 0,
      }
      markSegmentGenerated('chapter-1', audioSegment)

      expect(isSegmentGenerated('chapter-1', 0)).toBe(true)
    })
  })

  describe('getGeneratedSegment', () => {
    it('should return the generated segment', () => {
      const segments = [{ index: 0, text: 'First sentence.', id: 'seg-0' }]
      initChapterSegments('chapter-1', segments)

      const audioSegment: AudioSegment = {
        id: 'seg-0',
        chapterId: 'chapter-1',
        index: 0,
        text: 'First sentence.',
        audioBlob: new Blob(['audio data']),
        duration: 2.5,
        startTime: 0,
      }
      markSegmentGenerated('chapter-1', audioSegment)

      const result = getGeneratedSegment('chapter-1', 0)
      expect(result).toBe(audioSegment)
    })

    it('should return undefined for non-generated segments', () => {
      const segments = [{ index: 0, text: 'First sentence.', id: 'seg-0' }]
      initChapterSegments('chapter-1', segments)

      const result = getGeneratedSegment('chapter-1', 0)
      expect(result).toBeUndefined()
    })
  })

  describe('segmentProgressPercentage', () => {
    it('should calculate percentage correctly', () => {
      const segments = [
        { index: 0, text: 'First sentence.', id: 'seg-0' },
        { index: 1, text: 'Second sentence.', id: 'seg-1' },
        { index: 2, text: 'Third sentence.', id: 'seg-2' },
        { index: 3, text: 'Fourth sentence.', id: 'seg-3' },
      ]
      initChapterSegments('chapter-1', segments)

      expect(get(segmentProgressPercentage).get('chapter-1')).toBe(0)

      // Mark 2 out of 4 segments
      const audioSegment1: AudioSegment = {
        id: 'seg-0',
        chapterId: 'chapter-1',
        index: 0,
        text: 'First sentence.',
        audioBlob: new Blob(['audio data']),
        duration: 2.5,
        startTime: 0,
      }
      const audioSegment2: AudioSegment = {
        id: 'seg-1',
        chapterId: 'chapter-1',
        index: 1,
        text: 'Second sentence.',
        audioBlob: new Blob(['audio data']),
        duration: 2.5,
        startTime: 2.5,
      }

      markSegmentGenerated('chapter-1', audioSegment1)
      markSegmentGenerated('chapter-1', audioSegment2)

      expect(get(segmentProgressPercentage).get('chapter-1')).toBe(50)
    })
  })

  describe('clearChapterSegments', () => {
    it('should remove chapter progress', () => {
      const segments = [{ index: 0, text: 'First sentence.', id: 'seg-0' }]
      initChapterSegments('chapter-1', segments)

      expect(get(segmentProgress).has('chapter-1')).toBe(true)

      clearChapterSegments('chapter-1')

      expect(get(segmentProgress).has('chapter-1')).toBe(false)
    })
  })

  describe('getChapterSegmentProgress', () => {
    it('should return progress for an initialized chapter', () => {
      const segments = [
        { index: 0, text: 'First sentence.', id: 'seg-0' },
        { index: 1, text: 'Second sentence.', id: 'seg-1' },
      ]
      initChapterSegments('chapter-1', segments)

      const progress = getChapterSegmentProgress('chapter-1')
      expect(progress).toBeDefined()
      expect(progress?.totalSegments).toBe(2)
      expect(progress?.isGenerating).toBe(true)
    })

    it('should return undefined for non-existent chapter', () => {
      const progress = getChapterSegmentProgress('non-existent')
      expect(progress).toBeUndefined()
    })

    it('should return updated progress after marking segments', () => {
      const segments = [{ index: 0, text: 'First sentence.', id: 'seg-0' }]
      initChapterSegments('chapter-1', segments)

      const audioSegment: AudioSegment = {
        id: 'seg-0',
        chapterId: 'chapter-1',
        index: 0,
        text: 'First sentence.',
        audioBlob: new Blob(['audio data']),
        duration: 2.5,
        startTime: 0,
      }
      markSegmentGenerated('chapter-1', audioSegment)

      const progress = getChapterSegmentProgress('chapter-1')
      expect(progress?.generatedIndices.has(0)).toBe(true)
    })
  })

  describe('loadChapterSegmentProgress', () => {
    it('should load segment progress from DB and update store', async () => {
      // Import the mocked module
      const { getChapterSegments } = await import('../lib/libraryDB')

      // Setup mock data
      const mockSegments: AudioSegment[] = [
        {
          id: 'seg-0',
          chapterId: 'chapter-1',
          index: 0,
          text: 'First sentence.',
          audioBlob: new Blob(['audio data']),
          duration: 2.5,
          startTime: 0,
        },
        {
          id: 'seg-1',
          chapterId: 'chapter-1',
          index: 1,
          text: 'Second sentence.',
          audioBlob: new Blob(['audio data']),
          duration: 3.0,
          startTime: 2.5,
        },
      ]

      // Configure mock for this test
      vi.mocked(getChapterSegments).mockResolvedValue(mockSegments)

      await loadChapterSegmentProgress(1, 'chapter-1')

      const progress = get(segmentProgress).get('chapter-1')
      expect(progress).toBeDefined()
      expect(progress?.totalSegments).toBe(2)
      expect(progress?.generatedIndices.size).toBe(2)
      expect(progress?.generatedIndices.has(0)).toBe(true)
      expect(progress?.generatedIndices.has(1)).toBe(true)
      expect(progress?.isGenerating).toBe(false) // Loaded from DB means generation is complete
    })

    it('should not update store for empty results', async () => {
      // Import the mocked module
      const { getChapterSegments } = await import('../lib/libraryDB')

      // Configure mock for this test
      vi.mocked(getChapterSegments).mockResolvedValue([])

      await loadChapterSegmentProgress(1, 'chapter-empty')

      const progress = get(segmentProgress).get('chapter-empty')
      expect(progress).toBeUndefined()
    })
  })
})
