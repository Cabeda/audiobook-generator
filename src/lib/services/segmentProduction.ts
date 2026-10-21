/**
 * Segment production.
 *
 * Three passes make audio for a segment: the chapter generator, the reader's
 * fast pass and playback on demand. Each one used to call the worker, build
 * the record and write it its own way, so a segment could exist in one pass
 * and not in another. They now share this module:
 *
 *   synthesizeSegment — ask the engine for the audio and build the record;
 *   saveSegment       — write it once and hand it to the reader if it is playing;
 *   produceSegment    — both, for callers that have nothing else to add.
 */

import { getTTSWorker } from '../ttsWorkerManager'
import { createSegment } from '../segments'
import { parseWavDuration } from '../wavUtils'
import { saveSegmentIndividually } from '../libraryDB'
import type { AudioSegment } from '../types/audio'
import type { TTSModelType } from '../tts/ttsModels'
import type { Device, Quantization } from '../../stores/ttsStore'
import { markSegmentGenerated } from '../../stores/segmentProgressStore'

export interface SegmentJob {
  chapterId: string
  index: number
  text: string
  model: TTSModelType
  voice: string
  language?: string
  quantization?: Quantization
  device?: Device
  qualityTier?: number
  onProgress?: (message: string) => void
  /** Where the finished segment goes. Defaults to its own row in the database. */
  persist?: (segment: AudioSegment) => Promise<void>
}

/** Ask the engine for one segment's audio and build its record. */
export async function synthesizeSegment(job: SegmentJob): Promise<AudioSegment> {
  const blob = await getTTSWorker().generateVoice({
    text: job.text,
    modelType: job.model,
    voice: job.voice,
    config: { dtype: job.quantization, device: job.device },
    language: job.language,
    onProgress: job.onProgress,
  })

  return createSegment({
    chapterId: job.chapterId,
    index: job.index,
    text: job.text,
    audioBlob: blob,
    duration: await parseWavDuration(blob),
    qualityTier: job.qualityTier,
    voice: job.voice,
    model: job.model,
  })
}

/**
 * Save a segment, then hand it to the reader if it is playing that chapter.
 * The hand-off comes before the caller releases the blob.
 */
export async function saveSegment(
  segment: AudioSegment,
  bookId: number | undefined,
  persist?: (segment: AudioSegment) => Promise<void>
): Promise<void> {
  if (persist) {
    await persist(segment)
  } else if (bookId) {
    await saveSegmentIndividually(bookId, segment.chapterId, segment)
  }

  markSegmentGenerated(segment.chapterId, segment)

  // Imported here so this module stays usable without the player's runes.
  const { audioService } = await import('../audioPlaybackService.svelte')
  if (audioService.playingChapterId() === segment.chapterId) {
    audioService.injectProgressiveSegment(segment)
  }
}

/** Synthesize a segment and save it. */
export async function produceSegment(
  job: SegmentJob,
  bookId: number | undefined
): Promise<AudioSegment> {
  const segment = await synthesizeSegment(job)
  await saveSegment(segment, bookId, job.persist)
  return segment
}
