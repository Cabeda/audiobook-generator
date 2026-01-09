import { getTTSWorker } from './ttsWorkerManager'
import logger from './utils/logger'
import { audioPlayerStore } from '../stores/audioPlayerStore'
import type { Chapter } from './types/book'
import { getChapterSegments, getChapterAudio } from './libraryDB'
import { segmentHtmlContent } from './services/generationService'
import { getGeneratedSegment } from '../stores/segmentProgressStore'
import type { AudioSegment } from './types/audio'

interface TextSegment {
  index: number
  text: string
  duration?: number
  startTime?: number
}

class AudioPlaybackService {
  // State
  isPlaying = $state(false)
  currentSegmentIndex = $state(-1)
  currentTime = $state(0)
  duration = $state(0)
  segments = $state<TextSegment[]>([])

  // Audio & Data
  private audio: HTMLAudioElement | null = null
  private speechUtterance: SpeechSynthesisUtterance | null = null
  // private segments: TextSegment[] = [] // Moved to state public property
  private audioSegments = new Map<number, string>() // index -> blob URL
  private segmentDurations = new Map<number, number>() // index -> seconds
  private wordsPerSegment: number[] = []
  private totalWords = 0
  private wordsMeasured = 0
  private pendingGenerations = new Map<number, Promise<void>>()
  private bufferTarget = 5
  private chapterAudioUrl: string | null = null // Track chapter audio URL for cleanup
  private currentChapterId: string | null = null // Track current chapter ID for progressive playback

  // Configuration
  private voice = ''
  private quantization: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16' = 'q8'
  private device: 'auto' | 'wasm' | 'webgpu' | 'cpu' = 'auto'
  private selectedModel: 'kokoro' | 'piper' = 'kokoro'
  playbackSpeed = $state(1.0)

  constructor() {
    // Sync state to store periodically or on change
    $effect.root(() => {
      $effect(() => {
        // Update store when key state changes
        if (this.currentSegmentIndex >= 0) {
          audioPlayerStore.updatePosition(this.currentSegmentIndex, this.currentTime, this.duration)
        }
      })

      $effect(() => {
        if (this.isPlaying) {
          audioPlayerStore.play()
        } else {
          audioPlayerStore.pause()
        }
      })
    })
  }

  // Initialize with a chapter
  async initialize(
    bookId: number | null,
    bookTitle: string,
    chapter: Chapter,
    settings: {
      voice: string
      quantization: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
      device?: 'auto' | 'wasm' | 'webgpu' | 'cpu'
      selectedModel?: 'kokoro' | 'piper'
      playbackSpeed?: number
    },
    options?: {
      startSegmentIndex?: number
      startTime?: number
      startPlaying?: boolean
      startMinimized?: boolean
    }
  ) {
    this.stop() // Stop previous playback
    this.currentChapterId = chapter.id

    this.voice = settings.voice
    this.quantization = settings.quantization
    this.device = settings.device || 'auto'
    this.selectedModel = settings.selectedModel || 'kokoro'
    this.playbackSpeed = settings.playbackSpeed || 1.0

    // Check for existing segments in DB
    let dbSegments: AudioSegment[] = []
    if (bookId) {
      try {
        dbSegments = await getChapterSegments(bookId, chapter.id)
      } catch (e) {
        logger.warn('Failed to load segments from DB', e)
      }
    }

    if (dbSegments.length > 0) {
      logger.info(`Loaded ${dbSegments.length} segments from DB for chapter ${chapter.id}`)
      this.segments = dbSegments.map((s) => ({ index: s.index, text: s.text }))

      // Hydrate audio map
      for (const s of dbSegments) {
        this.audioSegments.set(s.index, URL.createObjectURL(s.audioBlob))
        // We'll lazy load durations as we play or if we walk them
      }
    } else {
      // Fallback to local splitting logic
      this.segments = this.splitIntoSegments(chapter.content)
    }

    // Compute words per segment & estimated chapter duration
    this.wordsPerSegment = this.segments.map(
      (s) => s.text.trim().split(/\s+/).filter(Boolean).length
    )
    this.totalWords = this.wordsPerSegment.reduce((a, b) => a + b, 0)
    // ... rest of init logic (reset state, store init)

    this.wordsMeasured = 0
    this.segmentDurations.clear()

    // Heuristic words per minute for speech (adjustable/tunable)
    const WORDS_PER_MINUTE = 160
    const wordsPerSecond = WORDS_PER_MINUTE / 60
    const estimateSeconds = this.totalWords / (wordsPerSecond || 1)
    audioPlayerStore.setChapterDuration(estimateSeconds)

    this.currentSegmentIndex = 0
    this.currentTime = 0
    // If restore options provided, override
    if (options?.startSegmentIndex !== undefined && options?.startTime !== undefined) {
      this.currentSegmentIndex = options.startSegmentIndex
      this.currentTime = options.startTime
    }
    this.duration = 0
    this.isPlaying = false

    // Setup Media Session
    this.setupMediaSession(chapter.title, bookTitle)

    // Initialize store
    audioPlayerStore.startPlayback(
      bookId,
      bookTitle,
      chapter,
      settings,
      options?.startPlaying ?? true,
      options?.startMinimized ?? false
    )

    // If we have a starting segment index, ensure it's generated (if not already loaded) and create audio element
    if (options?.startSegmentIndex !== undefined) {
      const index = options.startSegmentIndex

      // Generate segment in background if needed (already loaded if from DB)
      if (!this.audioSegments.has(index)) {
        this.generateSegment(index).catch((e) =>
          logger.debug('Failed to generate initial segment:', e)
        )
      }

      // Prepare audio element but do not play
      const prepareAudio = async () => {
        try {
          // We need to wait for the segment to be available
          if (!this.audioSegments.has(index)) {
            await this.generateSegment(index)
          }
          const url = this.audioSegments.get(index)
          if (!url) return
          if (this.audio) {
            this.audio.pause()
            this.audio.src = ''
            this.audio = null
          }
          this.audio = new Audio(url)
          this.audio.playbackRate = this.playbackSpeed
          this.audio.onloadedmetadata = () => {
            if (this.audio && options.startTime !== undefined) {
              try {
                // Some browsers require setting currentTime after metadata
                this.audio.currentTime = options.startTime as number
              } catch (e) {
                logger.debug('Failed to set currentTime on restore', e)
              }
            }
            if (this.audio) this.duration = this.audio.duration
          }
          this.audio.ontimeupdate = () => {
            if (this.audio) this.currentTime = this.audio.currentTime
          }
          this.audio.onended = () => {
            // No-op: we don't auto-play here
          }
        } catch (err) {
          logger.debug('Failed to prepare audio for restore', err)
        }
      }
      void prepareAudio()
    }
  }

  private splitIntoSegments(html: string): TextSegment[] {
    // Use the same segmentation as highlighting for perfect sync
    const { segments } = segmentHtmlContent('audio-playback', html)
    return segments.map((s: { index: number; text: string }) => ({ index: s.index, text: s.text }))
  }

  private async getDurationFromUrl(url: string): Promise<number> {
    return new Promise((resolve) => {
      try {
        const a = new Audio(url)
        a.onloadedmetadata = () => {
          const dur = a.duration || 0
          a.pause()
          a.src = ''
          resolve(dur)
        }
        a.onerror = () => {
          resolve(0)
        }
      } catch {
        resolve(0)
      }
    })
  }

  /**
   * Load a pre-generated chapter for pure playback.
   * This method uses stored segments with timing data and a single concatenated audio file.
   * No on-demand generation is performed.
   */
  async loadChapter(
    bookId: number,
    bookTitle: string,
    chapter: Chapter,
    settings?: {
      voice?: string
      quantization?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
      device?: 'auto' | 'wasm' | 'webgpu' | 'cpu'
      selectedModel?: 'kokoro' | 'piper'
      playbackSpeed?: number
    }
  ): Promise<{ success: boolean; hasAudio: boolean }> {
    this.stop()
    this.currentChapterId = chapter.id

    if (settings) {
      this.voice = settings.voice || this.voice
      this.quantization = settings.quantization || this.quantization
      this.device = settings.device || this.device
      this.selectedModel = settings.selectedModel || this.selectedModel
      this.playbackSpeed = settings.playbackSpeed || this.playbackSpeed
    }

    // Load segments with timing data
    let dbSegments: AudioSegment[] = []
    try {
      dbSegments = await getChapterSegments(bookId, chapter.id)
    } catch (e) {
      logger.warn('Failed to load segments from DB', e)
    }

    // Load merged audio if available
    let chapterAudioBlob: Blob | null = null
    try {
      chapterAudioBlob = await getChapterAudio(bookId, chapter.id)
    } catch (e) {
      logger.warn('Failed to load chapter audio from DB', e)
    }

    const hasAudio = !!chapterAudioBlob || dbSegments.length > 0

    if (dbSegments.length === 0) {
      // If no segments in DB, but we allow on-the-fly for Web Speech or fallback
      logger.info('No segments found in DB for chapter', chapter.id)
      // Fallback: split on fly
      this.segments = this.splitIntoSegments(chapter.content)
    } else {
      this.segments = dbSegments.map((s) => ({
        index: s.index,
        text: s.text,
        duration: s.duration,
        startTime: s.startTime,
      }))

      // Hydrate per-segment audio URLs (only if we have them)
      this.audioSegments.clear()
      for (const s of dbSegments) {
        this.audioSegments.set(s.index, URL.createObjectURL(s.audioBlob))
      }
    }

    // Calculate total duration
    let totalDuration = 0
    if (this.segments.length > 0) {
      const lastSeg = this.segments[this.segments.length - 1]
      if (lastSeg.startTime !== undefined && lastSeg.duration !== undefined) {
        totalDuration = (lastSeg.startTime || 0) + (lastSeg.duration || 0)
      } else if (dbSegments.length > 0) {
        // Fallback duration calculation
        totalDuration = dbSegments.reduce((acc, seg) => {
          const est = (seg.audioBlob.size - 44) / (24000 * 4) // Estimate
          return acc + Math.max(est, 0)
        }, 0)
      }
    }

    audioPlayerStore.setChapterDuration(totalDuration)
    this.duration = totalDuration

    // Set up Audio Player if we have a merged blob
    if (chapterAudioBlob) {
      // Preferred path: play from merged audio for smooth seeking
      const chapterAudioUrl = URL.createObjectURL(chapterAudioBlob)
      this.chapterAudioUrl = chapterAudioUrl // Store for cleanup
      this.audio = new Audio(chapterAudioUrl)
      this.audio.playbackRate = this.playbackSpeed

      // Set up time-based segment tracking
      this.audio.ontimeupdate = () => {
        if (!this.audio) return
        this.currentTime = this.audio.currentTime

        const seg = this.segments.find(
          (s) =>
            s.startTime !== undefined &&
            s.duration !== undefined &&
            this.audio!.currentTime >= s.startTime &&
            this.audio!.currentTime < s.startTime + s.duration
        )
        if (seg && seg.index !== this.currentSegmentIndex) {
          this.currentSegmentIndex = seg.index
        }
      }

      this.audio.onended = () => {
        this.isPlaying = false
        audioPlayerStore.pause()
      }

      this.audio.onerror = (e) => {
        logger.error('Chapter audio playback error:', e)
        this.isPlaying = false
        audioPlayerStore.pause()
      }

      logger.info(
        `Loaded chapter ${chapter.id} with ${dbSegments.length} segments and merged audio for pure playback`
      )
    } else {
      // Fallback: no merged audio; use per-segment blobs
      this.audio = null
      logger.info(
        `Loaded chapter ${chapter.id} with ${dbSegments.length} segments (no merged audio found, using segment playback)`
      )
    }

    this.currentSegmentIndex = 0
    this.currentTime = 0

    // Setup Media Session
    this.setupMediaSession(chapter.title, bookTitle)

    // Initialize store
    audioPlayerStore.startPlayback(
      bookId,
      bookTitle,
      chapter,
      {
        voice: settings?.voice ?? '',
        quantization: settings?.quantization ?? 'q8',
      },
      false,
      false
    )

    return { success: true, hasAudio }
  }

  // Playback Control
  async play() {
    if (this.isPlaying) return

    // If audio element exists (loaded by loadChapter or other means), play it directly
    if (this.audio) {
      this.isPlaying = true
      audioPlayerStore.play()
      try {
        await this.audio.play()
      } catch (e) {
        logger.error('Failed to play audio:', e)
        this.isPlaying = false
        audioPlayerStore.pause()
      }
      this.updateMediaSessionState()
      return
    }

    // Fallback: try to play from first segment (legacy on-demand mode)
    if (this.currentSegmentIndex >= 0) {
      this.isPlaying = true
      audioPlayerStore.play()
      await this.playCurrentSegment()
    } else {
      await this.playFromSegment(0)
    }
  }

  pause() {
    this.isPlaying = false
    audioPlayerStore.pause()
    this.updateMediaSessionState()

    if (this.audio) {
      this.audio.pause()
    }
    // Note: We intentionally do NOT call worker.cancelAll() here anymore
    // because that would cancel ongoing chapter generation from generationService.
    // The audioPlaybackService only handles playback, not generation.
    // Clear pending generation queue to avoid stale buffering state
    this.pendingGenerations.clear()
    audioPlayerStore.setBuffering(false)
  }

  togglePlayPause() {
    if (this.isPlaying) this.pause()
    else this.play()
  }

  async playFromSegment(index: number, autoPlay = true) {
    if (index < 0 || index >= this.segments.length) return

    const segment = this.segments[index]

    // If audio was loaded via loadChapter (single audio file with timing data), seek to segment position
    if (this.audio && segment && segment.startTime !== undefined) {
      this.currentSegmentIndex = index
      this.audio.currentTime = segment.startTime

      if (!this.isPlaying && autoPlay) {
        this.isPlaying = true
        audioPlayerStore.play()
        try {
          await this.audio.play()
        } catch (e) {
          logger.error('Failed to play from segment:', e)
          this.isPlaying = false
          audioPlayerStore.pause()
        }
      } else if (!autoPlay && this.audio) {
        // Ensure we seek but don't play
        this.audio.currentTime = segment.startTime
      }
      return
    }

    // Legacy on-demand generation mode
    const wasPlaying = this.isPlaying || autoPlay

    // Stop current audio completely to prevent race condition
    if (this.audio) {
      this.audio.pause()
      this.audio.onended = null
      this.audio.ontimeupdate = null
      this.audio.onerror = null
      this.audio.onloadedmetadata = null
      this.audio.src = ''
      this.audio = null
    }

    this.cancelWebSpeech()

    // Clear only this service's pending generations, not the global worker
    // This prevents canceling ongoing chapter generation from generationService
    this.pendingGenerations.clear()

    this.currentSegmentIndex = index
    this.isPlaying = wasPlaying
    if (wasPlaying) {
      audioPlayerStore.play()
    } else {
      audioPlayerStore.pause()
    }

    // Ensure generated
    if (!this.audioSegments.has(index)) {
      if (index === this.currentSegmentIndex) audioPlayerStore.setBuffering(true)
      try {
        await this.generateSegment(index)
      } catch (err) {
        logger.error('Failed to generate segment:', err)
        if (this.currentSegmentIndex === index) {
          this.isPlaying = false
          audioPlayerStore.pause()
        }
        if (index === this.currentSegmentIndex) audioPlayerStore.setBuffering(false)
        return
      }
      if (index === this.currentSegmentIndex) audioPlayerStore.setBuffering(false)
    }

    if (this.currentSegmentIndex !== index) return

    this.bufferSegments(index + 1, this.bufferTarget).catch((err) =>
      logger.error('[AudioPlayback]', err)
    )

    if (this.isPlaying) {
      await this.playCurrentSegment()
    }
  }

  async skipNext() {
    if (this.currentSegmentIndex < this.segments.length - 1) {
      await this.playFromSegment(this.currentSegmentIndex + 1, this.isPlaying)
    }
  }

  async skipPrevious() {
    if (this.currentSegmentIndex > 0) {
      await this.playFromSegment(this.currentSegmentIndex - 1, this.isPlaying)
    }
  }

  setSpeed(speed: number) {
    this.playbackSpeed = speed
    if (this.audio) {
      this.audio.playbackRate = speed
    }
    audioPlayerStore.setPlaybackSpeed(speed)
    this.updateMediaSessionState()
  }

  stop() {
    this.pause()
    if (this.audio) {
      this.audio.pause()
      this.audio.onended = null
      this.audio.ontimeupdate = null
      this.audio.onerror = null
      this.audio.onloadedmetadata = null
      this.audio.src = ''
      this.audio = null
    }
    this.cancelWebSpeech()

    // Revoke all blob URLs to prevent memory leaks
    for (const url of this.audioSegments.values()) {
      URL.revokeObjectURL(url)
    }
    this.audioSegments.clear()

    // Revoke chapter audio URL if it exists
    if (this.chapterAudioUrl) {
      URL.revokeObjectURL(this.chapterAudioUrl)
      this.chapterAudioUrl = null
    }

    this.currentSegmentIndex = -1
    // Clear derived info
    this.segmentDurations.clear()
    this.wordsPerSegment = []
    this.totalWords = 0
    this.wordsMeasured = 0
    audioPlayerStore.setChapterDuration(0)
    this.currentChapterId = null
  }

  // Internal Logic
  private async playCurrentSegment() {
    const index = this.currentSegmentIndex

    let url = this.audioSegments.get(index)

    if (!url) {
      logger.info(`Buffer underrun for segment ${index}, generating...`)
      try {
        await this.generateSegment(index)
        if (this.currentSegmentIndex !== index || !this.isPlaying) return
        url = this.audioSegments.get(index)
        if (!url) throw new Error('Generation finished but no URL found')
      } catch (err) {
        logger.error('Failed to recover segment:', err)
        if (this.currentSegmentIndex === index) this.isPlaying = false
        return
      }
    }

    // Create new audio element with proper cleanup
    // First ensure any old instance is fully cleaned
    if (this.audio) {
      this.audio.pause()
      this.audio.onended = null
      this.audio.ontimeupdate = null
      this.audio.onerror = null
      this.audio.onloadedmetadata = null
      this.audio.src = ''
    }

    this.audio = new Audio(url)
    this.audio.playbackRate = this.playbackSpeed

    // Update duration when metadata loads
    this.audio.onloadedmetadata = () => {
      if (this.audio) this.duration = this.audio.duration
    }

    // Update time during playback
    this.audio.ontimeupdate = () => {
      if (this.audio) this.currentTime = this.audio.currentTime
    }

    this.audio.onended = () => {
      const nextIndex = this.currentSegmentIndex + 1
      if (nextIndex < this.segments.length && this.isPlaying) {
        this.currentSegmentIndex = nextIndex

        // Check buffer
        const buffered = this.countBufferedSegments()
        if (buffered < 3) {
          this.bufferSegments(this.currentSegmentIndex + 1, this.bufferTarget).catch((err) =>
            logger.error('[AudioPlayback]', err)
          )
        }

        this.cleanupOldSegments()
        this.playCurrentSegment()
      } else {
        this.isPlaying = false
        audioPlayerStore.pause()
        if (this.audio) {
          this.audio.onended = null
          this.audio.ontimeupdate = null
          this.audio.onerror = null
          this.audio.onloadedmetadata = null
          this.audio.onpause = null
          this.audio.onplay = null
          this.audio.src = ''
        }
        this.audio = null
      }
    }

    this.audio.onpause = () => {
      // If paused by system (interruption) or UI, sync state
      if (this.audio?.ended) return // Ignore if standard end
      if (this.isPlaying) {
        logger.info('Audio paused by system/external event')
        this.isPlaying = false
        audioPlayerStore.pause()
        this.updateMediaSessionState()
      }
    }

    this.audio.onplay = () => {
      if (!this.isPlaying) {
        logger.info('Audio resumed by system/external event')
        this.isPlaying = true
        audioPlayerStore.play()
        this.updateMediaSessionState()
      }
    }

    this.audio.onerror = (err) => {
      logger.error('Audio playback error:', err)
      if (this.currentSegmentIndex === index) {
        this.audioSegments.delete(index)
        this.playCurrentSegment()
      }
    }

    try {
      await this.audio.play()
    } catch (err) {
      logger.error('Failed to play audio:', err)
      if (this.currentSegmentIndex === index) {
        this.isPlaying = false
        audioPlayerStore.pause()
        if (this.audio) {
          this.audio.onended = null
          this.audio.ontimeupdate = null
          this.audio.onerror = null
          this.audio.onloadedmetadata = null
          this.audio.onpause = null
          this.audio.onplay = null
          this.audio.src = ''
        }
        this.audio = null
      }
    }
  }

  private playWebSpeech(text: string) {
    this.cancelWebSpeech()
    this.isPlaying = true // Ensure state is playing

    const utterance = new SpeechSynthesisUtterance(text)
    if (this.voice) {
      const voices = window.speechSynthesis.getVoices()
      // Try to match by name or URI
      const voice = voices.find((v) => v.name === this.voice || v.voiceURI === this.voice)
      if (voice) utterance.voice = voice
    }
    utterance.rate = this.playbackSpeed

    utterance.onend = () => {
      const nextIndex = this.currentSegmentIndex + 1
      if (nextIndex < this.segments.length && this.isPlaying) {
        this.currentSegmentIndex = nextIndex
        this.playCurrentSegment()
      } else {
        this.isPlaying = false
        audioPlayerStore.pause()
      }
    }

    utterance.onerror = (e) => {
      logger.error('Web Speech API error:', e)
      this.isPlaying = false
      audioPlayerStore.pause()
    }

    this.speechUtterance = utterance
    window.speechSynthesis.speak(utterance)
  }

  private cancelWebSpeech() {
    if (this.speechUtterance) {
      this.speechUtterance.onend = null
      this.speechUtterance.onerror = null
      this.speechUtterance = null
    }
    window.speechSynthesis.cancel()
  }

  private async generateSegment(index: number): Promise<void> {
    if (this.audioSegments.has(index)) return
    if (this.pendingGenerations.has(index)) return this.pendingGenerations.get(index)

    // Optimization: Check if this segment is already generated in the progressive store
    // This allows us to use segments generated by the main generation process without re-generating
    if (this.currentChapterId) {
      const progressiveSegment = getGeneratedSegment(this.currentChapterId, index)
      if (progressiveSegment && progressiveSegment.audioBlob) {
        // Reuse the blob!
        try {
          const url = URL.createObjectURL(progressiveSegment.audioBlob)
          this.audioSegments.set(index, url)
          audioPlayerStore.setAudioSegment(index, url)

          if (index === this.currentSegmentIndex) audioPlayerStore.setBuffering(false)

          // Use stored duration if available
          if (progressiveSegment.duration) {
            this.segmentDurations.set(index, progressiveSegment.duration)
          } else {
            // Try to get duration from URL if not stored
            this.getDurationFromUrl(url).then((dur) => {
              if (dur > 0) this.segmentDurations.set(index, dur)
            })
          }
          return
        } catch (e) {
          logger.warn('Failed to reuse progressive segment', e)
        }
      }
    }

    const segment = this.segments[index]
    if (!segment) return

    const promise = (async () => {
      const MAX_RETRIES = 3
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const worker = getTTSWorker()
          const blob = await worker.generateVoice({
            text: segment.text,
            modelType: this.selectedModel,
            voice: this.voice,
            dtype: this.selectedModel === 'kokoro' ? this.quantization : undefined,
            device: this.device,
          })

          // Defensive: revoke old URL if exists (normal flow checks has(index) before calling this method)
          const oldUrl = this.audioSegments.get(index)
          if (oldUrl) {
            URL.revokeObjectURL(oldUrl)
          }

          const url = URL.createObjectURL(blob)
          this.audioSegments.set(index, url)
          audioPlayerStore.setAudioSegment(index, url) // Sync with store
          // If this was the current segment we were waiting for, clear buffering
          if (index === this.currentSegmentIndex) audioPlayerStore.setBuffering(false)
          // Attempt to read duration for this generated segment and refine chapter duration estimate
          const dur = await this.getDurationFromUrl(url)
          if (dur > 0) {
            this.segmentDurations.set(index, dur)
            // Compute sum of known durations
            let sumKnown = 0
            for (const d of this.segmentDurations.values()) sumKnown += d
            // Compute measured words
            this.wordsMeasured = 0
            for (const [i, _] of this.segmentDurations.entries()) {
              this.wordsMeasured += this.wordsPerSegment[i] || 0
            }
            // Estimate remaining by words
            const WORDS_PER_MINUTE = 160
            const wordsPerSecond = WORDS_PER_MINUTE / 60
            const remainingWords = Math.max(0, this.totalWords - this.wordsMeasured)
            const estimateRemaining = remainingWords / (wordsPerSecond || 1)
            const newEstimate = sumKnown + estimateRemaining
            audioPlayerStore.setChapterDuration(newEstimate)
            // If we've generated all segments, set final duration to sum of known
            if (this.segmentDurations.size === this.segments.length) {
              audioPlayerStore.setChapterDuration(sumKnown)
            }
          }
          return
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          if (errorMsg.includes('Cancelled')) throw err

          logger.warn(`Failed to generate segment ${index} (attempt ${attempt})`, err)
          if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, 1000 * attempt))
          else throw err
        }
      }
    })()

    this.pendingGenerations.set(index, promise)
    // If we're generating the current segment, set buffering
    if (index === this.currentSegmentIndex) audioPlayerStore.setBuffering(true)
    try {
      await promise
    } finally {
      this.pendingGenerations.delete(index)
      // If after deleting, the current segment is still pending, keep buffering; otherwise clear
      const stillPending = this.pendingGenerations.has(this.currentSegmentIndex)
      const shouldBuffer = stillPending && this.currentSegmentIndex >= 0 && this.isPlaying
      audioPlayerStore.setBuffering(shouldBuffer)
    }
  }

  private async bufferSegments(startIndex: number, count: number) {
    const promises: Promise<void>[] = []
    for (let i = 0; i < count; i++) {
      const index = startIndex + i
      if (index >= this.segments.length) break
      if (this.audioSegments.has(index)) continue
      promises.push(this.generateSegment(index))
    }
    if (promises.length > 0) await Promise.all(promises)
  }

  private countBufferedSegments(): number {
    let count = 0
    for (let i = 1; i <= this.bufferTarget; i++) {
      if (this.audioSegments.has(this.currentSegmentIndex + i)) count++
      else break
    }
    return count
  }

  private cleanupOldSegments() {
    const keepBehind = 5
    const threshold = this.currentSegmentIndex - keepBehind
    for (const [index, url] of this.audioSegments.entries()) {
      if (index < threshold) {
        URL.revokeObjectURL(url)
        this.audioSegments.delete(index)
      }
    }
  }

  private setupMediaSession(title: string, artist: string, artwork?: string) {
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        album: 'Audiobook',
        artwork: artwork ? [{ src: artwork, sizes: '512x512', type: 'image/jpeg' }] : [],
      })

      navigator.mediaSession.setActionHandler('play', () => {
        this.play()
      })
      navigator.mediaSession.setActionHandler('pause', () => {
        this.pause()
      })
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        this.skipPrevious()
      })
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        this.skipNext()
      })
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined && this.audio) {
          this.audio.currentTime = details.seekTime
          this.currentTime = details.seekTime
          this.updateMediaSessionState()
        }
      })
    }
  }

  private updateMediaSessionState() {
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused'
      if (this.duration > 0) {
        navigator.mediaSession.setPositionState({
          duration: this.duration,
          playbackRate: this.playbackSpeed,
          position: this.currentTime,
        })
      }
    }
  }

  /**
   * Play a single segment directly from an AudioSegment object.
   * This is used for progressive playback during generation, allowing
   * users to listen to segments as they are generated without waiting
   * for the entire chapter to complete.
   */
  async playSingleSegment(segment: AudioSegment): Promise<void> {
    // Stop any current playback
    if (this.audio) {
      this.audio.pause()
      this.audio.onended = null
      this.audio.ontimeupdate = null
      this.audio.onerror = null
      this.audio.onloadedmetadata = null
      this.audio.src = ''
      this.audio = null
    }
    this.cancelWebSpeech()
    // Clear any pending generations to avoid stale state during single segment playback
    this.pendingGenerations.clear()

    // Validate the audioBlob exists and is a proper Blob
    if (!segment.audioBlob) {
      logger.error('Cannot play segment: audioBlob is missing', { segmentIndex: segment.index })
      return
    }

    // Check if audioBlob is actually a Blob instance (might not be after IndexedDB serialization in some cases)
    let blob: Blob
    if (segment.audioBlob instanceof Blob) {
      blob = segment.audioBlob
    } else {
      // If IndexedDB returned something that's not a Blob, try to reconstruct it
      // This can happen in some browser edge cases where the blob is serialized differently
      logger.warn('audioBlob is not a Blob instance, attempting to reconstruct', {
        type: typeof segment.audioBlob,
        constructor: (segment.audioBlob as object)?.constructor?.name,
      })
      try {
        // If it has arrayBuffer-like properties, try to create a new Blob
        const data = segment.audioBlob as unknown
        if (data && typeof data === 'object' && 'size' in data && 'type' in data) {
          // It might be a Blob-like object, create audio element directly
          blob = new Blob([data as BlobPart], {
            type: (data as { type: string }).type || 'audio/wav',
          })
        } else {
          logger.error('Cannot reconstruct blob from stored data', { data })
          return
        }
      } catch (reconstructError) {
        logger.error('Failed to reconstruct blob:', reconstructError)
        return
      }
    }

    // Validate blob has content
    if (blob.size === 0) {
      logger.error('Cannot play segment: audioBlob is empty', { segmentIndex: segment.index })
      return
    }

    // Revoke any existing URL for this segment to prevent memory leaks
    const existingUrl = this.audioSegments.get(segment.index)
    if (existingUrl) {
      URL.revokeObjectURL(existingUrl)
      this.audioSegments.delete(segment.index)
    }

    // Create audio from the segment blob
    let url: string
    try {
      url = URL.createObjectURL(blob)
    } catch (urlError) {
      logger.error('Failed to create blob URL:', urlError)
      return
    }

    // Store this segment for playback
    this.audioSegments.set(segment.index, url)
    this.currentSegmentIndex = segment.index
    this.isPlaying = true
    audioPlayerStore.play()

    // Create audio element
    this.audio = new Audio(url)
    this.audio.playbackRate = this.playbackSpeed

    this.audio.onloadedmetadata = () => {
      if (this.audio) this.duration = this.audio.duration
    }

    this.audio.ontimeupdate = () => {
      if (this.audio) this.currentTime = this.audio.currentTime
    }

    this.audio.onended = () => {
      this.isPlaying = false
      audioPlayerStore.pause()
      URL.revokeObjectURL(url)
      this.audioSegments.delete(segment.index)
      this.audio = null
    }

    this.audio.onerror = (event) => {
      // Extract more meaningful error information from MediaError
      const mediaError = this.audio?.error
      const errorDetails = {
        code: mediaError?.code,
        message: mediaError?.message,
        MEDIA_ERR_ABORTED: mediaError?.code === MediaError.MEDIA_ERR_ABORTED,
        MEDIA_ERR_NETWORK: mediaError?.code === MediaError.MEDIA_ERR_NETWORK,
        MEDIA_ERR_DECODE: mediaError?.code === MediaError.MEDIA_ERR_DECODE,
        MEDIA_ERR_SRC_NOT_SUPPORTED: mediaError?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED,
        blobSize: blob.size,
        blobType: blob.type,
      }
      logger.error('Single segment playback error:', errorDetails, event)
      this.isPlaying = false
      audioPlayerStore.pause()
      URL.revokeObjectURL(url)
      this.audioSegments.delete(segment.index)
      this.audio = null
    }

    try {
      await this.audio.play()
      this.updateMediaSessionState()
    } catch (err) {
      // Extract error details for better debugging
      const errorMessage = err instanceof Error ? err.message : String(err)
      const errorName = err instanceof Error ? err.name : 'Unknown'

      // AbortError is expected when rapid skipping/clicking causes the previous play() promise to reject
      if (errorName === 'AbortError') {
        logger.debug('Playback aborted by user action (harmless)')
        return
      }

      logger.error('Failed to play single segment:', {
        name: errorName,
        message: errorMessage,
        blobSize: blob.size,
        blobType: blob.type,
        url: url.substring(0, 50) + '...',
      })
      this.isPlaying = false
      audioPlayerStore.pause()
      URL.revokeObjectURL(url)
      this.audioSegments.delete(segment.index)
      this.audio = null
    }
  }
}

export const audioService = new AudioPlaybackService()
