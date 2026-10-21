import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../services/segmentationService', () => ({
  segmentHtmlContent: vi.fn((chapterId: string, content: string) => ({
    html: `<p data-chapter="${chapterId}">${content}</p>`,
    segments: [],
  })),
}))

const progress = vi.hoisted(() => ({
  loadChapterSegmentProgress: vi.fn(async () => {}),
  getGeneratedSegment: vi.fn(() => undefined as { index: number } | undefined),
}))
vi.mock('../../stores/segmentProgressStore', () => progress)

const player = vi.hoisted(() => ({
  setSegmentsAreExternal: vi.fn(),
  loadChapter: vi.fn(async () => ({ success: true, hasAudio: false })),
  injectProgressiveSegment: vi.fn(),
  playFromSegment: vi.fn(async () => {}),
}))
vi.mock('../audioPlaybackService.svelte', () => ({ audioService: player }))

const generation = vi.hoisted(() => ({
  isRunning: vi.fn(() => false),
  prioritizeChapter: vi.fn(),
}))
vi.mock('../services/generationService', () => ({ generationService: generation }))

const { claimChapter, openChapter, planForChapter, playSegmentOf, prepareChapter } =
  await import('./chapterReader')

const book = {
  id: 1,
  title: 'A book',
  author: 'Someone',
  language: 'en',
  chapters: [],
} as never

const chapter = {
  id: 'chapter-2',
  title: 'Two',
  content: '<p>Hello there.</p>',
  index: 1,
} as never

const settings = {
  bookId: 1,
  bookTitle: 'A book',
  selectedModel: 'kokoro',
  selectedVoice: 'af_heart',
  quantization: 'q8' as const,
  device: 'auto' as const,
  languageDefaults: {},
}

beforeEach(() => {
  vi.clearAllMocks()
  generation.isRunning.mockReturnValue(false)
  progress.getGeneratedSegment.mockReturnValue(undefined)
})

describe('chapter reader', () => {
  it('splits the chapter and loads the progress saved for it', () => {
    const html = prepareChapter(chapter, 1)

    expect(html).toContain('data-chapter="chapter-2"')
    expect(progress.loadChapterSegmentProgress).toHaveBeenCalledWith(1, 'chapter-2')
  })

  it('plans the chapter with the language it is read in', () => {
    const plan = planForChapter(chapter, book, settings)

    expect(plan.language).toBe('en')
    expect(plan.model).toBe('kokoro')
    expect(plan.voice).toBe('af_heart')
    expect(plan.quantization).toBe('q8')
  })

  it('claims the chapter from a running generation', () => {
    generation.isRunning.mockReturnValue(true)

    expect(claimChapter(chapter)).toBe(true)

    expect(player.setSegmentsAreExternal).toHaveBeenCalledWith(true)
    expect(generation.prioritizeChapter).toHaveBeenCalledWith(chapter)
  })

  it('leaves a generation that is not running alone', () => {
    expect(claimChapter(chapter)).toBe(false)

    expect(player.setSegmentsAreExternal).toHaveBeenCalledWith(false)
    expect(generation.prioritizeChapter).not.toHaveBeenCalled()
  })

  it('puts the chapter in the player with the plan it was given', async () => {
    const plan = planForChapter(chapter, book, settings)
    await openChapter(chapter, plan, settings)

    expect(player.loadChapter).toHaveBeenCalledWith(
      1,
      'A book',
      chapter,
      expect.objectContaining({ voice: 'af_heart', selectedModel: 'kokoro', quantization: 'q8' })
    )
  })

  it('plays a segment with the audio already made for it', async () => {
    const generated = { index: 3 }
    progress.getGeneratedSegment.mockReturnValue(generated as never)

    await playSegmentOf('chapter-2', 3)

    expect(player.injectProgressiveSegment).toHaveBeenCalledWith(generated)
    expect(player.playFromSegment).toHaveBeenCalledWith(3, true)
  })
})
