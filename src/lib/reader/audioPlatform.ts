/**
 * Audio platform.
 *
 * The adapter the listen session plays through: audioPlaybackService for
 * playback, the generation facade for what a chapter is missing, and forced
 * per-segment synthesis for voice changes. The session never sees these
 * modules — this file is the whole seam between them.
 */

import { get } from 'svelte/store'
import type { Book, Chapter } from '../types/book'
import { audioService } from '../audioPlaybackService.svelte'
import { generateMissing } from '../services/audiobookService'
import { produceSegment } from '../services/segmentProduction'
import { segmentHtmlContent } from '../services/segmentationService'
import { segmentProgress } from '../../stores/segmentProgressStore'
import { chapterStatus } from '../../stores/bookStore'
import { audioPlayerStore } from '../../stores/audioPlayerStore'
import type { ListenPlatform } from './listenSession'

export interface AudioPlatformContext {
  book: () => Book | null
  bookId: () => number | null
  /** Loading settings for a chapter: voice, model, precision, device, speed. */
  settings: (chapter: Chapter) => {
    voice: string
    model: string
    quantization: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
    device: 'auto' | 'wasm' | 'webgpu' | 'cpu'
    speed: number
  }
}

export function createAudioPlatform(context: AudioPlatformContext): ListenPlatform {
  return {
    loadedChapter: () => audioService.playingChapterId(),
    isPlaying: () => get(audioPlayerStore).isPlaying,
    hasAudio: (chapter) => {
      const progress = get(segmentProgress).get(chapter.id)
      return (
        (progress?.generatedIndices.size ?? 0) > 0 || get(chapterStatus).get(chapter.id) === 'done'
      )
    },
    segmentText: (chapter, index) => {
      const text = get(segmentProgress).get(chapter.id)?.segmentTexts.get(index)
      if (text) return text
      // The chapter may never have been tracked in this session (fresh open,
      // or a single sentence being re-made): ask the segmentation itself.
      return (
        segmentHtmlContent(chapter.id, chapter.content).segments.find((s) => s.index === index)
          ?.text ?? null
      )
    },
    ensureAudio: async (chapter) => {
      const book = context.book()
      if (!book) return
      await generateMissing({ ...book, chapters: [chapter] }, context.bookId() ?? undefined)
    },
    load: async (chapter, atSegment) => {
      const book = context.book()
      const settings = context.settings(chapter)
      await audioService.loadChapter(context.bookId() ?? 0, book?.title ?? '', chapter, {
        voice: settings.voice,
        quantization: settings.quantization,
        device: settings.device,
        selectedModel: settings.model as never,
        playbackSpeed: settings.speed,
      })
      if (atSegment != null && atSegment > 0) {
        // Position without starting; the session decides when to play.
        await audioService.playFromSegment(atSegment, false)
      }
    },
    play: async () => {
      // The service keeps its own isPlaying flag and early-returns when it is
      // set; after an aborted play it can be stale while the store says paused.
      // Reconcile before playing, or the reader sits on ▶ doing nothing.
      if (!get(audioPlayerStore).isPlaying && audioService.isPlaying) {
        audioService.pause()
      }
      await audioService.play()
    },
    pause: () => {
      audioService.pause()
    },
    seekToSegment: async (index) => {
      await audioService.playFromSegment(index, false)
    },
    synthesize: async (text, options, where) => {
      // Saved, not just swapped in: a re-made sentence must survive a reload.
      const segment = await produceSegment(
        {
          text,
          chapterId: where.chapterId,
          index: where.index,
          language: options.language,
          model: options.model as never,
          voice: options.voice,
          quantization: options.quantization as never,
          device: options.device as never,
        } as Parameters<typeof produceSegment>[0],
        context.bookId() ?? undefined
      )
      return segment.audioBlob
    },
    replaceSegmentAudio: (index, blob) => {
      audioService.replaceSegmentAudio(index, blob)
    },
    skip: (seconds) => {
      audioService.skip(seconds)
    },
    stop: () => {
      audioService.stop()
    },
  }
}
