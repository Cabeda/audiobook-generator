import { describe, it, expect, vi, beforeEach } from 'vitest'

const worker = vi.hoisted(() => ({
  generateVoice: vi.fn(
    async () =>
      new Blob([new Uint8Array(44)], {
        type: 'audio/wav',
      })
  ),
}))

vi.mock('../ttsWorkerManager', () => ({ getTTSWorker: () => worker }))

const saved = vi.hoisted(() => [] as Array<{ bookId: number; chapterId: string }>)
vi.mock('../libraryDB', () => ({
  saveSegmentIndividually: vi.fn(async (bookId: number, chapterId: string) => {
    saved.push({ bookId, chapterId })
  }),
}))

const marked = vi.hoisted(() => [] as number[])
vi.mock('../../stores/segmentProgressStore', () => ({
  markSegmentGenerated: vi.fn((_chapterId: string, segment: { index: number }) => {
    marked.push(segment.index)
  }),
}))

const player = vi.hoisted(() => ({
  playingChapterId: vi.fn(() => 'chapter-1'),
  injectProgressiveSegment: vi.fn(),
}))
vi.mock('../audioPlaybackService.svelte', () => ({ audioService: player }))

const { synthesizeSegment, saveSegment, produceSegment } = await import('./segmentProduction')

const job = {
  chapterId: 'chapter-1',
  index: 2,
  text: 'A sentence.',
  model: 'piper' as const,
  voice: 'en_US-medium',
}

beforeEach(() => {
  vi.clearAllMocks()
  saved.length = 0
  marked.length = 0
})

describe('segment production', () => {
  it('asks the engine once and builds the segment record', async () => {
    const segment = await synthesizeSegment(job)

    expect(worker.generateVoice).toHaveBeenCalledTimes(1)
    expect(worker.generateVoice).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'A sentence.', modelType: 'piper', voice: 'en_US-medium' })
    )
    expect(segment.chapterId).toBe('chapter-1')
    expect(segment.index).toBe(2)
    expect(segment.voice).toBe('en_US-medium')
  })

  it('saves a segment once and hands it to the chapter being played', async () => {
    const segment = await synthesizeSegment(job)
    await saveSegment(segment, 7)

    expect(saved).toEqual([{ bookId: 7, chapterId: 'chapter-1' }])
    expect(marked).toEqual([2])
    expect(player.injectProgressiveSegment).toHaveBeenCalledWith(segment)
  })

  it('does not hand a segment to a player that is on another chapter', async () => {
    player.playingChapterId.mockReturnValueOnce('chapter-9')

    await saveSegment(await synthesizeSegment(job), 7)

    expect(player.injectProgressiveSegment).not.toHaveBeenCalled()
  })

  it('produces and saves in one call', async () => {
    const segment = await produceSegment(job, 7)

    expect(segment.text).toBe('A sentence.')
    expect(saved).toEqual([{ bookId: 7, chapterId: 'chapter-1' }])
  })
})
