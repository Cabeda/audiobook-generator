/**
 * Opening a chapter in a reader.
 *
 * Both readers do the same few things to read a chapter: split it into
 * segments, load the progress saved for it, work out how it is read, put it in
 * the player, and — when the rest of the book is still being generated — say
 * that this chapter is what the person is listening to.
 *
 * They keep their own layout, scrolling and highlighting. This module is the
 * sequence they share, so a change to it reaches both readers.
 */

import { segmentHtmlContent } from '../services/segmentationService'
import { loadChapterSegmentProgress, getGeneratedSegment } from '../../stores/segmentProgressStore'
import { planChapter, type ChapterPlan } from '../services/chapterPlan'
import { resolveChapterLanguageWithDetection } from '../utils/languageResolver'
import { audioService } from '../audioPlaybackService.svelte'
import { generationService } from '../services/generationService'
import type { Book, Chapter } from '../types/book'
import type { PiperVoice } from '../piper/piperClient'
import type { Device, Quantization } from '../../stores/ttsStore'
import type { TTSModelType } from '../tts/ttsModels'
import logger from '../utils/logger'

export interface ReaderSettings {
  bookId: number | null
  bookTitle: string
  selectedModel: string
  selectedVoice: string
  quantization: Quantization
  device?: Device
  languageDefaults: Record<string, { model?: string; voice?: string } | undefined>
  piperVoices?: PiperVoice[]
  isMobile?: boolean
  playbackSpeed?: number
}

/** Split a chapter into segments and load the progress saved for it. */
export function prepareChapter(chapter: Chapter, bookId: number | null): string {
  const { html } = segmentHtmlContent(chapter.id, chapter.content)

  if (bookId) {
    loadChapterSegmentProgress(bookId, chapter.id).catch((err) => {
      logger.warn('Failed to load segment progress from DB:', err)
    })
  }

  return html
}

/** How this chapter is read: its engine, its voice and its settings. */
export function planForChapter(
  chapter: Chapter,
  book: Book,
  settings: ReaderSettings
): ChapterPlan {
  return planChapter({
    chapter,
    language: resolveChapterLanguageWithDetection(chapter, book),
    languageDefaults: settings.languageDefaults,
    selectedModel: settings.selectedModel,
    selectedVoice: settings.selectedVoice,
    selectedQuantization: settings.quantization,
    selectedDevice: settings.device,
    piperVoices: settings.piperVoices,
    isMobile: settings.isMobile,
  })
}

/**
 * Tell the generator that this chapter is what the person is listening to.
 *
 * Returns true when a generation is running: the reader then plays the
 * segments that generation hands over instead of making its own, which would
 * compete with the book for the same worker.
 */
export function claimChapter(chapter: Chapter): boolean {
  const running = generationService.isRunning()
  audioService.setSegmentsAreExternal(running)
  if (running) generationService.prioritizeChapter(chapter)
  return running
}

/** Put a chapter in the player, claiming it from a running generation. */
export async function openChapter(
  chapter: Chapter,
  plan: ChapterPlan,
  settings: ReaderSettings
): Promise<{ success: boolean; hasAudio: boolean }> {
  claimChapter(chapter)

  return audioService.loadChapter(settings.bookId ?? 0, settings.bookTitle, chapter, {
    voice: plan.voice,
    quantization: plan.quantization,
    device: plan.device,
    selectedModel: plan.model as TTSModelType,
    playbackSpeed: settings.playbackSpeed,
  })
}

/** Play a segment, using the audio already made for it when there is any. */
export async function playSegmentOf(
  chapterId: string,
  index: number,
  autoPlay = true
): Promise<void> {
  const generated = getGeneratedSegment(chapterId, index)
  if (generated) audioService.injectProgressiveSegment(generated)
  await audioService.playFromSegment(index, autoPlay)
}
