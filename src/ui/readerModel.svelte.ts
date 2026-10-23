/**
 * Reader model.
 *
 * The bridge between the revamp UI and the real services: the state the reader
 * renders (per-chapter audio, per-segment generation, spoken segment, playback
 * position) and the actions it drives (play, generate, retry, export). The
 * mapping logic lives in the tested seams (readerViewState, readerSegments,
 * bookSession, audiobookService); this module only binds them to stores.
 */

import { get } from 'svelte/store'
import type { Book, Chapter } from '../lib/types/book'
import {
  book as bookStore,
  chapterErrors,
  chapterStatus,
  type ChapterStatus,
} from '../stores/bookStore'
import { currentLibraryBookId } from '../stores/libraryStore'
import { segmentProgress } from '../stores/segmentProgressStore'
import { audioPlayerStore } from '../stores/audioPlayerStore'
import {
  selectedDevice,
  selectedModel,
  selectedQuantization,
  selectedVoice,
} from '../stores/ttsStore'
import { piperVoices } from '../stores/piperVoicesStore'
import { audioService } from '../lib/audioPlaybackService.svelte'
import { segmentStateFor } from '../lib/reader/readerSegments'
import {
  bookGenerationView,
  chapterAudioView,
  chapterEstimateSeconds,
  type ChapterAudioView,
} from '../lib/reader/readerViewState'
import {
  exportBook as exportBookAction,
  generateMissing,
  retryChapters,
} from '../lib/services/audiobookService'
import { listenPlanFor } from '../lib/services/listenPlan'
import { appSettings } from '../stores/appSettingsStore'
import { toastStore } from '../stores/toastStore'
import logger from '../lib/utils/logger'
import type { ExportFormat } from '../lib/exportFormats'
import type { SelectedModel } from '../lib/tts/ttsModels'

export interface ReaderPrefs {
  model: string
  voice: string
  rate: number
  quantization: string
  device: string
  exportFormat: ExportFormat
  autoContinue: boolean
}

export interface ExportState {
  busy: boolean
  done: boolean
  error?: string
}

// Module-level so the prefs object below needs no `this` alias: every field is
// either a real store or one of these.
let exportFormatState = $state<ExportFormat>('m4b')
let autoContinueState = $state(true)

class ReaderModel {
  exportState = $state<ExportState>({ busy: false, done: false })

  /** The book being read, straight from the real store. */
  get book(): Book | null {
    return get(bookStore)
  }

  /** The library id of the current book, or null for an unsaved one. */
  get bookId(): number | null {
    return get(currentLibraryBookId)
  }

  /** The chapter audio is loaded for, or null when nothing is loaded. */
  get chapterId(): string | null {
    return audioService.playingChapterId()
  }

  get playing(): boolean {
    return get(audioPlayerStore).isPlaying
  }

  get position(): number {
    return get(audioPlayerStore).currentTime
  }

  get duration(): number {
    return get(audioPlayerStore).duration
  }

  /** The segment being spoken right now, or -1. */
  get segmentIndex(): number {
    return audioService.currentSegmentIndex
  }

  /** Settings the reader shows; each field lives in its real store. */
  get prefs(): ReaderPrefs {
    return {
      get model() {
        return get(selectedModel)
      },
      set model(value: string) {
        selectedModel.set(value as SelectedModel)
      },
      get voice() {
        return get(selectedVoice)
      },
      set voice(value: string) {
        selectedVoice.set(value)
      },
      get quantization() {
        return get(selectedQuantization)
      },
      set quantization(value: string) {
        selectedQuantization.set(value as never)
      },
      get device() {
        return get(selectedDevice)
      },
      set device(value: string) {
        selectedDevice.set(value as never)
      },
      get rate() {
        return audioService.playbackSpeed
      },
      set rate(value: number) {
        audioService.setSpeed(value)
      },
      get exportFormat() {
        return exportFormatState
      },
      set exportFormat(value: ExportFormat) {
        exportFormatState = value
      },
      get autoContinue() {
        return autoContinueState
      },
      set autoContinue(value: boolean) {
        autoContinueState = value
      },
    }
  }

  /** What one chapter's audio looks like to the reader. */
  statusOf(chapterId: string): ChapterAudioView {
    return chapterAudioView(
      get(segmentProgress).get(chapterId),
      get(chapterStatus).get(chapterId) as ChapterStatus | undefined,
      get(chapterErrors).get(chapterId)
    )
  }

  /** How one segment of a chapter looks: pending, being generated, generated. */
  segmentStateOf(chapterId: string, index: number): 'pending' | 'generating' | 'generated' {
    const progress = get(segmentProgress).get(chapterId)
    return segmentStateFor(index, {
      generatedIndices: progress?.generatedIndices ?? new Set(),
      isGenerating: progress?.isGenerating ?? false,
      processingIndex: progress?.processingIndex ?? -1,
    })
  }

  processedSegments(chapterId: string): number {
    return get(segmentProgress).get(chapterId)?.generatedIndices.size ?? 0
  }

  readyCount(ids: string[]): number {
    return ids.filter((id) => this.statusOf(id).state === 'ready').length
  }

  generatingCount(ids: string[]): number {
    return ids.filter((id) => this.statusOf(id).state === 'generating').length
  }

  failedCount(ids: string[]): number {
    return ids.filter((id) => this.statusOf(id).state === 'failed').length
  }

  /** How far the book's audio has come, by segments. */
  get bookGeneration() {
    const map = get(segmentProgress)
    return bookGenerationView(this.book?.chapters.map((c) => map.get(c.id)) ?? [])
  }

  // ---- playback ----

  /** Load a chapter for listening, following the plan for its voice and model. */
  async openChapter(chapter: Chapter, atSegment?: number): Promise<void> {
    const book = this.book
    if (!book) return

    const plan = listenPlanFor(
      book,
      chapter,
      {
        model: this.prefs.model,
        voice: this.prefs.voice,
        quantization: get(selectedQuantization),
        device: get(selectedDevice),
        languageDefaults: get(appSettings).languageDefaults,
      },
      get(piperVoices)
    )

    const result = await audioService.loadChapter(this.bookId ?? 0, book.title, chapter, {
      voice: plan.voice,
      quantization: plan.quantization,
      device: plan.device,
      selectedModel: plan.model,
      playbackSpeed: audioService.playbackSpeed,
    })
    if (!result.success) {
      logger.warn('loadChapter did not succeed', result)
      return
    }
    if (atSegment != null && atSegment > 0) {
      await audioService.playFromSegment(atSegment)
    } else {
      await audioService.play()
    }
  }

  /** Play a chapter: resume the loaded one, or load it and start from the top. */
  async play(chapter: Chapter): Promise<void> {
    try {
      if (this.chapterId === chapter.id) {
        if (!this.playing) await audioService.play()
        return
      }
      if (this.statusOf(chapter.id).state === 'none') {
        await this.generate([chapter.id])
      }
      await this.openChapter(chapter)
    } catch (error) {
      logger.error('Could not start playback', error)
      toastStore.error('Could not start playback')
    }
  }

  /** Speak from a given sentence (click-to-continue). */
  async playFromSegment(chapter: Chapter, index: number): Promise<void> {
    if (this.chapterId === chapter.id) {
      await audioService.playFromSegment(index)
      return
    }
    await this.openChapter(chapter, index)
  }

  toggle(): void {
    audioService.togglePlayPause()
  }

  stop(): void {
    audioService.stop()
  }

  skip(seconds: number): void {
    audioService.skip(seconds)
  }

  /**
   * Jump to a position in the book as a whole: the target chapter comes from
   * the chapter estimates, and the sentence from its share of the chapter.
   */
  async seekBook(fraction: number): Promise<void> {
    const book = this.book
    if (!book) return
    const estimates = book.chapters.map((c) => chapterEstimateSeconds(c.content))
    const duration = estimates.reduce((total, seconds) => total + seconds, 0)
    if (duration <= 0) return

    let target = Math.min(1, Math.max(0, fraction)) * duration
    let index = 0
    while (index < estimates.length - 1 && target >= estimates[index]) {
      target -= estimates[index]
      index += 1
    }

    const chapter = book.chapters[index]
    const within = estimates[index] > 0 ? target / estimates[index] : 0
    const segments = get(segmentProgress).get(chapter.id)?.totalSegments ?? 0
    await this.openChapter(chapter, segments > 0 ? Math.floor(within * segments) : undefined)
  }

  // ---- generation & export ----

  async generate(ids: string[]): Promise<void> {
    const book = this.book
    if (!book) return
    const chapters = book.chapters.filter((c) => ids.includes(c.id))
    if (chapters.length === 0) return
    await generateMissing({ ...book, chapters }, this.bookId ?? undefined)
  }

  async retry(ids: string[]): Promise<void> {
    const book = this.book
    if (!book) return
    await retryChapters(book, ids, this.bookId ?? undefined)
  }

  async generateMissing(): Promise<void> {
    const book = this.book
    if (!book) return
    await generateMissing(book, this.bookId ?? undefined)
  }

  async export(): Promise<void> {
    const book = this.book
    if (!book) return
    this.exportState = { busy: true, done: false }
    try {
      await exportBookAction(book, { format: exportFormatState })
      this.exportState = { busy: false, done: true }
    } catch (error) {
      this.exportState = {
        busy: false,
        done: false,
        error: error instanceof Error ? error.message : 'Export failed',
      }
    }
  }
}

export const reader = new ReaderModel()
