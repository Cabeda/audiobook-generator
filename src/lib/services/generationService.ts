import { get } from 'svelte/store'
import type { Chapter } from '../types/book'
import type { VoiceId } from '../kokoro/kokoroVoices'
import { getTTSWorker } from '../ttsWorkerManager'
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
import { listVoices as listKokoroVoices } from '../kokoro/kokoroVoices'
import { concatenateAudioChapters, type AudioChapter } from '../audioConcat'
import logger from '../utils/logger'
import { toastStore } from '../../stores/toastStore'
import { appSettings } from '../../stores/appSettingsStore'
import { getChapterSegments, type LibraryBook } from '../libraryDB'
import type { AudioSegment } from '../types/audio'
import { resolveChapterLanguageWithDetection, DEFAULT_LANGUAGE } from '../utils/languageResolver'
import { isMobileDevice } from '../utils/mobileDetect'
import { audioService } from '../audioPlaybackService.svelte'

import {
  selectKokoroVoiceForLanguage,
  selectPiperVoiceForLanguage,
  isKokoroLanguageSupported,
  normalizeLanguageCode,
} from '../utils/voiceSelector'
import {
  initChapterSegments,
  markChapterGenerationComplete,
  setProcessingIndex,
} from '../../stores/segmentProgressStore'
import { createThrottledMapUpdater } from '../../stores/batchedStoreUpdates'

// Extracted modules
import { parseWavDuration } from './wavParser'
import { segmentHtmlContent } from './segmentationService'
import type { SegmentOptions } from './segmentationService'
import { SegmentBatchHandler } from './segmentBatchHandler'
import { exportAudio, exportEpub } from './exportService'

// Re-export extracted modules for backward compatibility
export { segmentHtmlContent, parseWavDuration }
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

class GenerationService {
  private running = false
  private canceled = false
  private canceledChapters = new Set<string>()

  private wakeLock: WakeLockSentinel | null = null
  private priorityOverrides = new Map<string, number>()

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
  ): Promise<{ failed: number; failedIndices: number[] }> {
    const total = segments.length
    const processed = new Set<number>(skipIndices)
    const failed = new Set<number>()
    let cursor = 0 // Start at beginning

    // Main loop: Continue until all segments are processed or canceled
    while (processed.size + failed.size < total && !this.canceled) {
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
    return { failed: failed.size, failedIndices }
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
      logger.warn('Generation already running')
      toastStore.warning('Generation is already running')
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
        id: `${chapter.id}-seg-${i}`,
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

  async generateChapters(chapters: Chapter[], explicitBookId?: number) {
    logger.info('[generateChapters] Starting generation', {
      chapterCount: chapters.length,
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

    this.running = true
    this.canceled = false // Reset canceled state
    this.canceledChapters.clear() // Reset per-chapter cancellation
    this.autoPlayTriggered.clear() // Reset auto-play triggers for new generation
    isGenerating.set(true)

    // Acquire wake lock to prevent device sleep
    await this.requestWakeLock()
    document.addEventListener('visibilitychange', this.handleVisibilityChange)

    // Start silent audio to prevent CPU throttling in background
    await this.startSilentAudio()

    getTTSWorker()
    const totalChapters = chapters.length

    try {
      for (let i = 0; i < totalChapters; i++) {
        if (this.canceled) break

        const ch = chapters[i]

        // Skip chapters that were individually canceled
        if (this.canceledChapters.has(ch.id)) {
          logger.info(`[generateChapters] Skipping canceled chapter ${ch.id}`)
          continue
        }

        const currentBook = get(book)

        // Resolve the effective language for this chapter (with auto-detection support)
        const effectiveLanguage = currentBook
          ? resolveChapterLanguageWithDetection(ch, currentBook)
          : DEFAULT_LANGUAGE

        // Check app-level per-language defaults (priority: chapter > app language defaults > global)
        const langDefaults = appSettings.getLanguageDefault(get(appSettings), effectiveLanguage)

        // Resolve model: chapter override > app language default > global selected model
        // Fallback: If current model doesn't support the language, try to switch
        let effectiveModel = ch.model || langDefaults?.model || model
        let isFallbackModel = false

        if (effectiveModel === 'kokoro' && !isKokoroLanguageSupported(effectiveLanguage)) {
          logger.warn(
            `Language '${effectiveLanguage}' not supported by Kokoro. Switching to Piper for chapter ${ch.id}`
          )
          effectiveModel = 'piper'
          isFallbackModel = true
        }

        const currentVoice = ch.voice || langDefaults?.voice || get(selectedVoice)
        // Cap quantization to q4 on mobile to avoid loading a ~100MB q8 model
        const currentQuantization = isMobileDevice() ? 'q4' : get(selectedQuantization)
        const currentDevice = get(selectedDevice)
        const currentAdvancedSettings = get(advancedSettings)[effectiveModel] || {}

        // Validate content — skip empty chapters gracefully without an error
        if (!ch.content || !ch.content.trim()) {
          logger.info(`[Generation] Skipping empty chapter: ${ch.title} (${ch.id})`)
          chapterStatus.update((m) => new Map(m).set(ch.id, 'done'))
          chapterErrors.update((m) => {
            const newMap = new Map(m)
            newMap.delete(ch.id)
            return newMap
          })
          continue
        }

        // Update status to processing
        chapterStatus.update((m) => new Map(m).set(ch.id, 'processing'))

        const effectiveVoice = await this.resolveEffectiveVoice(
          ch,
          effectiveModel,
          effectiveLanguage,
          isFallbackModel,
          currentVoice
        )

        try {
          const bookId = explicitBookId ?? getBookId()
          const canceled = await this.generateChapterAudio(
            ch,
            effectiveModel,
            effectiveVoice,
            effectiveLanguage,
            currentQuantization,
            currentDevice,
            currentAdvancedSettings,
            bookId
          )
          if (canceled) break

          // Flush any pending throttled progress updates before marking done
          throttledProgress.flush()
          chapterStatus.update((m) => new Map(m).set(ch.id, 'done'))
          chapterErrors.update((m) => {
            const newMap = new Map(m)
            newMap.delete(ch.id)
            return newMap
          })

          // On mobile, restart the TTS worker between chapters to reclaim WASM heap
          // memory. The ONNX runtime's WASM heap grows with each inference and never
          // shrinks — restarting the worker is the only way to release it. The model
          // will be re-loaded on the next chapter's first segment (~2-3s overhead),
          // but this prevents cumulative memory growth from crashing the renderer.
          if (isMobileDevice()) {
            logger.info(
              `[Mobile OOM mitigation] Restarting TTS worker between chapters to reclaim WASM heap`
            )
            const worker = getTTSWorker()
            worker.terminate()
            // Yield to let the terminated worker's memory be reclaimed
            await new Promise((r) => setTimeout(r, 1000))
          }
        } catch (err: unknown) {
          if (this.canceled) break
          if (this.canceledChapters.has(ch.id)) continue
          const errorMsg = err instanceof Error ? err.message : 'Unknown error'
          logger.error(`Generation failed for chapter ${ch.title}:`, err)
          chapterStatus.update((m) => new Map(m).set(ch.id, 'error'))
          chapterErrors.update((m) => new Map(m).set(ch.id, errorMsg))
        }
      }
    } finally {
      throttledProgress.flush()
      this.running = false
      isGenerating.set(false)

      // Clean up silent audio
      await this.stopSilentAudio()

      // Clean up wake lock and listener
      document.removeEventListener('visibilitychange', this.handleVisibilityChange)
      await this.releaseWakeLock()
    }
  }

  /**
   * Resume generation for chapters that were partially generated.
   * Already-generated segments are loaded from DB and skipped; only missing
   * segments are synthesised, then the chapter audio is re-concatenated.
   */
  async resumeChapters(chapters: Chapter[], explicitBookId?: number) {
    if (this.running) {
      logger.warn('Generation already running')
      return
    }
    // Delegate to generateChapters but mark each chapter for resume inside the loop.
    // We do this by temporarily tagging chapters so generateChapterAudio knows.
    // Simplest approach: run the same loop as generateChapters with resume=true.
    const model = get(selectedModel)
    this.running = true
    this.canceled = false
    this.canceledChapters.clear()
    this.autoPlayTriggered.clear()
    isGenerating.set(true)

    await this.requestWakeLock()
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
    await this.startSilentAudio()
    getTTSWorker()

    try {
      for (const ch of chapters) {
        if (this.canceled) break
        if (this.canceledChapters.has(ch.id)) continue

        const currentBook = get(book)
        const effectiveLanguage = currentBook
          ? resolveChapterLanguageWithDetection(ch, currentBook)
          : DEFAULT_LANGUAGE
        const langDefaults = appSettings.getLanguageDefault(get(appSettings), effectiveLanguage)
        let effectiveModel = ch.model || langDefaults?.model || model
        if (effectiveModel === 'kokoro' && !isKokoroLanguageSupported(effectiveLanguage)) {
          effectiveModel = 'piper'
        }
        const currentVoice = ch.voice || langDefaults?.voice || get(selectedVoice)
        const currentQuantization = isMobileDevice() ? 'q4' : get(selectedQuantization)
        const currentDevice = get(selectedDevice)
        const currentAdvancedSettings = get(advancedSettings)[effectiveModel] || {}

        if (!ch.content || !ch.content.trim()) continue

        chapterStatus.update((m) => new Map(m).set(ch.id, 'processing'))

        const effectiveVoice = await this.resolveEffectiveVoice(
          ch,
          effectiveModel,
          effectiveLanguage,
          false,
          currentVoice
        )

        try {
          const bookId = explicitBookId ?? getBookId()
          const canceled = await this.generateChapterAudio(
            ch,
            effectiveModel,
            effectiveVoice,
            effectiveLanguage,
            currentQuantization,
            currentDevice,
            currentAdvancedSettings,
            bookId,
            true // resume = true
          )
          if (canceled) break

          throttledProgress.flush()
          chapterStatus.update((m) => new Map(m).set(ch.id, 'done'))
          chapterErrors.update((m) => {
            const newMap = new Map(m)
            newMap.delete(ch.id)
            return newMap
          })

          // On mobile, restart the TTS worker between chapters to reclaim WASM heap
          if (isMobileDevice()) {
            logger.info(
              `[Mobile OOM mitigation] Restarting TTS worker between chapters to reclaim WASM heap`
            )
            const worker = getTTSWorker()
            worker.terminate()
            await new Promise((r) => setTimeout(r, 1000))
          }
        } catch (err: unknown) {
          if (this.canceled) break
          if (this.canceledChapters.has(ch.id)) continue
          const errorMsg = err instanceof Error ? err.message : 'Unknown error'
          logger.error(`Resume failed for chapter ${ch.title}:`, err)
          chapterStatus.update((m) => new Map(m).set(ch.id, 'error'))
          chapterErrors.update((m) => new Map(m).set(ch.id, errorMsg))
        }
      }
    } finally {
      throttledProgress.flush()
      this.running = false
      isGenerating.set(false)
      await this.stopSilentAudio()
      document.removeEventListener('visibilitychange', this.handleVisibilityChange)
      await this.releaseWakeLock()
    }
  }

  /**
   * Resolve the effective voice for a chapter, auto-selecting when needed.
   */
  private async resolveEffectiveVoice(
    ch: Chapter,
    effectiveModel: string,
    effectiveLanguage: string,
    isFallbackModel: boolean,
    currentVoice: string
  ): Promise<string> {
    let effectiveVoice = currentVoice

    let shouldAutoSelectVoice = !currentVoice
    if (!shouldAutoSelectVoice && isFallbackModel) {
      if (effectiveModel === 'piper') {
        const { PiperClient } = await import('../piper/piperClient')
        const voices = await PiperClient.getInstance().getVoices()
        shouldAutoSelectVoice = !voices.some((v: { key: string }) => v.key === currentVoice)
      } else {
        shouldAutoSelectVoice = true
      }
    }

    if (shouldAutoSelectVoice) {
      const preferredVoice = isFallbackModel ? undefined : currentVoice
      if (effectiveModel === 'kokoro') {
        effectiveVoice = selectKokoroVoiceForLanguage(effectiveLanguage, preferredVoice)
        const kokoroVoices = listKokoroVoices()
        if (!kokoroVoices.includes(effectiveVoice as VoiceId)) {
          logger.warn(`Invalid Kokoro voice '${effectiveVoice}', falling back to af_heart`)
          effectiveVoice = 'af_heart'
        }
        logger.info(
          `Auto-selected Kokoro voice for language ${effectiveLanguage}: ${effectiveVoice}`
        )
      } else if (effectiveModel === 'piper') {
        const { PiperClient } = await import('../piper/piperClient')
        const availableVoices = await PiperClient.getInstance().getVoices()
        effectiveVoice = selectPiperVoiceForLanguage(
          effectiveLanguage,
          availableVoices,
          preferredVoice
        )
        logger.info(
          `Auto-selected Piper voice for language ${effectiveLanguage}: ${effectiveVoice}`
        )
      }
    } else {
      logger.info(`Using chapter-specific voice: ${effectiveVoice}`)
    }

    // If a global Piper voice doesn't match the chapter language, auto-switch.
    // Skip when the user explicitly set a chapter voice.
    if (effectiveModel === 'piper' && !shouldAutoSelectVoice && !ch.voice) {
      const { PiperClient } = await import('../piper/piperClient')
      const availableVoices = await PiperClient.getInstance().getVoices()
      const selectedVoiceInfo = availableVoices.find(
        (v: { key: string }) => v.key === effectiveVoice
      )
      const voiceLang = selectedVoiceInfo ? normalizeLanguageCode(selectedVoiceInfo.language) : null
      if (!selectedVoiceInfo || voiceLang !== normalizeLanguageCode(effectiveLanguage)) {
        logger.warn(
          `Piper voice '${effectiveVoice}' mismatches language '${effectiveLanguage}', auto-switching`
        )
        effectiveVoice = selectPiperVoiceForLanguage(effectiveLanguage, availableVoices, undefined)
        logger.info(
          `Switched Piper voice to '${effectiveVoice}' for language '${effectiveLanguage}'`
        )
      }
    }

    return effectiveVoice
  }

  /**
   * Segment, generate, and persist audio for a single chapter.
   * Returns true if generation was canceled mid-way.
   */
  private async generateChapterAudio(
    ch: Chapter,
    effectiveModel: string,
    effectiveVoice: string,
    effectiveLanguage: string,
    currentQuantization: string,
    currentDevice: string,
    currentAdvancedSettings: Record<string, unknown>,
    bookId: number,
    resume = false
  ): Promise<boolean> {
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
      chapterStatus.update((m) => new Map(m).set(ch.id, 'done'))
      chapterErrors.update((m) => {
        const newMap = new Map(m)
        newMap.delete(ch.id)
        return newMap
      })
      return false
    }

    // 2. Persist segmented HTML
    if (bookId) {
      const { updateChapterContent } = await import('../libraryDB')
      await updateChapterContent(bookId, ch.id, html)
    }

    initChapterSegments(ch.id, textSegments, resume)

    // Helper to update the chapter progress message in the UI
    const setProgress = (current: number, total: number, message: string) => {
      throttledProgress.set(ch.id, { current, total, message })
    }

    setProgress(0, textSegments.length, 'Initializing generation...')

    // 3. Generate audio per segment
    const audioSegments: AudioSegment[] = []
    const worker = getTTSWorker()
    const getParallelChunks = () =>
      Math.max(1, Number(get(advancedSettings)[effectiveModel]?.parallelChunks) || 1)
    // Always flush after every segment so a page refresh or crash never loses a completed segment.
    // TTS generation time per segment far exceeds the IndexedDB write cost.
    const batchSize = 1
    const batchHandler = new SegmentBatchHandler(bookId, ch.id, batchSize)

    // When resuming, load already-generated segments from DB and skip them.
    // When starting fresh, delete any stale segments from a previous interrupted run.
    let skipIndices: Set<number> | undefined
    if (resume && bookId) {
      setProgress(0, textSegments.length, 'Loading previously generated segments...')
      const { getChapterSegments } = await import('../libraryDB')
      const existing = await getChapterSegments(bookId, ch.id)
      if (existing.length > 0) {
        skipIndices = new Set(existing.map((s) => s.index))
        // On mobile, only keep lightweight metadata — release blob references immediately
        // to avoid loading all previously-generated audio blobs into memory at once.
        for (const seg of existing) {
          audioSegments.push({
            id: seg.id,
            chapterId: seg.chapterId,
            index: seg.index,
            text: seg.text,
            audioBlob: null as unknown as Blob, // blob is safely in IndexedDB
            duration: seg.duration,
            startTime: seg.startTime,
          })
        }
        // Let GC reclaim the existing array and its blob references
        existing.length = 0
        setProgress(
          skipIndices.size,
          textSegments.length,
          `Resuming from segment ${skipIndices.size + 1}/${textSegments.length}...`
        )
        logger.info(
          `[Resume] Skipping ${skipIndices.size} already-generated segments for chapter ${ch.id}`
        )
      }
    } else if (bookId) {
      const { deleteChapterSegments } = await import('../libraryDB')
      await deleteChapterSegments(bookId, ch.id)
    }

    const { failed: failedCount, failedIndices } = await this.processSegmentsWithPriority(
      ch.id,
      textSegments,
      getParallelChunks,
      async (segment) => {
        if (this.canceled || this.canceledChapters.has(ch.id))
          throw new Error('Generation canceled')
        if (!segment.text.trim()) return null

        const blob = await worker.generateVoice({
          text: segment.text,
          modelType: effectiveModel as import('../tts/ttsModels').TTSModelType,
          voice: effectiveVoice,
          dtype:
            effectiveModel === 'kokoro'
              ? (currentQuantization as import('../../stores/ttsStore').Quantization)
              : undefined,
          device: currentDevice as import('../../stores/ttsStore').Device,
          language: effectiveLanguage,
          advancedSettings: currentAdvancedSettings,
          // Forward worker progress messages (model loading, preparing, etc.) to the UI
          onProgress: (message) => {
            const completed = audioSegments.length
            setProgress(completed, textSegments.length, message)
          },
        })

        return { segment, blob, duration: await parseWavDuration(blob) }
      },
      async (result) => {
        if (!result) return
        const segment: AudioSegment = {
          id: result.segment.id,
          chapterId: ch.id,
          index: result.segment.index,
          text: result.segment.text,
          audioBlob: result.blob as Blob,
          duration: result.duration,
          startTime: 0,
        }
        audioSegments.push(segment)
        await batchHandler.addSegment(segment)
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
            segmentIndex: segment.index,
          })
          setTimeout(() => {
            if (this.canceled || this.canceledChapters.has(ch.id)) {
              logger.info('[AutoPlay] Skipped — generation was canceled')
              return
            }
            audioService.playSingleSegment(segment).catch((err) => {
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

    if (this.canceled || this.canceledChapters.has(ch.id)) return true

    markChapterGenerationComplete(ch.id)

    // 4. Concatenate and persist merged audio
    // On mobile, SKIP concatenation entirely to avoid OOM. The segments are already
    // persisted in IndexedDB and the playback path has a working fallback that plays
    // from per-segment blob URLs. Concatenation is only needed for download, which
    // can be done on-demand later. This eliminates the memory spike from holding all
    // segment data in the `parts` array during `incrementalConcatWav`.
    if (isMobileDevice() && bookId) {
      logger.info(
        `[Mobile OOM mitigation] Skipping concatenation for chapter ${ch.id} — segments are in IndexedDB, playback uses per-segment fallback`
      )
      setProgress(textSegments.length, textSegments.length, 'Chapter complete (segments saved)')
      // Clear audioSegments to free metadata memory before next chapter
      audioSegments.length = 0
    } else {
      // Desktop path: concatenate segments into a single blob for smooth seeking
      // Re-read segments from IndexedDB to avoid holding all blobs in memory simultaneously.
      // The in-memory audioSegments array has had its blobs released after each batch flush.
      setProgress(textSegments.length, textSegments.length, 'Loading segments for merge...')
      let concatSegments: AudioSegment[]
      if (bookId) {
        concatSegments = await getChapterSegments(bookId, ch.id)
      } else {
        // No persistent storage — blobs are still in memory (releaseBlobs is a no-op without bookId)
        concatSegments = audioSegments
      }
      setProgress(textSegments.length, textSegments.length, 'Merging audio segments...')
      const audioChapters: AudioChapter[] = concatSegments.map((s) => ({
        id: s.id,
        title: `Segment ${s.index}`,
        blob: s.audioBlob,
      }))
      const fullBlob = await concatenateAudioChapters(audioChapters, { format: 'wav' })
      // Release concat segments from memory immediately after concatenation
      concatSegments.length = 0

      if (bookId) {
        setProgress(textSegments.length, textSegments.length, 'Saving chapter audio...')
        const { saveChapterAudio } = await import('../libraryDB')
        await saveChapterAudio(bookId, ch.id, fullBlob, {
          model: effectiveModel,
          voice: effectiveVoice,
          quantization: currentQuantization,
          device: currentDevice,
          language: effectiveLanguage,
        })
      }

      generatedAudio.update((m) => {
        const newMap = new Map(m)
        if (m.has(ch.id)) URL.revokeObjectURL(m.get(ch.id)!.url)
        newMap.set(ch.id, { url: URL.createObjectURL(fullBlob), blob: fullBlob })
        return newMap
      })
    }

    return false
  }

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

    // Clear auto-play state for canceled chapters
    this.autoPlayTriggered.clear()
    this.canceledChapters.clear()

    this.running = false
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

    // Mark generation as no longer in progress for this chapter
    markChapterGenerationComplete(chapterId)
  }

  isRunning() {
    return this.running
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

  async exportAudio(
    chapters: Chapter[],
    format: 'mp3' | 'm4b' | 'wav' = 'mp3',
    bitrate = 192,
    bookInfo: { title: string; author: string }
  ) {
    return exportAudio(chapters, format, bitrate, bookInfo)
  }

  async exportEpub(chapters: Chapter[], bookInfo: { title: string; author: string; cover?: Blob }) {
    return exportEpub(chapters, bookInfo)
  }
}

export const generationService = new GenerationService()
