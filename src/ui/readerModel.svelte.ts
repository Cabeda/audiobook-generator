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
import { clearChapterSegments, segmentProgress } from '../stores/segmentProgressStore'
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
import { isMobileDevice } from '../lib/utils/mobileDetect'
import {
  exportBook as exportBookAction,
  generateMissing,
  reprocessChapter,
  retryChapters,
} from '../lib/services/audiobookService'
import { ListenSession } from '../lib/reader/listenSession'
import { createAudioPlatform } from '../lib/reader/audioPlatform'
import { resolveChapterLanguageWithDetection } from '../lib/utils/languageResolver'
import { listenPlanFor, resolveModel } from '../lib/services/listenPlan'
import { generationService } from '../lib/services/generationService'
import {
  clearGenerationState,
  getInterruptedGeneration,
  type GenerationState,
} from '../lib/services/generationStateStore'
import { appSettings } from '../stores/appSettingsStore'
import { loadPosition } from '../stores/readerPositionStore'
import { continueAfterChapter, playbackSpeed } from '../stores/readerPrefsStore'
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

class ReaderModel {
  constructor() {
    // Speed outlives the session, like the reader's theme and text size.
    audioService.setSpeed(get(playbackSpeed))
  }

  exportState = $state<ExportState>({ busy: false, done: false })
  /** A model that has run in this session is on the device. */
  private modelWarmed = false

  /** The listening session: every playback verb goes through it. */
  private listen = new ListenSession(
    createAudioPlatform({
      book: () => this.book,
      bookId: () => this.bookId,
      settings: (chapter) => this.settingsFor(chapter),
    })
  )

  /** Loading settings for a chapter: the plan, and the speed in use. */
  private settingsFor(chapter: Chapter) {
    const plan = this.planFor(this.book, chapter)
    return {
      voice: plan.voice,
      model: plan.model,
      quantization: plan.quantization,
      device: plan.device,
      speed: audioService.playbackSpeed,
    }
  }

  /**
   * How a chapter is read now: the engine and voice every new segment uses.
   * Exposed so the audiobook panel can tell which stored audio is outdated.
   */
  planFor(book: Book | null, chapter: Chapter) {
    return listenPlanFor(
      book ?? { title: '', author: '', chapters: [] },
      chapter,
      {
        // shortcut: readiness means 'ran this session'; per-model download
        // state belongs to modelStatus when it exposes one
        model: resolveModel(this.prefs.model as never, {
          offline: typeof navigator !== 'undefined' && !navigator.onLine,
          modelReady: this.modelWarmed,
        }),
        voice: this.prefs.voice,
        quantization: get(selectedQuantization),
        device: get(selectedDevice),
        isMobile: isMobileDevice(),
        languageDefaults: get(appSettings).languageDefaults,
      },
      get(piperVoices)
    )
  }

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
        audioService.setVoice(value)
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
        playbackSpeed.set(value)
      },
      get exportFormat() {
        return exportFormatState
      },
      set exportFormat(value: ExportFormat) {
        exportFormatState = value
      },
      get autoContinue() {
        return get(continueAfterChapter)
      },
      set autoContinue(value: boolean) {
        continueAfterChapter.set(value)
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
    await this.play(chapter, { atSegment })
  }

  /**
   * Play a chapter: the session decides between resuming the loaded one and
   * loading a new one; where the listener left off comes from the saved
   * position.
   */
  async play(chapter: Chapter, options: { atSegment?: number } = {}): Promise<void> {
    try {
      const saved = loadPosition(this.bookId)
      const at =
        options.atSegment ??
        (saved?.chapterId === chapter.id && saved.segmentIndex > 0 ? saved.segmentIndex : undefined)
      await this.listen.play(chapter, { atSegment: at })
      this.modelWarmed = true
    } catch (error) {
      logger.error('Could not start playback', error)
      toastStore.error('Could not start playback')
    }
  }

  /** Speak from a given sentence (click-to-continue). */
  async playFromSegment(chapter: Chapter, index: number): Promise<void> {
    try {
      await this.listen.playFrom(chapter, index)
      this.modelWarmed = true
    } catch (error) {
      logger.error('Could not start playback', error)
      toastStore.error('Could not start playback')
    }
  }

  toggle(): void {
    this.listen.toggle()
  }

  stop(): void {
    this.listen.stop()
  }

  skip(seconds: number): void {
    this.listen.skip(seconds)
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

  /**
   * The voice or engine changed: the chapter is made again with the new plan,
   * from the sentence being heard. Dropping the player's cache first keeps the
   * old narrator from being handed back while the new audio arrives.
   */
  async planChanged(): Promise<void> {
    audioService.setPlan({ voice: this.prefs.voice, model: this.prefs.model as SelectedModel })

    const book = this.book
    const chapterId = this.chapterId
    if (!book || !chapterId) return

    // A book run owns the worker. The sentence being heard is re-made now; the
    // rest of the chapter waits for the run to end, so the chapter does not end
    // up with two narrators. Chapters already queued pick up the new plan when
    // they start on their own.
    if (generationService.isRunning()) {
      toastStore.info('The new voice applies when the current generation finishes.')
      await this.remakeCurrentSegment()
      await generationService.whenIdle()
      // The listener may have moved on while the run finished.
      if (this.chapterId !== chapterId || generationService.isRunning()) return
    }

    try {
      await reprocessChapter(book, chapterId, this.bookId ?? undefined, this.segmentIndex)
    } catch (error) {
      logger.warn('Could not make the chapter again', error)
    }
  }

  /**
   * Make the given chapters again with the plan in force now, one at a time.
   * Used by the audiobook panel for audio left in another voice.
   */
  async matchCurrentVoice(
    book: Book & { id?: number | null },
    chapterIds: string[]
  ): Promise<void> {
    for (const chapterId of chapterIds) {
      if (generationService.isRunning()) return
      try {
        await reprocessChapter(book, chapterId, book.id ?? this.bookId ?? undefined, 0)
      } catch (error) {
        logger.warn('Could not make the chapter again', error)
      }
    }
  }

  /** Re-make the playing segment (a voice or model change mid-listen). */
  async remakeCurrentSegment(): Promise<void> {
    const book = this.book
    const chapterId = this.chapterId
    if (!book || !chapterId) return
    const chapter = book.chapters.find((c) => c.id === chapterId)
    if (!chapter) return
    await this.remakeSegmentAt(chapter, Math.max(0, this.segmentIndex))
  }

  /** Re-make one sentence now, with the voice selected now. */
  async remakeSegmentAt(chapter: Chapter, index: number): Promise<void> {
    const book = this.book
    toastStore.info('Making this sentence again…')
    try {
      await this.listen.remakeSegment(chapter, index, {
        model: this.prefs.model,
        voice: this.prefs.voice,
        language: resolveChapterLanguageWithDetection(
          chapter,
          book ?? { title: '', author: '', chapters: [] }
        ),
        quantization: get(selectedQuantization),
        device: get(selectedDevice),
      })
    } catch (error) {
      logger.warn('Could not re-make the sentence', error)
      toastStore.error('Could not make this sentence again')
    }
  }

  /** Stop the run in progress; what was made is kept and can be resumed. */
  cancelGeneration(): void {
    generationService.cancel()
    this.interrupted = getInterruptedGeneration()
  }

  /** Drop a book's audio from memory too, after the database rows are gone. */
  forgetAudio(book: Book & { id?: number | null }): void {
    const ids = new Set(book.chapters.map((c) => c.id))
    chapterStatus.update((map) => {
      const next = new Map(map)
      for (const id of ids) next.set(id, 'pending')
      return next
    })
    for (const id of ids) clearChapterSegments(id)
    if (this.chapterId && ids.has(this.chapterId)) audioService.stop()
  }

  /** A run that was interrupted (tab closed, crash) and can be picked up. */
  interrupted = $state<GenerationState | null>(getInterruptedGeneration())

  async resumeInterrupted(): Promise<void> {
    const state = this.interrupted
    const book = this.book
    if (!state || !book) return
    const ids = state.chapterIds.filter((id) => !state.completedChapterIds.includes(id))
    const chapters = book.chapters.filter((c) => ids.includes(c.id))
    this.interrupted = null
    if (chapters.length === 0) {
      clearGenerationState()
      return
    }
    try {
      await generationService.resumeChapters(chapters, state.bookId)
    } catch (error) {
      logger.warn('Could not resume generation', error)
      toastStore.error('Could not resume making the book')
    }
  }

  dismissInterrupted(): void {
    this.interrupted = null
    clearGenerationState()
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
