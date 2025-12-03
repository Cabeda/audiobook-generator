import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import {
  book,
  selectedChapters,
  generatedAudio,
  selectedChapterIds,
  selectedChaptersWithData,
} from './bookStore'
import type { Book } from '../lib/types/book'

describe('bookStore', () => {
  const mockBook: Book = {
    title: 'Test Book',
    author: 'Test Author',
    chapters: [
      { id: 'ch1', title: 'Chapter 1', content: 'Content 1' },
      { id: 'ch2', title: 'Chapter 2', content: 'Content 2' },
      { id: 'ch3', title: 'Chapter 3', content: 'Content 3' },
    ],
    format: 'epub',
    language: 'en',
  }

  beforeEach(() => {
    // Reset stores
    book.set(null)
    selectedChapters.set(new Map())
    generatedAudio.set(new Map())
  })

  describe('book store', () => {
    it('should initialize as null', () => {
      expect(get(book)).toBeNull()
    })

    it('should store and retrieve a book', () => {
      book.set(mockBook)
      const storedBook = get(book)
      expect(storedBook).toEqual(mockBook)
    })

    it('should allow setting book to null', () => {
      book.set(mockBook)
      book.set(null)
      expect(get(book)).toBeNull()
    })
  })

  describe('selectedChapters store', () => {
    it('should initialize as empty Map', () => {
      const chapters = get(selectedChapters)
      expect(chapters).toBeInstanceOf(Map)
      expect(chapters.size).toBe(0)
    })

    it('should store chapter selections', () => {
      const selections = new Map([
        ['ch1', true],
        ['ch2', false],
        ['ch3', true],
      ])
      selectedChapters.set(selections)

      const stored = get(selectedChapters)
      expect(stored.get('ch1')).toBe(true)
      expect(stored.get('ch2')).toBe(false)
      expect(stored.get('ch3')).toBe(true)
    })

    it('should handle Map updates', () => {
      const selections = new Map([['ch1', true]])
      selectedChapters.set(selections)

      // Update the map
      const updated = new Map(selections)
      updated.set('ch2', true)
      selectedChapters.set(updated)

      const stored = get(selectedChapters)
      expect(stored.size).toBe(2)
      expect(stored.get('ch2')).toBe(true)
    })
  })

  describe('generatedAudio store', () => {
    it('should initialize as empty Map', () => {
      const audio = get(generatedAudio)
      expect(audio).toBeInstanceOf(Map)
      expect(audio.size).toBe(0)
    })

    it('should store generated audio blobs', () => {
      const mockBlob = new Blob(['test'], { type: 'audio/wav' })
      const mockUrl = 'blob:mock-url'

      const audioMap = new Map([['ch1', { url: mockUrl, blob: mockBlob }]])
      generatedAudio.set(audioMap)

      const stored = get(generatedAudio)
      expect(stored.size).toBe(1)
      expect(stored.get('ch1')?.url).toBe(mockUrl)
      expect(stored.get('ch1')?.blob).toBeInstanceOf(Blob)
    })

    it('should handle multiple audio entries', () => {
      const blob1 = new Blob(['audio1'], { type: 'audio/wav' })
      const blob2 = new Blob(['audio2'], { type: 'audio/wav' })

      const audioMap = new Map([
        ['ch1', { url: 'blob:url1', blob: blob1 }],
        ['ch2', { url: 'blob:url2', blob: blob2 }],
      ])
      generatedAudio.set(audioMap)

      const stored = get(generatedAudio)
      expect(stored.size).toBe(2)
      expect(stored.has('ch1')).toBe(true)
      expect(stored.has('ch2')).toBe(true)
    })

    it('should allow clearing generated audio', () => {
      const audioMap = new Map([['ch1', { url: 'blob:url', blob: new Blob() }]])
      generatedAudio.set(audioMap)
      generatedAudio.set(new Map())

      const stored = get(generatedAudio)
      expect(stored.size).toBe(0)
    })
  })

  describe('derived stores', () => {
    beforeEach(() => {
      book.set(mockBook)
    })

    it('should compute selectedChapterIds correctly', () => {
      selectedChapters.set(
        new Map([
          ['ch1', true],
          ['ch2', false],
          ['ch3', true],
        ])
      )

      const ids = get(selectedChapterIds)
      expect(ids).toEqual(['ch1', 'ch3'])
    })

    it('should compute selectedChaptersWithData correctly', () => {
      selectedChapters.set(
        new Map([
          ['ch1', true],
          ['ch2', false],
          ['ch3', true],
        ])
      )

      const chapters = get(selectedChaptersWithData)
      expect(chapters).toHaveLength(2)
      expect(chapters[0].id).toBe('ch1')
      expect(chapters[1].id).toBe('ch3')
    })

    it('should return empty array when no book is set', () => {
      book.set(null)
      selectedChapters.set(new Map([['ch1', true]]))

      const chapters = get(selectedChaptersWithData)
      expect(chapters).toEqual([])
    })
  })

  describe('store interactions', () => {
    it('should allow setting all stores independently', () => {
      book.set(mockBook)
      selectedChapters.set(new Map([['ch1', true]]))
      generatedAudio.set(new Map([['ch1', { url: 'blob:url', blob: new Blob() }]]))

      expect(get(book)).toEqual(mockBook)
      expect(get(selectedChapters).size).toBe(1)
      expect(get(generatedAudio).size).toBe(1)
    })

    it('should reset all stores when book changes', () => {
      // Set initial state
      book.set(mockBook)
      selectedChapters.set(new Map([['ch1', true]]))
      generatedAudio.set(new Map([['ch1', { url: 'blob:url', blob: new Blob() }]]))

      // Change book (simulating navigation)
      book.set(null)
      selectedChapters.set(new Map())
      generatedAudio.set(new Map())

      expect(get(book)).toBeNull()
      expect(get(selectedChapters).size).toBe(0)
      expect(get(generatedAudio).size).toBe(0)
    })
  })
})
