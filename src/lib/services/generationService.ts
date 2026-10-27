/**
 * Generation Service — TTS Audio Generation Orchestrator
 *
 * This is the central service that coordinates text-to-speech audio generation
 * for book chapters. It manages the full lifecycle from text segmentation through
 * audio synthesis to persistence.
 *
 * ## Overall Flow
 *
 * 1. **Segmentation** — Chapter HTML is split into sentences via DOM-based parsing
 *    (`segmentationService`). The segmented HTML is persisted back to IndexedDB.
 *
 * 2. **Generation** — Each text segment is sent to the TTS worker (`ttsWorkerManager`)
 *    which runs inference off-main-thread (Kokoro ONNX, Piper, or Web Speech API).
 *    Segments are processed in parallel batches controlled by `parallelChunks`.
 *
 * 3. **Persistence** — Completed audio segments are immediately flushed to IndexedDB
 *    via `SegmentBatchHandler` (batch size = 1 for crash safety). Blob references
 *    are released after persistence to prevent OOM on mobile.
 *
 * 4. **Progressive Playback** — The first completed segment triggers auto-play
 *    (if enabled). The `audioPlaybackService` chains segments as they arrive.
 *
 * 5. **Completion** — Segment start times are computed and persisted. Concatenation
 *    is deferred to export time to avoid OOM from loading all blobs simultaneously.
 *
 * ## Key State Transitions
 *
 * - `idle` → `processing`: `generateChapters()` or `generateSingleChapterFromSegment()`
 * - `processing` → `done`: All segments generated successfully
 * - `processing` → `error`: One or more segments failed (partial results preserved)
 * - `processing` → `idle`: `cancel()` or `cancelChapter()`
 *
 * ## Cancellation
 *
 * - `cancel()` — Stops all generation, resets processing chapters to 'pending'
 * - `cancelChapter(chapterId)` — Cancels a single chapter; generation continues for others
 * - Canceled state is checked between each segment batch
 *
 * ## Retry / Resume
 *
 * - `resumeChapters()` — Loads already-generated segments from IndexedDB, skips them,
 *   and generates only missing segments. Used for crash recovery.
 * - `generationStateStore` persists progress to localStorage for crash detection.
 *
 * ## OOM Handling
 *
 * - TTS worker is restarted periodically to reclaim WASM heap (every chapter on mobile,
 *   every 3 chapters on desktop, or when `shouldRestartWorkerForMemory()` detects pressure)
 * - Segment blobs are released from memory immediately after IndexedDB persistence
 * - On mobile, a 500ms yield between segments allows GC to reclaim memory
 * - Concatenation is skipped during generation (deferred to export)
 *
 * ## Relationships
 *
 * - **segmentBatchHandler** — Handles batched persistence of audio segments to IndexedDB.
 *   Marks segments as generated in `segmentProgressStore` for real-time UI feedback.
 *   Tracks flushed segments so blob references can be released.
 *
 * - **generationStateStore** — Persists generation progress to localStorage for crash
 *   recovery. Stores book ID, chapter IDs, completed chapters, and TTS settings.
 *   Cleared on successful completion or explicit cancellation.
 *
 * - **segmentProgressStore** — Tracks per-segment generation state for UI display.
 *   Updated by both this service (init, processing index) and segmentBatchHandler (completion).
 *
 * @module generationService
 */

import { get, writable } from 'svelte/store'
import type { Chapter } from '../types/book'
import { getTTSWorker, terminateTTSWorker } from '../ttsWorkerManager'
import { StallWatchdog } from '../utils/stallWatchdog'
import {
  selectedModel,
  selectedVoice,
  selectedQuantization,
  selectedDevice,
} from '../../stores/ttsStore'
import {
  chapterStatus,
  chapterErrors,
  generatedAudio,
  chapterProgress,
  book,
  isGenerating,
} from '../../stores/bookStore'
import { advancedSettings } from '../../stores/ttsStore'
import logger from '../utils/logger'
import { toastStore } from '../../stores/toastStore'
import { appSettings } from '../../stores/appSettingsStore'
import { type LibraryBook } from '../libraryDB'
import type { AudioSegment } from '../types/audio'
import { resolveChapterLanguageWithDetection, DEFAULT_LANGUAGE } from '../utils/languageResolver'
import { isMobileDevice } from '../utils/mobileDetect'
import { shouldRestartWorkerForMemory } from '../utils/resourceMonitor'
import { audioService } from '../audioPlaybackService.svelte'

import {
  clearSegmentIndices,
  initChapterSegments,
  markChapterGenerationComplete,
  segmentProgress,
  setProcessingIndex,
} from '../../stores/segmentProgressStore'
import { createThrottledMapUpdater } from '../../stores/batchedStoreUpdates'

// Extracted modules
import { isMismatchedSegment, planChapter } from './chapterPlan'
import { describeGenerationFailure } from '../errors'
import { engineCapabilities, engineSupportsLanguage, type TTSModelType } from '../tts/ttsModels'
import type { PiperVoice } from '../piper/piperClient'
import { segmentId } from '../segments'
import { segmentHtmlContent } from './segmentationService'
import type { SegmentOptions } from './segmentationService'
import { SegmentBatchHandler } from './segmentBatchHandler'
import { produceSegment } from './segmentProduction'
import { exportEpub } from './exportService'
import {
  saveGenerationState,
  markChapterCompleted,
  clearGenerationState,
} from './generationStateStore'

// Re-export extracted modules for backward compatibility
export { segmentHtmlContent }

export type { SegmentOptions }

// Throttled progress updater — batches rapid segment progress updates into animation frames
const throttledProgress = createThrottledMapUpdater(chapterProgress)

/**
 * Type representing a LibraryBook with a guaranteed ID property
 */
type LibraryBookWithId = LibraryBook & { id: number }

/**
 * Type guard to check if a book has an ID property (i.e., is a LibraryBook with ID)
 */
function hasBookId(book: unknown): book is LibraryBookWithId {
  return (
    book !== null &&
    book !== undefined &&
    typeof book === 'object' &&
    'id' in book &&
    typeof (book as LibraryBookWithId).id === 'number'
  )
}

/**
 * Helper function to safely extract the book ID from the book store.
 * The book store can contain either a Book or a LibraryBook (which extends Book with an id property).
 * @returns The book ID as a number, or 0 if not available
 */
function getBookId(): number {
  const currentBook = get(book)
  if (hasBookId(currentBook)) {
    return currentBook.id // Type guard ensures id is number, not undefined
  }
  return 0
}

/** A chapter that reports no progress for this long is stuck, not slow. */
const CHAPTER_STALL_MS = 10 * 60_000

class GenerationService {
  private running = false
  /** Callbacks waiting for the run in progress to end. */
  private idleWaiters: Array<() => void> = []

  private setRunning(value: boolean) {
    this.running = value
    isGeneratingStore.set(value)
  }
  private canceled = false
  private canceledChapters = new Set<string>()

  private wakeLock: WakeLockSentinel | null = null
  private priorityOverrides = new Map<string, number>()

  /** Chapters waiting to be generated, in order. */
  private queue: Chapter[] = []
  /** The chapter being generated right now, if any. */
  private currentChapterId: string | null = null
  /** Set when the reader's chapter must be made before the current one goes on. */
  private yieldRequested = false
  /** Where the reader is in a chapter, so that segment is made first. */
  private readerPositions = new Map<string, number>()
  private completedChapterIds = new Set<string>()
  private chaptersRun = 0

  // Auto-play settings for seamless mobile experience
  private autoPlayEnabled = false
  private autoPlayTriggered = new Set<string>() // Track chapters where auto-play was already triggered

  /**
   * Enable or disable auto-play of first segment when generation starts
   * Auto-play provides seamless listening experience on mobile
   */
  setAutoPlay(enabled: boolean) {
    this.autoPlayEnabled = enabled
    logger.info(`Auto-play ${enabled ? 'enabled' : 'disabled'}`)
  }

  /**
   * Set the next segment to be processed for a chapter.
   * This allows the user to click a segment and prioritize its generation,
   * continuing sequentially from there.
   */
  setGenerationPriority(chapterId: string, segmentIndex: number) {
    // Only accept if we are running
    if (this.running) {
      this.priorityOverrides.set(chapterId, segmentIndex)
      logger.info(`Set generation priority for chapter ${chapterId} to segment ${segmentIndex}`)
    }
  }

  // Bind the handler so it can be added/removed as an event listener
  private handleVisibilityChange = async () => {
    if (document.visibilityState === 'visible' && this.running) {
      logger.info('Page became visible, re-acquiring wake lock')
      await this.requestWakeLock()
    }
  }

  private async requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen')
        logger.info('Screen Wake Lock acquired')
      } else {
        logger.warn('Screen Wake Lock API not supported/available')
      }
    } catch (err) {
      logger.warn('Failed to acquire Screen Wake Lock', err)
    }
  }

  private async releaseWakeLock() {
    try {
      if (this.wakeLock) {
        await this.wakeLock.release()
        this.wakeLock = null
        logger.info('Screen Wake Lock released')
      }
    } catch (err) {
      logger.warn('Failed to release Screen Wake Lock', err)
    }
  }

  // Silent audio helpers to prevent background throttling
  private audioContext: AudioContext | null = null
  private silentOscillator: OscillatorNode | null = null
  private silentGainNode: GainNode | null = null

  private async startSilentAudio() {
    try {
      // Stop any existing silent audio to ensure clean state
      await this.stopSilentAudio()

      if (typeof window === 'undefined') return

      const AudioContextClass =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) return

      this.audioContext = new AudioContextClass()

      // Create a silent oscillator
      // browsers might optimize away purely silent (gain 0) audio, so we use near-zero gain
      this.silentGainNode = this.audioContext.createGain()
      this.silentGainNode.gain.value = 0.0001 // Inaudible but active
      this.silentGainNode.connect(this.audioContext.destination)

      this.silentOscillator = this.audioContext.createOscillator()
      this.silentOscillator.type = 'sine'
      this.silentOscillator.frequency.value = 440
      this.silentOscillator.connect(this.silentGainNode)
      this.silentOscillator.start()

      logger.info('Silent audio started to prevent background throttling')
    } catch (err) {
      logger.warn('Failed to start silent audio', err)
    }
  }

  private async stopSilentAudio() {
    try {
      if (this.silentOscillator) {
        try {
          this.silentOscillator.stop()
        } catch {
          // Ignore stop errors; oscillator may already be stopped
        }
        try {
          this.silentOscillator.disconnect()
        } catch {
          // ignore
        }
        this.silentOscillator = null
      }

      if (this.silentGainNode) {
        try {
          this.silentGainNode.disconnect()
        } catch {
          // Ignore disconnect errors; node may already be disconnected
        }
        this.silentGainNode = null
      }

      if (this.audioContext) {
        // Resume before closing — closing a suspended context can silently fail
        // in some browsers, leaving the context (and its memory) alive.
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume().catch(() => {})
        }
        await this.audioContext.close().catch((e) => logger.warn('Failed to close AudioContext', e))
        this.audioContext = null
      }
      logger.info('Silent audio stopped')
    } catch (err) {
      logger.warn('Failed to stop silent audio', err)
    }
  }

  /**
   * Process segments with dynamic priority handling.
   * Replaces strict sequential/batch processing.
   *
   * @param chapterId Chapter ID for priority lookup
   * @param segments List of segments to process
   * @param getParallelism Function that returns current parallelism level (re-read each batch)
   * @param processor Function to process a single segment
   * @param onResult Function to handle the result (e.g. saving to DB)
   * @param onProgress Function to report progress
   */
  private async processSegmentsWithPriority<T, R>(
    chapterId: string,
    segments: T[],
    getParallelism: () => number,
    processor: (segment: T) => Promise<R>,
    onResult: (result: R) => Promise<void>,
    onProgress: (completed: number, total: number) => void,
    skipIndices?: Set<number>
  ): Promise<{ failed: number; failedIndices: number[]; yielded: boolean }> {
    const total = segments.length
    const processed = new Set<number>(skipIndices)
    const failed = new Set<number>()
    let cursor = 0 // Start at beginning

    // Main loop: Continue until all segments are processed or canceled
    while (processed.size + failed.size < total && !this.canceled) {
      // The reader's chapter is waiting: leave this one at the segment
      // boundary so it can be made first.
      if (this.yieldRequested) {
        return { failed: failed.size, failedIndices: [...failed], yielded: true }
      }
      const batch: T[] = []
      const batchIndices = new Set<number>()

      // Re-read parallelism each batch so user changes take effect immediately
      const parallelism = getParallelism()

      // Fill batch with next available segments
      while (batch.length < parallelism && processed.size + failed.size + batch.length < total) {
        let nextIndex: number | undefined

        // 1. Check for priority override
        if (this.priorityOverrides.has(chapterId)) {
          const priority = this.priorityOverrides.get(chapterId)!
          if (
            priority >= 0 &&
            priority < total &&
            !processed.has(priority) &&
            !failed.has(priority) &&
            !batchIndices.has(priority)
          ) {
            nextIndex = priority
            cursor = (priority + 1) % total
            this.priorityOverrides.delete(chapterId)
          } else {
            this.priorityOverrides.delete(chapterId)
          }
        }

        // 2. Fallback to cursor logic if no valid priority
        if (nextIndex === undefined) {
          let checked = 0
          while (
            (processed.has(cursor) || failed.has(cursor) || batchIndices.has(cursor)) &&
            checked < total
          ) {
            cursor = (cursor + 1) % total
            checked++
          }

          if (checked < total) {
            nextIndex = cursor
            cursor = (cursor + 1) % total
          }
        }

        if (nextIndex !== undefined) {
          const seg = segments[nextIndex]
          if (seg) {
            batch.push(seg)
            batchIndices.add(nextIndex)
          } else {
            logger.warn(`Segment at index ${nextIndex} not found`)
            failed.add(nextIndex)
          }
        } else {
          break
        }
      }

      if (batch.length === 0) break

      // Update the currently-processing index so the UI can pulse the right segment
      const batchIndexArray = Array.from(batchIndices)
      setProcessingIndex(chapterId, batchIndexArray[0])

      // Process batch — handle individual failures without losing the whole batch
      const results = await Promise.allSettled(
        batch.map(async (seg) => {
          if (this.canceled) throw new Error('Generation canceled')
          return await processor(seg)
        })
      )

      if (this.canceled) break

      // Handle results: successful ones go to onResult, failed ones are tracked
      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        const idx = batchIndexArray[i]

        if (result.status === 'fulfilled' && result.value) {
          try {
            await onResult(result.value)
            processed.add(idx)
          } catch (err) {
            logger.error(`Failed to handle result for segment ${idx}:`, err)
            failed.add(idx)
          }
        } else if (result.status === 'rejected') {
          logger.error(`Segment ${idx} generation failed:`, result.reason)
          failed.add(idx)
        } else {
          // fulfilled with null (e.g. empty segment) — mark as processed
          processed.add(idx)
        }
      }

      onProgress(processed.size, total)
    }

    const failedIndices = Array.from(failed)
    if (failed.size > 0) {
      logger.warn(
        `[processSegments] ${failed.size}/${total} segments failed for chapter ${chapterId}`,
        { failedIndices }
      )
    }
    return { failed: failed.size, failedIndices, yielded: false }
  }

  /**
   * Generate audio for a single chapter starting from a specific segment index.
   * This is used when clicking a segment in the reader to start generation from that point.
   * After reaching the end, it will generate all missing segments to ensure complete audio.
   *
   * @param chapter - The chapter to generate
   * @param startSegmentIndex - The segment index to start from (0-based)
   * @param totalSegments - Optional total number of segments for immediate progress display
   */
  async generateSingleChapterFromSegment(
    chapter: Chapter,
    startSegmentIndex: number = 0,
    totalSegments?: number,
    bookId?: number
  ) {
    if (this.running) {
      logger.warn('Generation already running, not starting new generation')
      toastStore.warning('Generation is already running')
      // Reset status to pending if it was optimistically set
      chapterStatus.update((m) => {
        const nm = new Map(m)
        if (nm.get(chapter.id) === 'processing') nm.set(chapter.id, 'pending')
        return nm
      })
      return
    }

    logger.info(`Starting generation for chapter ${chapter.id} from segment ${startSegmentIndex}`)

    // Immediately set status to 'processing' so UI updates before async work begins
    chapterStatus.update((m) => new Map(m).set(chapter.id, 'processing'))

    // If we know the total segments, initialize segment progress immediately for better UX
    if (totalSegments && totalSegments > 0) {
      // Create placeholder segments with the known count
      const placeholderSegments = Array.from({ length: totalSegments }, (_, i) => ({
        text: '',
        id: segmentId(i),
        index: i,
      }))
      initChapterSegments(chapter.id, placeholderSegments)
      logger.info(`Pre-initialized ${totalSegments} segments for immediate UI feedback`)
    } else {
      // Fallback: Set initial progress message for immediate UI feedback
      chapterProgress.update((m) =>
        new Map(m).set(chapter.id, {
          current: 0,
          total: 1,
          message: 'Starting generation from segment...',
        })
      )
    }

    // Set priority for this chapter and segment
    this.priorityOverrides.set(chapter.id, startSegmentIndex)

    // Use the existing generateChapters method which handles priorities
    await this.generateChapters([chapter], bookId)
  }

  /**
   * The reader is listening to this chapter: make it next, before the rest of
   * the book. A chapter already being generated is left at the segment
   * boundary — its segments are saved — and finished after the reader's.
   */
  prioritizeChapter(chapter: Chapter) {
    if (!this.running) return
    this.queue = [chapter, ...this.queue.filter((queued) => queued.id !== chapter.id)]
    if (this.currentChapterId && this.currentChapterId !== chapter.id) {
      this.yieldRequested = true
    }
  }

  /** The segment the reader is on; it is made before the others in its chapter. */
  setReaderPosition(chapterId: string, segmentIndex: number) {
    this.readerPositions.set(chapterId, segmentIndex)
    if (this.running && this.currentChapterId === chapterId) {
      this.priorityOverrides.set(chapterId, segmentIndex)
    }
  }

  /**
   * Generate audio for one or more chapters.
   *
   * Resume is the same loop with a different label: the chapter generator
   * already skips the segments that exist, so a resumed chapter only makes the
   * missing ones.
   */
  async generateChapters(
    chapters: Chapter[],
    explicitBookId?: number,
    options: { resume?: boolean } = {}
  ) {
    logger.info('[generateChapters] Starting generation', {
      chapterCount: chapters.length,
      resume: options.resume ?? false,
      chapters: chapters.map((ch) => ({
        id: ch.id,
        title: ch.title,
        contentLength: ch.content?.length || 0,
      })),
    })

    if (this.running) {
      logger.warn('Generation already running')
      return
    }

    const model = get(selectedModel)

    this.setRunning(true)
    this.canceled = false
    this.canceledChapters.clear()
    this.autoPlayTriggered.clear()
    this.completedChapterIds.clear()
    this.queue = [...chapters]
    this.chaptersRun = 0
    isGenerating.set(true)

    const bookId = explicitBookId ?? getBookId()
    const currentBook = get(book)
    if (bookId && !options.resume) {
      saveGenerationState({
        bookId,
        bookTitle: currentBook?.title || 'Unknown',
        chapterIds: chapters.map((ch) => ch.id),
        completedChapterIds: [],
        currentChapterIndex: 0,
        startedAt: Date.now(),
        model,
        voice: get(selectedVoice),
        quantization: get(selectedQuantization),
        device: get(selectedDevice),
      })
    }

    await this.requestWakeLock()
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
    await this.startSilentAudio()
    getTTSWorker()

    try {
      while (!this.canceled) {
        const chapter = this.takeNextChapter()
        if (!chapter) break
        await this.runChapter(chapter, explicitBookId ?? getBookId())
      }
    } finally {
      throttledProgress.flush()
      this.currentChapterId = null
      this.queue = []
      audioService.setSegmentsAreExternal(false)
      this.readerPositions.clear()
      this.priorityOverrides.clear()
      this.setRunning(false)
      isGenerating.set(false)

      // Clear generation state on successful completion.
      // A run the person stopped keeps its state: the reader offers to pick it
      // up where it left off. Interrupted (crash) state is also preserved.
      if (!this.canceled) clearGenerationState()

      await this.stopSilentAudio()
      document.removeEventListener('visibilitychange', this.handleVisibilityChange)
      await this.releaseWakeLock()

      // The worker is free again, and this run's cleanup is done: anything
      // that waited for it can start without fighting the teardown above.
      const waiters = this.idleWaiters
      this.idleWaiters = []
      for (const resolve of waiters) resolve()
    }
  }

  /**
   * Resume generation for chapters that were partially generated.
   * Already-generated segments are skipped; only the missing ones are made.
   */
  async resumeChapters(chapters: Chapter[], explicitBookId?: number) {
    await this.generateChapters(chapters, explicitBookId, { resume: true })
  }

  /** The next chapter to generate, honouring cancellation and completion. */
  private takeNextChapter(): Chapter | undefined {
    while (this.queue.length > 0) {
      const chapter = this.queue.shift()!
      if (this.canceledChapters.has(chapter.id)) continue
      if (this.completedChapterIds.has(chapter.id)) continue
      // A chapter starts with no pending yield: the reader's chapter is the
      // one this chapter made way for, and it is now current.
      this.yieldRequested = false
      return chapter
    }
    return undefined
  }

  /** Plan, generate and record one chapter. */
  private async runChapter(ch: Chapter, bookId: number) {
    const currentBook = get(book)

    // Resolve the effective language for this chapter (with auto-detection support)
    const effectiveLanguage = currentBook
      ? resolveChapterLanguageWithDetection(ch, currentBook)
      : DEFAULT_LANGUAGE

    // The plan decides the engine, the voice and the settings for this chapter.
    const plan = planChapter({
      chapter: ch,
      language: effectiveLanguage,
      languageDefaults: get(appSettings).languageDefaults,
      selectedModel: get(selectedModel),
      selectedVoice: get(selectedVoice),
      selectedQuantization: get(selectedQuantization),
      selectedDevice: get(selectedDevice),
      piperVoices: await this.piperVoicesIfNeeded(ch, effectiveLanguage),
      isMobile: isMobileDevice(),
    })
    const effectiveModel = plan.model
    const isFallbackModel = plan.isFallbackModel

    if (isFallbackModel) {
      logger.warn(
        `Language '${effectiveLanguage}' is not covered by the chosen engine. Using Piper for chapter ${ch.id}`
      )
    }

    const currentQuantization = plan.quantization
    const currentDevice = plan.device
    const currentAdvancedSettings = get(advancedSettings)[effectiveModel] || {}

    // Validate content — skip empty chapters gracefully without an error
    if (!ch.content || !ch.content.trim()) {
      logger.info(`[Generation] Skipping empty chapter: ${ch.title} (${ch.id})`)
      // Store a silent WAV so download/export still works
      if (bookId) {
        const { createSilentWav } = await import('../wavUtils')
        const { saveChapterAudio } = await import('../libraryDB')
        await saveChapterAudio(bookId, ch.id, createSilentWav(0))
      }
      chapterStatus.update((m) => new Map(m).set(ch.id, 'done'))
      chapterErrors.update((m) => {
        const newMap = new Map(m)
        newMap.delete(ch.id)
        return newMap
      })
      this.completedChapterIds.add(ch.id)
      return
    }

    // Update status to processing
    chapterStatus.update((m) => new Map(m).set(ch.id, 'processing'))

    // Make the segment the reader is on before the others.
    const readerPosition = this.readerPositions.get(ch.id)
    if (readerPosition !== undefined) this.priorityOverrides.set(ch.id, readerPosition)

    const effectiveVoice = plan.voice

    this.currentChapterId = ch.id
    try {
      const outcome = await this.withChapterWatchdog(ch.id, (watchdog) =>
        this.generateChapterAudio(
          ch,
          effectiveModel,
          effectiveVoice,
          effectiveLanguage,
          currentQuantization,
          currentDevice,
          currentAdvancedSettings,
          bookId,
          watchdog
        )
      )

      if (outcome === 'yielded') {
        // The reader's chapter is now first in the queue; finish this one after it.
        logger.info(`[generateChapters] Leaving chapter ${ch.id} for the reader's chapter`)
        chapterStatus.update((m) => new Map(m).set(ch.id, 'pending'))
        this.queue.splice(Math.min(1, this.queue.length), 0, ch)
        return
      }

      if (outcome === 'canceled') return

      // Flush any pending throttled progress updates before marking done
      throttledProgress.flush()
      chapterStatus.update((m) => new Map(m).set(ch.id, 'done'))
      chapterErrors.update((m) => {
        const newMap = new Map(m)
        newMap.delete(ch.id)
        return newMap
      })
      this.completedChapterIds.add(ch.id)

      // Persist progress for crash recovery
      markChapterCompleted(ch.id)

      // Restart the TTS worker periodically to reclaim WASM heap memory.
      // The ONNX runtime's WASM heap grows with each inference and never
      // shrinks — restarting the worker is the only way to release it.
      // Mobile: every chapter. Desktop: every 3 chapters or when memory pressure is high.
      this.chaptersRun++
      const shouldRestart = isMobileDevice()
        ? true
        : this.chaptersRun % 3 === 0 || (await shouldRestartWorkerForMemory())
      if (shouldRestart) {
        logger.info(
          `[OOM mitigation] Restarting TTS worker after chapter ${this.chaptersRun} to reclaim WASM heap`
        )
        terminateTTSWorker()
        // Yield to let the terminated worker's memory be reclaimed
        await new Promise((r) => setTimeout(r, isMobileDevice() ? 1000 : 500))
      }
    } catch (err: unknown) {
      if (this.canceled || this.canceledChapters.has(ch.id)) return
      // The strip shows an actionable sentence; the engine detail stays in the log.
      const errorMsg = describeGenerationFailure(err)
      logger.error(`Generation failed for chapter ${ch.title}:`, err)
      chapterStatus.update((m) => new Map(m).set(ch.id, 'error'))
      chapterErrors.update((m) => new Map(m).set(ch.id, errorMsg))
    } finally {
      this.currentChapterId = null
    }
  }

  /**
   * The Piper voices, only when Piper may read this chapter. The client keeps
   * the list, so asking once per chapter costs nothing after the first time.
   */
  private async piperVoicesIfNeeded(
    ch: Chapter,
    language: string
  ): Promise<PiperVoice[] | undefined> {
    const requested = (ch.model ||
      get(appSettings).languageDefaults[language]?.model ||
      get(selectedModel)) as TTSModelType
    if (requested !== 'piper' && engineSupportsLanguage(requested, language)) return undefined
    const { PiperClient } = await import('../piper/piperClient')
    return PiperClient.getInstance().getVoices()
  }

  /**
   * Runs one chapter under a stall watchdog. When the worker stops reporting
   * progress the worker is terminated, which rejects the in-flight request and
   * lets the chapter fail so the run can continue.
   */
  private async withChapterWatchdog<T>(
    chapterId: string,
    run: (watchdog: StallWatchdog) => Promise<T>
  ): Promise<T> {
    const watchdog = new StallWatchdog({
      limitMs: CHAPTER_STALL_MS,
      onStall: () => {
        logger.error(
          `[Generation] Chapter ${chapterId} made no progress for ${CHAPTER_STALL_MS / 60_000} min — restarting the TTS worker`
        )
        terminateTTSWorker()
      },
    })
    watchdog.start()
    try {
      return await run(watchdog)
    } finally {
      watchdog.stop()
    }
  }

  /**
   * Segment, generate, and persist audio for a single chapter.
   *
   * `yielded` means the reader needs this chapter's place in the queue: the
   * segments made so far are saved and the rest waits.
   */
  private async generateChapterAudio(
    ch: Chapter,
    effectiveModel: TTSModelType,
    effectiveVoice: string,
    effectiveLanguage: string,
    currentQuantization: string,
    currentDevice: string,
    currentAdvancedSettings: Record<string, unknown>,
    bookId: number,
    watchdog?: StallWatchdog
  ): Promise<'done' | 'canceled' | 'yielded'> {
    logger.info(`[generateChapters] Segmenting HTML for ${effectiveModel}`, {
      chapterId: ch.id,
      contentLength: ch.content.length,
      contentPreview: ch.content.substring(0, 200),
    })

    // Update progress to show segmentation phase
    chapterProgress.update((m) =>
      new Map(m).set(ch.id, {
        current: 0,
        total: 1,
        message: 'Segmenting text...',
      })
    )

    // 1. Segment HTML
    const { html, segments: textSegments } = segmentHtmlContent(ch.id, ch.content, {
      ignoreCodeBlocks: Boolean(currentAdvancedSettings.ignoreCodeBlocks),
      ignoreLinks: Boolean(currentAdvancedSettings.ignoreLinks),
    })
    ch.content = html

    // Guard: if segmentation produced no text segments (e.g. image-only or
    // code-only chapter with those options ignored), skip gracefully.
    if (textSegments.length === 0) {
      logger.info(`[Generation] No text segments for chapter "${ch.title}" (${ch.id}), skipping`)
      // Store a silent WAV so download/export still works
      if (bookId) {
        const { createSilentWav } = await import('../wavUtils')
        const { saveChapterAudio } = await import('../libraryDB')
        await saveChapterAudio(bookId, ch.id, createSilentWav(0))
      }
      chapterStatus.update((m) => new Map(m).set(ch.id, 'done'))
      chapterErrors.update((m) => {
        const newMap = new Map(m)
        newMap.delete(ch.id)
        return newMap
      })
      return 'done'
    }

    // 2. Persist segmented HTML
    if (bookId) {
      const { updateChapterContent } = await import('../libraryDB')
      await updateChapterContent(bookId, ch.id, html)
    }

    // Helper to update the chapter progress message in the UI
    const setProgress = (current: number, total: number, message: string) => {
      watchdog?.touch()
      throttledProgress.set(ch.id, { current, total, message })
    }

    setProgress(0, textSegments.length, 'Initializing generation...')

    // 3. Generate audio per segment
    const audioSegments: AudioSegment[] = []
    const getParallelChunks = () =>
      Math.max(1, Number(get(advancedSettings)[effectiveModel]?.parallelChunks) || 1)
    // Always flush after every segment so a page refresh or crash never loses a completed segment.
    // TTS generation time per segment far exceeds the IndexedDB write cost.
    const batchSize = 1
    const batchHandler = new SegmentBatchHandler(bookId, ch.id, batchSize)

    // Skip the stored segments this chapter would be made the same way today.
    // A segment made with another voice or engine is heard as the old
    // narrator, so it is made again.
    let skipIndices: Set<number> | undefined
    if (bookId) {
      setProgress(0, textSegments.length, 'Checking for existing segments...')
      const { getChapterSegments } = await import('../libraryDB')
      const plan = { model: effectiveModel, voice: effectiveVoice }
      const stored = await getChapterSegments(bookId, ch.id)
      const existing = stored.filter((s) => !isMismatchedSegment(s, plan))
      const stale = stored.filter((s) => isMismatchedSegment(s, plan))
      if (stale.length > 0) {
        // The player must not hand out the old audio while it is made again.
        clearSegmentIndices(
          ch.id,
          stale.map((s) => s.index)
        )
      }
      if (existing.length > 0) {
        skipIndices = new Set(existing.map((s) => s.index))
        for (const seg of existing) {
          audioSegments.push({
            id: seg.id,
            chapterId: seg.chapterId,
            index: seg.index,
            text: seg.text,
            audioBlob: null as unknown as Blob,
            duration: seg.duration,
            startTime: seg.startTime,
          })
        }
        existing.length = 0
        setProgress(
          skipIndices.size,
          textSegments.length,
          `Reusing ${skipIndices.size} existing segments, generating remaining...`
        )
        logger.info(
          `[AutoResume] Skipping ${skipIndices.size} existing segments for chapter ${ch.id}`
        )
      }
    }

    initChapterSegments(ch.id, textSegments, !!skipIndices)

    const {
      failed: failedCount,
      failedIndices,
      yielded,
    } = await this.processSegmentsWithPriority(
      ch.id,
      textSegments,
      getParallelChunks,
      async (segment) => {
        if (this.canceled || this.canceledChapters.has(ch.id))
          throw new Error('Generation canceled')
        if (!segment.text.trim()) return null

        return produceSegment(
          {
            chapterId: ch.id,
            index: segment.index,
            text: segment.text,
            model: effectiveModel,
            voice: effectiveVoice,
            language: effectiveLanguage,
            quantization:
              engineCapabilities(effectiveModel).qualityLadder === 'quantization'
                ? (currentQuantization as import('../../stores/ttsStore').Quantization)
                : undefined,
            device: currentDevice as import('../../stores/ttsStore').Device,
            // Forward worker progress messages (model loading, preparing, etc.) to the UI
            onProgress: (message) =>
              setProgress(audioSegments.length, textSegments.length, message),
            persist: (segment) => batchHandler.addSegment(segment),
          },
          bookId
        )
      },
      async (produced) => {
        if (!produced) return
        audioSegments.push(produced)
        // Release blob references for segments already persisted to IndexedDB.
        // This prevents accumulating all segment blobs in memory (OOM on Android).
        batchHandler.releaseBlobs()

        // On mobile, yield to the event loop after each segment so the GC has a
        // chance to reclaim the released blob memory before the next ONNX inference
        // starts. Without this, Android's OOM killer can terminate the renderer
        // process mid-generation when memory pressure builds up across segments.
        // 500ms gives the GC enough time to reclaim memory under heavy WASM load.
        if (isMobileDevice()) {
          await new Promise((r) => setTimeout(r, 500))
        }

        if (
          this.autoPlayEnabled &&
          !this.autoPlayTriggered.has(ch.id) &&
          !this.canceled &&
          !this.canceledChapters.has(ch.id)
        ) {
          this.autoPlayTriggered.add(ch.id)
          logger.info(`[AutoPlay] Starting playback of first available segment`, {
            chapterId: ch.id,
            segmentIndex: produced.index,
          })
          setTimeout(() => {
            if (this.canceled || this.canceledChapters.has(ch.id)) {
              logger.info('[AutoPlay] Skipped — generation was canceled')
              return
            }
            audioService.playSingleSegment(produced).catch((err) => {
              logger.warn('[AutoPlay] Failed to auto-play first segment:', err)
            })
          }, 0)
        }
      },
      (completed, total) => {
        setProgress(completed, total, `Generated ${completed} of ${total} segments`)
      },
      skipIndices
    )

    await batchHandler.flush()
    // Release remaining blob references from the final flush to free memory
    batchHandler.releaseBlobs()

    // The reader's chapter waits for this one's place: keep the segments made
    // so far and finish the chapter after it.
    if (yielded) return 'yielded'

    // Surface failed segments to the user so they know the chapter is incomplete
    if (failedCount > 0) {
      const msg = `${failedCount} of ${textSegments.length} segments failed to generate`
      setProgress(
        textSegments.length - failedCount,
        textSegments.length,
        `Warning: ${msg}. You can retry with "Continue".`
      )
      logger.warn(`[generateChapterAudio] ${msg} for chapter ${ch.id}`, { failedIndices })
      toastStore.warning(`${msg} — use "Continue" to retry missing segments`)
    }

    // Fix start times (metadata only — blobs may have been released)
    audioSegments.sort((a, b) => a.index - b.index)
    let cumulativeTime = 0
    for (const s of audioSegments) {
      s.startTime = cumulativeTime
      cumulativeTime += s.duration || 0
    }

    // Persist updated startTime/duration back to DB so they survive app reload
    if (bookId) {
      setProgress(textSegments.length, textSegments.length, 'Updating segment timing...')
      const { updateSegmentStartTimes } = await import('../libraryDB')
      await updateSegmentStartTimes(
        bookId,
        ch.id,
        audioSegments.map((s) => ({ index: s.index, startTime: s.startTime, duration: s.duration }))
      )
    }

    if (this.canceled || this.canceledChapters.has(ch.id)) return 'canceled'

    markChapterGenerationComplete(ch.id)

    // 4. Skip concatenation during generation — defer to export time.
    // Concatenation loads ALL segment blobs into memory simultaneously, causing
    // OOM on long chapters (200+ segments). The segments are already persisted in
    // IndexedDB and the playback service has a working per-segment fallback path
    // that plays individual segment blobs sequentially. Concatenation is only
    // needed for export (MP3/M4B/WAV download), which happens on-demand later.
    if (bookId) {
      setProgress(textSegments.length, textSegments.length, 'Chapter complete (segments saved)')
      logger.info(
        `[OOM mitigation] Skipping concatenation for chapter ${ch.id} — segments are in IndexedDB, playback uses per-segment fallback`
      )
    } else {
      // No persistent storage — keep blobs in memory for playback
      // This path is only hit when no book ID exists (e.g., URL-imported articles)
      const { incrementalConcatWav } = await import('../wavUtils')
      setProgress(textSegments.length, textSegments.length, 'Merging audio segments...')
      const fullBlob = await incrementalConcatWav(audioSegments.length, async (index) => {
        const seg = audioSegments.find((s) => s.index === index)
        return seg?.audioBlob ?? null
      })
      generatedAudio.update((m) => {
        const newMap = new Map(m)
        if (m.has(ch.id)) URL.revokeObjectURL(m.get(ch.id)!.url)
        newMap.set(ch.id, { url: URL.createObjectURL(fullBlob), blob: fullBlob })
        return newMap
      })
    }
    // Clear audioSegments to free metadata memory before next chapter
    audioSegments.length = 0

    return 'done'
  }

  /**
   * Cancel all active generation. Resets processing chapters to 'pending' status
   * and terminates pending TTS worker tasks.
   */
  cancel() {
    this.canceled = true
    const worker = getTTSWorker()
    worker.cancelAll()

    // Reset status of processing chapters to pending so UI spinners stop
    const statusMap = get(chapterStatus)
    const newStatusMap = new Map(statusMap)
    let changed = false

    for (const [id, status] of statusMap.entries()) {
      if (status === 'processing') {
        newStatusMap.set(id, 'pending') // Reset to pending to allow retry
        changed = true
      }
    }

    if (changed) {
      chapterStatus.set(newStatusMap)
    }

    // The per-chapter "generating" flags too, or the reader keeps showing a
    // progress strip that will never move again.
    segmentProgress.update((map) => {
      const next = new Map(map)
      for (const [id, progress] of next) {
        if (progress.isGenerating) {
          next.set(id, { ...progress, isGenerating: false, processingIndex: -1 })
        }
      }
      return next
    })

    // Clear auto-play state for canceled chapters
    this.autoPlayTriggered.clear()
    this.canceledChapters.clear()
    this.queue = []
    this.currentChapterId = null
    this.yieldRequested = false

    this.setRunning(false)
    isGenerating.set(false)
  }

  /**
   * Cancel generation for a single chapter without stopping the entire batch.
   * The generation loop will skip this chapter and continue with the next one.
   */
  cancelChapter(chapterId: string) {
    this.canceledChapters.add(chapterId)
    logger.info(`[CancelChapter] Marked chapter ${chapterId} for cancellation`)

    // Reset chapter status to pending
    chapterStatus.update((m) => {
      const newMap = new Map(m)
      if (newMap.get(chapterId) === 'processing') {
        newMap.set(chapterId, 'pending')
      }
      return newMap
    })

    // Stop generation flag without clearing segment data (segments are still valid in IndexedDB)
    segmentProgress.update((map) => {
      const newMap = new Map(map)
      const progress = newMap.get(chapterId)
      if (progress) {
        newMap.set(chapterId, { ...progress, isGenerating: false, processingIndex: -1 })
      }
      return newMap
    })
  }

  /** Returns true if generation is currently in progress. */
  isRunning() {
    return this.running
  }

  /** Resolves once no generation run is in progress. */
  whenIdle(): Promise<void> {
    if (!this.running) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  /**
   * Pre-generate first chapter in the background for faster listening experience
   * This is useful for mobile users who want to start listening immediately
   *
   * @param chapters - All chapters in the book
   * @param options - Pre-generation options
   */
  async preGenerateFirstChapter(
    chapters: Chapter[],
    options: {
      /** Maximum segments to pre-generate (default: 3 for quick preview) */
      maxSegments?: number
      /** Skip if already generated */
      skipIfGenerated?: boolean
    } = {}
  ) {
    const { maxSegments = 3, skipIfGenerated = true } = options

    if (chapters.length === 0) {
      logger.info('[PreGenerate] No chapters to pre-generate')
      return
    }

    const firstChapter = chapters[0]

    // Check if chapter already has audio
    if (skipIfGenerated) {
      const currentStatus = get(chapterStatus).get(firstChapter.id)
      if (currentStatus === 'done') {
        logger.info('[PreGenerate] First chapter already generated, skipping')
        return
      }

      // Also check if any audio exists in the generated store
      const generated = get(generatedAudio)
      if (generated.has(firstChapter.id)) {
        logger.info('[PreGenerate] First chapter already has audio, skipping')
        return
      }
    }

    // Don't pre-generate if generation is already running
    if (this.running) {
      logger.info('[PreGenerate] Generation already in progress, skipping pre-generation')
      return
    }

    logger.info('[PreGenerate] Starting background pre-generation of first chapter', {
      chapterId: firstChapter.id,
      title: firstChapter.title,
      maxSegments,
    })

    // For now, we start full generation which will auto-play the first segment
    // In the future, we could add a limited-segment mode
    // Disable auto-play during pre-generation since user hasn't explicitly requested playback
    const wasAutoPlayEnabled = this.autoPlayEnabled
    this.setAutoPlay(false)

    try {
      await this.generateChapters([firstChapter])
    } catch (err) {
      logger.warn('[PreGenerate] Background pre-generation failed:', err)
    } finally {
      // Restore auto-play setting
      this.setAutoPlay(wasAutoPlayEnabled)
    }
  }

  async exportEpub(chapters: Chapter[], bookInfo: { title: string; author: string; cover?: Blob }) {
    return exportEpub(chapters, bookInfo)
  }
}

export const generationService = new GenerationService()

/** Reactive store reflecting whether generation is currently running */
export const isGeneratingStore = writable(false)
