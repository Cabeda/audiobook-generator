<script lang="ts">
  import { onDestroy, untrack, onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { get } from 'svelte/store'
  import type { Chapter } from '../lib/types/book'
  import { audioService } from '../lib/audioPlaybackService.svelte'
  import { audioPlayerStore } from '../stores/audioPlayerStore'
  import { selectedVoice as voiceStore, selectedModel as modelStore } from '../stores/ttsStore'
  import { segmentProgress, getGeneratedSegment } from '../stores/segmentProgressStore'
  import { segmentHtmlContent, generationService } from '../lib/services/generationService'
  import type { AudioSegment } from '../lib/types/audio'
  import AudioPlayerBar from './AudioPlayerBar.svelte'
  import logger from '../lib/utils/logger'
  import { saveProgress, loadProgress } from '../lib/progressStore'
  import { loadChapterSegmentProgress } from '../stores/segmentProgressStore'

  let {
    chapter,
    bookId,
    bookTitle,
    voice,
    quantization,
    device = 'auto',
    selectedModel = 'kokoro',
    chapters = [],
    onBack,
    onChapterChange,
  } = $props<{
    chapter: Chapter
    bookId: number | null
    bookTitle: string
    voice: string
    quantization: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
    device?: 'auto' | 'wasm' | 'webgpu' | 'cpu'
    selectedModel?: 'kokoro' | 'piper' | 'web_speech'
    chapters?: Chapter[]
    onBack: () => void
    onChapterChange?: (chapter: Chapter) => void
  }>()

  const SPEED_KEY = 'text_reader_speed'
  const MODEL_KEY = 'text_reader_model'
  const VOICE_KEY = 'text_reader_voice'

  // Initialize from localStorage if available
  let initialSpeed = 1.0
  let initialModel: 'kokoro' | 'piper' | 'web_speech' = selectedModel
  let initialVoice = voice
  try {
    const saved = localStorage.getItem(SPEED_KEY)
    if (saved) initialSpeed = parseFloat(saved)

    // Load saved model preference
    const savedModel = localStorage.getItem(MODEL_KEY)
    if (
      savedModel &&
      (savedModel === 'kokoro' || savedModel === 'piper' || savedModel === 'web_speech')
    ) {
      initialModel = savedModel
    }

    // Load saved voice preference
    const savedVoice = localStorage.getItem(VOICE_KEY)
    if (savedVoice) {
      initialVoice = savedVoice
    }
  } catch (e) {
    // ignore
  }

  // Local model state for text reader
  let localModel = $state<'kokoro' | 'piper' | 'web_speech'>(initialModel)
  let localVoice = $state(initialVoice)

  // Chapter progress
  let chapterIndex = $derived(chapters.findIndex((c) => c.id === chapter.id))
  let chapterTotal = $derived(chapters.length)

  // Font size
  const FONT_SIZE_KEY = 'text_reader_font_size'
  let fontSize = $state(18)
  try {
    const savedFs = localStorage.getItem(FONT_SIZE_KEY)
    if (savedFs) fontSize = parseInt(savedFs, 10)
  } catch (e) {
    // ignore
  }
  function changeFontSize(delta: number) {
    fontSize = Math.min(32, Math.max(12, fontSize + delta))
    try {
      localStorage.setItem(FONT_SIZE_KEY, String(fontSize))
    } catch (e) {
      /* ignore */
    }
  }

  // Settings menu state
  let showSettings = $state(false)
  let showKeyboardHelp = $state(false)
  let autoScrollEnabled = $state(true)
  let showResumePrompt = $state(false)
  let savedProgress: { chapterId: string; segmentIndex: number } | null = null
  let webSpeechVoices = $state<SpeechSynthesisVoice[]>([])
  let piperVoices = $state<Array<{ key: string; name: string; language: string }>>([])
  let pendingPlaySegment: number | null = null // Track segment waiting for generation to auto-play

  // Sort voices to show detected language first
  let sortedWebSpeechVoices = $derived(() => {
    if (!chapter?.detectedLanguage && !chapter?.language) return webSpeechVoices

    const detectedLang = (chapter.detectedLanguage || chapter.language || '')
      .split('-')[0]
      .toLowerCase()

    return [...webSpeechVoices].sort((a, b) => {
      const aLang = a.lang.split('-')[0].toLowerCase()
      const bLang = b.lang.split('-')[0].toLowerCase()
      const aMatch = aLang === detectedLang
      const bMatch = bLang === detectedLang

      if (aMatch && !bMatch) return -1
      if (!aMatch && bMatch) return 1
      return a.name.localeCompare(b.name)
    })
  })

  // Track the current model and voice from the store to detect changes
  // Will be initialized after first initialization to avoid false change detection
  let currentModelFromStore = $state<'kokoro' | 'piper' | null>(null)
  let currentVoiceFromStore = $state<string | null>(null)
  let textContentEl: HTMLDivElement | null = null

  // State for initialization
  let loadError = $state(false)
  let isLoading = $state(true)
  let segmentsLoaded = $state(false) // Track if segments have been initialized to avoid re-computation
  let wrappedContent = $state<string | null>(null) // Pre-wrapped HTML with segment spans

  // Progressive playback support
  let chapterSegmentProgress = $derived($segmentProgress.get(chapter?.id ?? ''))
  let isGenerating = $derived(chapterSegmentProgress?.isGenerating ?? false)
  let hasPartialAudio = $derived(
    chapterSegmentProgress && chapterSegmentProgress.generatedIndices.size > 0
  )

  let hasStaticAudio = $state(false)
  let audioAvailable = $derived(hasStaticAudio || hasPartialAudio)

  // Initialize by loading pre-generated data from DB
  $effect(() => {
    if (chapter && bookId) {
      const cId = chapter.id
      const bId = bookId

      // Always load progressive segments from IndexedDB on mount
      // This ensures segments generated before page refresh are available
      loadChapterSegmentProgress(bId, cId).catch((err) => {
        logger.warn('Failed to load segment progress from DB:', err)
      })

      // Check if already loaded for this chapter
      const needsLoad = untrack(() => {
        const store = get(audioPlayerStore)
        logger.info(
          `[TextReader] Checking if load needed: store.bookId=${store.bookId}, bId=${bId}, store.chapterId=${store.chapterId}, cId=${cId}`
        )
        return !(store.bookId === bId && store.chapterId === cId)
      })

      // On hard refresh the store may think the chapter is loaded while the service is empty.
      const shouldInitialize = needsLoad || audioService.segments.length === 0
      logger.info(
        `[TextReader] needsLoad=${needsLoad}, audioService.segments.length=${audioService.segments.length}, shouldInitialize=${shouldInitialize}`
      )

      if (shouldInitialize) {
        isLoading = true
        loadError = false

        // Load chapter from DB using pure playback method
        audioService
          .loadChapter(bId, bookTitle, chapter, {
            voice: localVoice,
            quantization,
            device,
            selectedModel: localModel,
            playbackSpeed: initialSpeed,
          })
          .then((result) => {
            // Sync voice after loading (Piper may have auto-selected)
            localVoice = audioService.getVoice()

            if (result.success) {
              // Check if we have partial audio from progressive generation
              const progressStore = untrack(() => get(segmentProgress).get(cId))
              const progressiveAudio = progressStore && progressStore.generatedIndices.size > 0

              // Audio is available if we have merged audio, segments, web speech, or progressive audio
              hasStaticAudio = result.hasAudio
              // Audio availability is now derived: audioAvailable = hasStaticAudio || hasPartialAudio

              // Always compute wrapped content so highlights match audio on first load
              if (chapter?.content) {
                const { html: segmentedHtml, segments: computedSegments } = segmentHtmlContent(
                  cId,
                  chapter.content
                )

                // If we have no segments yet, initialize from computed segments
                if (audioService.segments.length === 0 && computedSegments.length > 0) {
                  audioService.segments = computedSegments.map((s) => ({
                    index: s.index,
                    text: s.text,
                  }))
                }

                wrappedContent = segmentedHtml
              }

              // Populate audioService.segments from progressive store if not already set
              if (progressiveAudio && progressStore) {
                populateSegmentsFromStore(progressStore)
              }

              // Mark loading complete AFTER segments are populated
              isLoading = false
              segmentsLoaded = true

              const store = get(audioPlayerStore)
              const startSeg = store.chapterId === chapter.id ? store.segmentIndex : 0

              if (result.hasAudio) {
                // Auto-play from beginning if no saved progress; resume prompt handles the other case
                const savedProg = bookId ? loadProgress(String(bookId)) : null
                const hasSavedProgress =
                  savedProg && savedProg.chapterId === chapter.id && savedProg.segmentIndex > 0
                audioService.playFromSegment(startSeg, !hasSavedProgress).catch((err) => {
                  console.error('Initial seek failed:', err)
                })
              }
            } else {
              // Check if we have partial audio from progressive generation
              const progressStore = untrack(() => get(segmentProgress).get(cId))
              const progressiveAudio = progressStore && progressStore.generatedIndices.size > 0

              if (progressiveAudio && progressStore) {
                // Don't show error, we have partial audio available
                hasStaticAudio = false
                // audioAvailable will be true because of hasPartialAudio
                // Populate audioService.segments from progressive store so injection works
                populateSegmentsFromStore(progressStore)

                // Compute wrapped content even when audio is missing so highlights render on first load
                if (chapter?.content) {
                  const { html: segmentedHtml, segments: computedSegments } = segmentHtmlContent(
                    cId,
                    chapter.content
                  )

                  if (audioService.segments.length === 0 && computedSegments.length > 0) {
                    audioService.segments = computedSegments.map((s) => ({
                      index: s.index,
                      text: s.text,
                    }))
                  }

                  wrappedContent = segmentedHtml
                }
                // Mark loading complete AFTER segments are populated
                isLoading = false
                segmentsLoaded = true
              } else {
                // Audio not available initially, but we still load the text for reading
                // User can click segments to generate audio on-demand
                isLoading = false
                segmentsLoaded = true
              }
            }
          })
          .catch((err) => {
            isLoading = false
            loadError = true
            console.error('Failed to load chapter:', err)
          })
      } else {
        // Ensure highlights are available on first paint even if we skipped loading
        if (!segmentsLoaded && chapter?.content) {
          const { html: segmentedHtml, segments: computedSegments } = segmentHtmlContent(
            cId,
            chapter.content
          )

          if (audioService.segments.length === 0 && computedSegments.length > 0) {
            audioService.segments = computedSegments.map((s) => ({
              index: s.index,
              text: s.text,
            }))
          }

          wrappedContent = segmentedHtml
          segmentsLoaded = true
        }

        isLoading = false
        const store = get(audioPlayerStore)
        const startSeg = store.chapterId === chapter.id ? store.segmentIndex : 0
        const savedProg2 = bookId ? loadProgress(String(bookId)) : null
        const hasSavedProgress2 =
          savedProg2 && savedProg2.chapterId === chapter.id && savedProg2.segmentIndex > 0
        audioService.playFromSegment(startSeg, !hasSavedProgress2).catch((err) => {
          console.error('Initial seek failed:', err)
        })
      }
    }
  })

  function populateSegmentsFromStore(progressStore: NonNullable<typeof chapterSegmentProgress>) {
    if (progressStore.segmentTexts.size === 0 || audioService.segments.length > 0) return
    const segs: Array<{ index: number; text: string }> = []
    progressStore.segmentTexts.forEach((text, index) => {
      segs.push({ index, text })
    })
    segs.sort((a, b) => a.index - b.index)
    audioService.segments = segs
  }

  // Update playback speed when changed
  function updateSpeed(speed: number) {
    audioService.setSpeed(speed)
    try {
      localStorage.setItem(SPEED_KEY, speed.toString())
    } catch (e) {
      // ignore
    }
  }

  async function handleModelChange() {
    // Save to localStorage for persistence
    try {
      localStorage.setItem(MODEL_KEY, localModel)
    } catch (e) {
      console.error('Failed to save model to localStorage:', e)
    }

    // For kokoro/piper, sync with chapter settings and store
    if (
      localModel !== 'web_speech' &&
      chapter &&
      bookId &&
      bookId !== null &&
      typeof bookId === 'number'
    ) {
      const { updateChapterModel } = await import('../lib/libraryDB')
      try {
        await updateChapterModel(bookId, chapter.id, localModel)
        modelStore.set(localModel)
      } catch (error) {
        console.error('Failed to update chapter model:', error)
      }
    }
  }

  async function handleVoiceChange() {
    // Update voice in audio service immediately
    audioService.setVoice(localVoice)

    // Persist to localStorage
    try {
      localStorage.setItem(VOICE_KEY, localVoice)
    } catch (e) {
      console.error('Failed to save voice to localStorage:', e)
    }
  }

  function injectSegmentsIntoContent() {
    if (!textContentEl) return
    const root = textContentEl

    // If segments are already present (e.g., pre-wrapped content), keep them
    const existing = root.querySelectorAll('span[id^="seg-"]')
    if (existing.length) {
      existing.forEach((el) => el.classList.add('segment'))
      return
    }

    const segments = audioService.segments
    if (!segments?.length) return

    // Use TreeWalker to find all text nodes
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
    const textNodes: Text[] = []
    let node: Text | null
    while ((node = walker.nextNode() as Text | null)) {
      if (node.textContent && node.textContent.trim()) {
        textNodes.push(node)
      }
    }

    // Build a map of cumulative text offsets
    let cumulativeOffset = 0
    const nodeOffsets: { node: Text; start: number; end: number }[] = []
    for (const tn of textNodes) {
      const len = tn.textContent?.length ?? 0
      nodeOffsets.push({ node: tn, start: cumulativeOffset, end: cumulativeOffset + len })
      cumulativeOffset += len
    }

    // Get the full text content for matching
    const fullText = textNodes.map((n) => n.textContent).join('')

    // Normalize text for matching (collapse whitespace)
    const normalizeText = (text: string) => text.replace(/\s+/g, ' ').trim()

    let searchIndex = 0

    for (const segment of segments) {
      const segmentText = normalizeText(segment.text)
      if (!segmentText) continue

      // Find this segment in the full text (with normalized matching)
      const normalizedFull = normalizeText(fullText.slice(searchIndex))
      const matchIndex = normalizedFull.indexOf(segmentText)

      if (matchIndex === -1) {
        console.warn(`Segment ${segment.index} not found: "${segmentText.slice(0, 50)}..."`)
        continue
      }

      // Map back to original text position
      // Count characters in original text until we've passed 'matchIndex' normalized chars
      let origStart = searchIndex
      let normalizedCount = 0
      let inWhitespace = false

      for (let i = searchIndex; i < fullText.length && normalizedCount < matchIndex; i++) {
        const ch = fullText[i]
        if (/\s/.test(ch)) {
          if (!inWhitespace) {
            normalizedCount++
            inWhitespace = true
          }
        } else {
          normalizedCount++
          inWhitespace = false
        }
        origStart = i + 1
      }

      // Now find the end position
      let origEnd = origStart
      normalizedCount = 0
      inWhitespace = false

      for (let i = origStart; i < fullText.length && normalizedCount < segmentText.length; i++) {
        const ch = fullText[i]
        if (/\s/.test(ch)) {
          if (!inWhitespace) {
            normalizedCount++
            inWhitespace = true
          }
        } else {
          normalizedCount++
          inWhitespace = false
        }
        origEnd = i + 1
      }

      // Find which text nodes this range spans
      const startNodeInfo = nodeOffsets.find((n) => origStart >= n.start && origStart < n.end)
      const endNodeInfo = nodeOffsets.find((n) => origEnd > n.start && origEnd <= n.end)

      if (!startNodeInfo || !endNodeInfo) {
        console.warn(`Could not find nodes for segment ${segment.index}`)
        continue
      }

      try {
        const range = document.createRange()
        range.setStart(startNodeInfo.node, origStart - startNodeInfo.start)
        range.setEnd(endNodeInfo.node, origEnd - endNodeInfo.start)

        if (!range.collapsed) {
          const span = document.createElement('span')
          span.className = 'segment'
          span.id = `seg-${segment.index}`
          span.setAttribute('role', 'button')
          span.setAttribute('tabindex', '0')
          span.setAttribute('aria-label', `Play segment ${segment.index + 1}`)

          range.surroundContents(span)
        }
      } catch (err) {
        // surroundContents can fail if range crosses element boundaries
        // Fall back to extractContents approach
        try {
          const range = document.createRange()
          range.setStart(startNodeInfo.node, origStart - startNodeInfo.start)
          range.setEnd(endNodeInfo.node, origEnd - endNodeInfo.start)

          const span = document.createElement('span')
          span.className = 'segment'
          span.id = `seg-${segment.index}`
          span.setAttribute('role', 'button')
          span.setAttribute('tabindex', '0')
          span.setAttribute('aria-label', `Play segment ${segment.index + 1}`)

          const contents = range.extractContents()
          span.appendChild(contents)
          range.insertNode(span)
        } catch (err2) {
          console.warn(`Failed to wrap segment ${segment.index}:`, err2)
        }
      }

      searchIndex = origEnd
    }
  }

  // Keep audioService.segments in sync with segmentProgressStore during generation
  $effect(() => {
    const progress = $segmentProgress.get(chapter?.id ?? '')
    if (!progress || !chapter?.id) return
    populateSegmentsFromStore(progress)
  })

  // Auto-play segment when it becomes available after user clicked it
  $effect(() => {
    if (pendingPlaySegment === null || !chapter?.id) return

    // Subscribe to segmentProgress so this effect re-runs whenever a new segment is generated
    const progress = $segmentProgress.get(chapter.id)
    if (!progress) return

    const segmentData = getGeneratedSegment(chapter.id, pendingPlaySegment)
    if (segmentData) {
      logger.info(`Auto-playing segment ${pendingPlaySegment} after generation`)
      audioService.injectProgressiveSegment(segmentData)
      audioService.playFromSegment(pendingPlaySegment)
      pendingPlaySegment = null // Clear pending state
    }
  })

  // Auto-play segment when it becomes available after user clicked it
  $effect(() => {
    if (pendingPlaySegment === null || !chapter?.id) return

    const segmentData = getGeneratedSegment(chapter.id, pendingPlaySegment)
    if (segmentData) {
      logger.info(`Auto-playing segment ${pendingPlaySegment} after generation`)
      audioService.injectProgressiveSegment(segmentData)
      audioService.playFromSegment(pendingPlaySegment)
      pendingPlaySegment = null // Clear pending state
    }
  })

  // Scroll to current segment
  $effect(() => {
    const index = audioService.currentSegmentIndex
    if (index >= 0) {
      updateActiveSegment(index)
      scrollToSegment(index)
    }
  })

  // Reset segments loaded flag when chapter changes
  $effect(() => {
    if (chapter?.id) {
      segmentsLoaded = false // Reset when chapter changes so we re-initialize segments
      wrappedContent = null // Reset wrapped content
    }
  })

  // Inject segment wrappers so the active sentence can be highlighted
  // This now works even without audio - segments are computed on-the-fly for preview
  $effect(() => {
    // Proceed if loaded without error, OR if we have audio available (partial), OR if generating
    const ready = !isLoading && (!loadError || audioAvailable || isGenerating)
    const chapterId = chapter?.id
    if (!ready || !chapterId) return

    // Only compute segments once per chapter to avoid inconsistent highlighting
    if (!segmentsLoaded && audioService.segments.length === 0 && chapter?.content) {
      // segmentHtmlContent now returns pre-wrapped HTML with segment spans
      const { html: segmentedHtml, segments: computedSegments } = segmentHtmlContent(
        chapterId,
        chapter.content
      )
      if (computedSegments.length > 0) {
        audioService.segments = computedSegments.map((s) => ({ index: s.index, text: s.text }))
        wrappedContent = segmentedHtml // Store the pre-wrapped HTML
        segmentsLoaded = true
      }

      // Auto-scroll to current segment — registered as top-level effect below
    }
  })

  // Auto-scroll to current segment when playing (top-level effect, not nested)
  $effect(() => {
    if (!autoScrollEnabled || !audioService.isPlaying) return

    const currentIndex = audioService.currentSegmentIndex
    if (currentIndex < 0) return

    const segmentEl = document.getElementById(`seg-${currentIndex}`)
    if (!segmentEl) return

    const rect = segmentEl.getBoundingClientRect()
    const isOutsideViewport = rect.top < 100 || rect.bottom > window.innerHeight - 100

    if (isOutsideViewport) {
      segmentEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })

  // Segments are now pre-wrapped in the HTML, just ensure they have the segment class
  $effect(() => {
    if (audioService.segments.length > 0 && textContentEl) {
      const existingSegments = textContentEl.querySelectorAll('span[id^="seg-"]')
      existingSegments.forEach((el) => el.classList.add('segment'))

      if (audioService.currentSegmentIndex >= 0) {
        updateActiveSegment(audioService.currentSegmentIndex)
        scrollToSegment(audioService.currentSegmentIndex)
      }
    }
  })

  // Track previous progress state to detect changes
  let prevGeneratedIndices: Set<number> | null = null
  let prevIsGenerating = false
  let prevProcessingIndex = -1

  // Update segment visual states based on generation progress
  $effect(() => {
    if (!textContentEl || !chapter?.id) return
    const progress = $segmentProgress.get(chapter.id)
    if (!progress) return

    // Determine which segments need updating
    const changedIndices = new Set<number>()

    // Check if isGenerating state changed (affects all segments)
    const generatingChanged = progress.isGenerating !== prevIsGenerating

    if (!prevGeneratedIndices || generatingChanged) {
      // First run or generating state changed - update all segments
      const segmentEls = textContentEl.querySelectorAll('span[id^="seg-"]')
      segmentEls.forEach((el) => {
        const indexMatch = el.id.match(/seg-(\d+)/)
        if (indexMatch) {
          changedIndices.add(parseInt(indexMatch[1], 10))
        }
      })
    } else {
      // Find newly generated segments
      for (const idx of progress.generatedIndices) {
        if (!prevGeneratedIndices.has(idx)) {
          changedIndices.add(idx)
        }
      }

      // If generating, update the processing index segment (for pulsing effect)
      if (progress.isGenerating) {
        if (progress.processingIndex >= 0) {
          changedIndices.add(progress.processingIndex)
        }
        // Also update the previous processing segment if different
        if (prevProcessingIndex >= 0 && prevProcessingIndex !== progress.processingIndex) {
          changedIndices.add(prevProcessingIndex)
        }
      }
    }

    // The segment currently being processed gets the pulse animation
    const pulseIndex = progress.isGenerating ? progress.processingIndex : -1

    // Update only changed segments
    for (const index of changedIndices) {
      const el = textContentEl.querySelector(`#seg-${index}`)
      if (!el) continue

      const isGenerated = progress.generatedIndices.has(index)

      // Update classes for visual state
      el.classList.remove('segment-pending', 'segment-generated', 'segment-generating')

      if (isGenerated) {
        el.classList.add('segment-generated')
      } else if (progress.isGenerating) {
        if (index === pulseIndex) {
          el.classList.add('segment-generating')
        } else {
          el.classList.add('segment-pending')
        }
      } else {
        el.classList.add('segment-pending')
      }
    }

    // Store current state for next comparison
    prevGeneratedIndices = new Set(progress.generatedIndices)
    prevIsGenerating = progress.isGenerating
    prevProcessingIndex = progress.processingIndex
  })

  // Ensure initial highlight if already playing
  $effect(() => {
    if (audioService.isPlaying && audioService.currentSegmentIndex >= 0) {
      updateActiveSegment(audioService.currentSegmentIndex)
    }
  })

  function updateActiveSegment(index: number) {
    // Remove active class from all segments
    const active = document.querySelectorAll('.segment.active')
    active.forEach((el) => el.classList.remove('active'))

    // Add to current
    const el = document.getElementById(`seg-${index}`)
    if (el) {
      el.classList.add('active')
    }
  }

  function scrollToSegment(index: number) {
    requestAnimationFrame(() => {
      const element = document.getElementById(`seg-${index}`)
      const container = document.querySelector('.reader-container')

      if (element && container) {
        const elementRect = element.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()

        // Check if element is within the comfortable reading zone (middle 60% of view)
        const topThreshold = containerRect.top + containerRect.height * 0.2
        const bottomThreshold = containerRect.bottom - containerRect.height * 0.2

        const isAbove = elementRect.top < topThreshold
        const isBelow = elementRect.bottom > bottomThreshold

        if (isAbove || isBelow) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
    })
  }

  function getSegmentIndex(element: HTMLElement | null): number | null {
    if (!element || !element.id.startsWith('seg-')) return null
    const index = parseInt(element.id.replace('seg-', ''), 10)
    return isNaN(index) ? null : index
  }

  function activateSegment(index: number) {
    // Check if model has changed - if so, reload chapter with new settings
    const currentModel = audioService.getCurrentModel()
    if (currentModel !== localModel) {
      audioService.stop()
      if (chapter && bookId) {
        isLoading = true
        audioService
          .loadChapter(bookId, bookTitle, chapter, {
            voice: localVoice,
            quantization,
            device,
            selectedModel: localModel,
            playbackSpeed: audioService.playbackSpeed,
          })
          .then(() => {
            isLoading = false
            audioService.playFromSegment(index)
          })
          .catch((err) => {
            logger.error('Failed to reload chapter with new model:', err)
            isLoading = false
          })
        return
      }
    }

    if (isGenerating) {
      generationService.setGenerationPriority(chapter.id, index)
    }

    const segmentData = getGeneratedSegment(chapter.id, index)

    if (localModel === 'web_speech') {
      audioService.playFromSegment(index)
      return
    }

    if (segmentData) {
      audioService.injectProgressiveSegment(segmentData)
      audioService.playFromSegment(index)
      return
    }

    if (isGenerating) {
      audioService.playFromSegment(index)
      return
    }

    // No audio and not generating - start generation from this segment
    const totalSegments = audioService.segments.length
    pendingPlaySegment = index
    generationService
      .generateSingleChapterFromSegment(chapter, index, totalSegments, bookId ?? undefined)
      .catch((err) => {
        logger.error('Failed to start generation from segment', err)
        pendingPlaySegment = null
      })
  }

  function handleContentClick(event: MouseEvent) {
    showSettings = false
    const target = event.target as HTMLElement

    // Prevent link navigation inside the reader — links are part of the text content
    if (target.closest('a')) {
      event.preventDefault()
    }

    const segmentEl = target.closest('.segment') as HTMLElement | null
    const index = getSegmentIndex(segmentEl)
    if (index !== null) {
      activateSegment(index)
    }
  }

  function handleContentKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement
    if (target.classList.contains('segment') && target.id.startsWith('seg-')) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        const index = getSegmentIndex(target)
        if (index !== null) {
          activateSegment(index)
        }
      }
    }
  }

  function handleClose() {
    audioService.stop()
    onBack()
  }

  // Theme support
  type Theme = 'light' | 'dark' | 'sepia'
  const THEME_KEY = 'text_reader_theme'
  let currentTheme = $state<Theme>('dark')
  const themeOrder: Theme[] = ['light', 'dark', 'sepia']
  const themeIcons: Record<Theme, string> = {
    light: '☀️',
    dark: '🌙',
    sepia: '📖',
  }
  const themeLabels: Record<Theme, string> = {
    light: 'Light',
    dark: 'Dark',
    sepia: 'Sepia',
  }

  onMount(() => {
    try {
      const savedTheme = localStorage.getItem(THEME_KEY)
      if (savedTheme && ['light', 'dark', 'sepia'].includes(savedTheme)) {
        currentTheme = savedTheme as Theme
      }
    } catch (e) {
      // ignore
    }

    // Load Web Speech voices
    const loadVoices = () => {
      webSpeechVoices = window.speechSynthesis.getVoices()
    }
    loadVoices()
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices
    }

    // Load Piper voices
    loadPiperVoices()

    // Keyboard shortcuts
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignore if typing in input or settings open
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        showSettings
      ) {
        return
      }

      switch (e.key) {
        case ' ':
          e.preventDefault()
          audioService.togglePlayPause()
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (e.shiftKey) {
            audioService.skip(-10)
          } else {
            audioService.skipPrevious()
          }
          break
        case 'ArrowRight':
          e.preventDefault()
          if (e.shiftKey) {
            audioService.skip(10)
          } else {
            audioService.skipNext()
          }
          break
        case 'ArrowUp': {
          e.preventDefault()
          const speedUp = Math.min(audioService.playbackSpeed + 0.1, 3.0)
          audioService.setSpeed(speedUp)
          break
        }
        case 'ArrowDown': {
          e.preventDefault()
          const speedDown = Math.max(audioService.playbackSpeed - 0.1, 0.5)
          audioService.setSpeed(speedDown)
          break
        }
        case 'f':
        case 'F':
          e.preventDefault()
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen()
          } else {
            document.exitFullscreen()
          }
          break
        case '?':
          e.preventDefault()
          showKeyboardHelp = !showKeyboardHelp
          break
      }
    }

    window.addEventListener('keydown', handleKeyPress)

    // Load saved progress
    if (bookId) {
      const progress = loadProgress(String(bookId))
      if (progress && progress.chapterId === chapter.id && progress.segmentIndex > 0) {
        savedProgress = { chapterId: progress.chapterId, segmentIndex: progress.segmentIndex }
        showResumePrompt = true
      }
    }

    return () => {
      window.removeEventListener('keydown', handleKeyPress)
    }
  })

  // Save progress on segment change
  $effect(() => {
    if (bookId && audioService.currentSegmentIndex >= 0) {
      saveProgress(String(bookId), chapter.id, audioService.currentSegmentIndex)
    }
  })

  function resumeFromSaved() {
    if (savedProgress) {
      audioService.playFromSegment(savedProgress.segmentIndex)
      showResumePrompt = false
    }
  }

  function startFromBeginning() {
    showResumePrompt = false
  }

  async function loadPiperVoices() {
    try {
      const { piperClient } = await import('../lib/piper/piperClient')
      const voices = await piperClient.getVoices()

      // Sort by detected language first
      const detectedLang = (chapter?.detectedLanguage || chapter?.language || '')
        .split('-')[0]
        .toLowerCase()

      piperVoices = voices.sort((a: any, b: any) => {
        const aLang = a.language.split('-')[0].toLowerCase()
        const bLang = b.language.split('-')[0].toLowerCase()
        const aMatch = aLang === detectedLang
        const bMatch = bLang === detectedLang

        if (aMatch && !bMatch) return -1
        if (!aMatch && bMatch) return 1
        return a.name.localeCompare(b.name)
      })
    } catch (e) {
      console.error('Failed to load Piper voices:', e)
    }
  }

  function changeTheme(theme: Theme) {
    currentTheme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch (e) {
      // ignore
    }
  }

  function cycleTheme() {
    const currentIndex = themeOrder.indexOf(currentTheme)
    const nextTheme = themeOrder[(currentIndex + 1) % themeOrder.length]
    changeTheme(nextTheme)
  }

  onDestroy(() => {
    audioService.stop()
  })
</script>

<div class="reader-page" data-theme={currentTheme}>
  <div class="reader-container">
    <!-- Header -->
    <div class="reader-header">
      <div class="header-row top">
        <button class="back-button" onclick={handleClose} aria-label="Back to book">
          ← Back
        </button>
        <div class="header-title">
          <div class="eyebrow">{bookTitle}</div>
          <div class="main-title" aria-label="Chapter title">{chapter.title}</div>
        </div>
        <div class="header-actions">
          {#if chapterTotal > 0}
            <span
              class="chapter-progress"
              aria-label="Chapter {chapterIndex + 1} of {chapterTotal}"
            >
              {chapterIndex + 1} / {chapterTotal}
            </span>
          {/if}
        </div>
      </div>
    </div>

    <!-- Text Content -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="text-content"
      role="main"
      style="font-size: {fontSize}px"
      onclick={handleContentClick}
      onkeydown={handleContentKeyDown}
      bind:this={textContentEl}
    >
      {#if isLoading}
        <div class="loading-indicator">
          <div class="spinner"></div>
          <p>Loading chapter...</p>
        </div>
      {:else if loadError}
        <div class="error-message">
          <p>⚠️ Failed to load chapter</p>
          <p>Please try again or go back to the book.</p>
          <button class="back-link" onclick={handleClose}>← Back to book</button>
        </div>
      {:else}
        {#if !audioAvailable}
          <div class="info-banner">
            <p>
              💡 Click any segment to generate and play audio from that point. It will continue
              generating all missing segments.
            </p>
          </div>
        {/if}
        <!-- We render the pre-wrapped HTML content with segment spans. Active segment highlighting is managed by the updateActiveSegment function. -->
        {@html wrappedContent || chapter.content}
      {/if}
    </div>

    <!-- Audio Player Bar (always visible) -->
    <AudioPlayerBar
      mode="reader"
      {showSettings}
      onSettings={() => (showSettings = !showSettings)}
    />

    <!-- Resume Prompt -->
    {#if showResumePrompt}
      <div class="resume-prompt" transition:fade={{ duration: 200 }}>
        <div class="resume-content">
          <p>Resume from where you left off?</p>
          <div class="resume-actions">
            <button class="resume-btn primary" onclick={resumeFromSaved}>Resume</button>
            <button class="resume-btn" onclick={startFromBeginning}>Start Over</button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Keyboard Help Overlay -->
    {#if showKeyboardHelp}
      <div class="keyboard-help-overlay" transition:fade={{ duration: 200 }}>
        <div class="keyboard-help-content">
          <div class="keyboard-help-header">
            <h3>Keyboard Shortcuts</h3>
            <button class="close-btn" onclick={() => (showKeyboardHelp = false)}>✕</button>
          </div>
          <div class="shortcuts-grid">
            <div class="shortcut-item">
              <kbd>Space</kbd>
              <span>Play / Pause</span>
            </div>
            <div class="shortcut-item">
              <kbd>←</kbd> / <kbd>→</kbd>
              <span>Previous / Next segment</span>
            </div>
            <div class="shortcut-item">
              <kbd>Shift</kbd> + <kbd>←</kbd> / <kbd>→</kbd>
              <span>Skip 10s back / forward</span>
            </div>
            <div class="shortcut-item">
              <kbd>↑</kbd> / <kbd>↓</kbd>
              <span>Speed up / down</span>
            </div>
            <div class="shortcut-item">
              <kbd>F</kbd>
              <span>Toggle fullscreen</span>
            </div>
            <div class="shortcut-item">
              <kbd>?</kbd>
              <span>Show this help</span>
            </div>
          </div>
        </div>
      </div>
    {/if}

    <!-- Settings Menu -->
    {#if showSettings}
      <div class="settings-menu" transition:fade={{ duration: 100 }}>
        <div class="settings-header">
          <h3>Playback Settings</h3>
          <button class="close-settings" onclick={() => (showSettings = false)}>✕</button>
        </div>

        <div class="setting-item">
          <label for="speed-select">Speed</label>
          <div class="speed-selector">
            <button
              class="speed-btn"
              class:active={audioService.playbackSpeed === 0.75}
              onclick={() => updateSpeed(0.75)}>0.75x</button
            >
            <button
              class="speed-btn"
              class:active={audioService.playbackSpeed === 1.0}
              onclick={() => updateSpeed(1.0)}>1.0x</button
            >
            <button
              class="speed-btn"
              class:active={audioService.playbackSpeed === 1.25}
              onclick={() => updateSpeed(1.25)}>1.25x</button
            >
            <button
              class="speed-btn"
              class:active={audioService.playbackSpeed === 1.5}
              onclick={() => updateSpeed(1.5)}>1.5x</button
            >
            <button
              class="speed-btn"
              class:active={audioService.playbackSpeed === 2.0}
              onclick={() => updateSpeed(2.0)}>2.0x</button
            >
          </div>
        </div>

        <div class="setting-item">
          <label>Font Size</label>
          <div class="font-size-selector">
            <button
              class="font-size-btn"
              onclick={() => changeFontSize(-2)}
              aria-label="Decrease font size">A−</button
            >
            <span class="font-size-value">{fontSize}px</span>
            <button
              class="font-size-btn"
              onclick={() => changeFontSize(2)}
              aria-label="Increase font size">A+</button
            >
          </div>
        </div>

        <div class="setting-item">
          <label for="theme-select">Theme</label>
          <div class="theme-selector">
            <button
              class="theme-btn"
              class:active={currentTheme === 'light'}
              onclick={() => changeTheme('light')}>☀️ Light</button
            >
            <button
              class="theme-btn"
              class:active={currentTheme === 'dark'}
              onclick={() => changeTheme('dark')}>🌙 Dark</button
            >
            <button
              class="theme-btn"
              class:active={currentTheme === 'sepia'}
              onclick={() => changeTheme('sepia')}>📖 Sepia</button
            >
          </div>
        </div>

        <div class="setting-item">
          <label for="model-select">Model</label>
          <select
            id="model-select"
            bind:value={localModel}
            onchange={handleModelChange}
            class="model-select"
          >
            <option value="web_speech">Web Speech API</option>
            <option value="kokoro">Kokoro TTS</option>
            <option value="piper">Piper TTS</option>
          </select>
          {#if localModel !== 'web_speech'}
            <span class="hint">Changes sync with chapter settings</span>
          {/if}
        </div>

        <div class="setting-item">
          <label for="voice-select">Voice</label>
          <select
            id="voice-select"
            bind:value={localVoice}
            onchange={handleVoiceChange}
            class="model-select"
          >
            {#if localModel === 'kokoro'}
              <option value="af_heart">af_heart (Female American)</option>
              <option value="af_bella">af_bella (Female American)</option>
              <option value="bf_emma">bf_emma (Female British)</option>
              <option value="am_adam">am_adam (Male American)</option>
              <option value="bm_george">bm_george (Male British)</option>
            {:else if localModel === 'piper'}
              {#each piperVoices as piperVoice}
                <option value={piperVoice.key}>{piperVoice.name} ({piperVoice.language})</option>
              {/each}
            {:else}
              {#each sortedWebSpeechVoices() as wsVoice}
                <option value={wsVoice.name}>{wsVoice.name} ({wsVoice.lang})</option>
              {/each}
            {/if}
          </select>
          <span class="hint">Applied on next segment click</span>
        </div>

        <div class="setting-item info">
          <div class="info-row">
            <span class="label">Current:</span>
            <span class="value">{localModel} / {voice}</span>
          </div>
        </div>

        <div class="setting-item">
          <label>
            <input type="checkbox" bind:checked={autoScrollEnabled} />
            Auto-scroll during playback
          </label>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  :global(:root) {
    /* Theme Variables - Default Dark */
    --bg-color: #1e1e1e;
    --text-color: #e0e0e0;
    --secondary-text: #a0a0a0;
    --active-bg: rgba(59, 130, 246, 0.2);
    --active-text: #fff;
    --header-bg: rgba(30, 30, 30, 0.95);
    --border-color: rgba(255, 255, 255, 0.1);
    --surface-color: #2a2a2a;
    --highlight-bg: rgba(250, 204, 21, 0.35);
    --highlight-text: inherit;
    --highlight-border: #fbbf24;
    --buffered-text: #d0d0d0;
    --unprocessed-text: #808080;
    --hover-bg: rgba(255, 255, 255, 0.05);
  }

  [data-theme='light'] {
    --bg-color: #ffffff;
    --text-color: #1a1a1a;
    --secondary-text: #666666;
    --active-bg: rgba(59, 130, 246, 0.1);
    --active-text: #000;
    --header-bg: rgba(255, 255, 255, 0.95);
    --border-color: #e5e7eb;
    --surface-color: #f3f4f6;
    --highlight-bg: rgba(255, 255, 0, 0.3);
    --highlight-text: inherit;
    --highlight-border: #fbbf24;
    --buffered-text: #374151;
    --unprocessed-text: #9ca3af;
    --hover-bg: rgba(0, 0, 0, 0.05);
  }

  [data-theme='dark'] {
    --bg-color: #1a1a1a;
    --text-color: #f1f5f9;
    --secondary-text: #cbd5e1;
    --active-bg: #3d3d3d;
    --active-text: #fff;
    --bg-color: #1a1a1a;
    --header-bg: #1a1a1a;
    --border-color: #333;
    --surface-color: #2a2a2a;
    --unprocessed-text: #ffffff;
    --hover-bg: rgba(255, 255, 255, 0.08);
  }

  [data-theme='sepia'] {
    --bg-color: #f4ecd8;
    --text-color: #5b4636;
    --secondary-text: #7b604b;
    --active-bg: #e6dcb8;
    --active-text: #000;
    --header-bg: #f4ecd8;
    --border-color: #dccfb4;
    --surface-color: #eaddc5;
    --highlight-bg: #ffecb3;
    --highlight-text: #000;
    --highlight-border: #ffca28;
    --buffered-text: #8d6e63;
    --unprocessed-text: #8b7355;
    --hover-bg: rgba(139, 115, 85, 0.1);
  }

  .reader-page {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--bg-color);
    color: var(--text-color);
    z-index: 999;
    animation: fadeIn 0.2s ease-out;
    transition:
      background-color 0.3s,
      color 0.3s;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .reader-container {
    width: 100%;
    height: 100%;
    max-width: 900px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
  }

  .reader-header {
    display: flex;
    flex-direction: column;
    padding: 16px 24px;
    border-bottom: 1px solid var(--border-color);
    background: var(--header-bg);
    color: var(--text-color);
    position: sticky;
    top: 0;
    z-index: 10;
    isolation: isolate;
    mix-blend-mode: normal;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
    transition:
      background-color 0.3s,
      border-color 0.3s;
    gap: 16px;
  }

  .back-button {
    background: none;
    border: 1px solid var(--border-color);
    color: var(--text-color);
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.95rem;
    transition: all 0.2s;
    white-space: nowrap;
  }

  .back-button:hover {
    background: var(--surface-color);
    border-color: var(--text-color);
  }

  .reader-page[data-theme='dark'] .back-button {
    background: rgba(255, 255, 255, 0.04);
    border-color: var(--border-color);
    color: var(--text-color);
  }

  .reader-page[data-theme='dark'] .back-button:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: var(--text-color);
  }

  .header-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 12px;
    width: 100%;
  }

  .header-row.top {
    width: 100%;
  }

  .header-title {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .header-title .eyebrow {
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--secondary-text, var(--text-color));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-title .main-title {
    font-size: 19px;
    font-weight: 700;
    color: var(--text-color);
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-width: 140px;
    justify-self: flex-end;
  }

  .theme-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border-radius: 999px;
    border: 1px solid var(--border-color);
    background: var(--surface-color);
    color: var(--text-color);
    cursor: pointer;
    font-size: 0.9rem;
    transition: all 0.2s ease;
    min-width: 110px;
  }

  .theme-toggle:hover {
    border-color: var(--text-color);
    box-shadow: 0 6px 14px rgba(0, 0, 0, 0.18);
  }

  .reader-page[data-theme='dark'] .theme-toggle {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(148, 163, 184, 0.35);
  }

  .reader-page[data-theme='dark'] .theme-toggle:hover {
    border-color: var(--text-color);
    background: rgba(255, 255, 255, 0.1);
  }

  .theme-icon {
    font-size: 1rem;
  }

  .theme-label {
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .text-content {
    flex: 1;
    overflow-y: auto;
    padding: 40px 60px 100px 60px; /* Added bottom padding for bar */
    line-height: 1.8;
    font-family:
      'Inter',
      system-ui,
      -apple-system,
      sans-serif;
    font-size: 18px;
    color: var(--text-color);
    transition: color 0.3s;
  }

  /* Neutralize links inside reader content — they are part of the article text
     and should not look or behave like interactive links. */
  .text-content :global(a) {
    color: inherit;
    text-decoration: none;
    pointer-events: none;
    cursor: inherit;
  }

  .loading-indicator {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 60px 40px;
    color: var(--secondary-text);
  }

  .loading-indicator .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid var(--border-color);
    border-top-color: var(--text-color);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .error-message {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 60px 40px;
    color: var(--text-color);
    text-align: center;
  }

  .error-message p {
    margin: 0;
    font-size: 1.1rem;
  }

  .error-message .back-link {
    padding: 8px 16px;
    border: 1px solid var(--border-color);
    background: var(--surface-color);
    color: var(--text-color);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    margin-top: 16px;
  }

  .error-message .back-link:hover {
    border-color: var(--text-color);
    background: var(--active-bg);
  }

  .info-banner {
    background: var(--feature-bg);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 16px 20px;
    margin-bottom: 24px;
    color: var(--text-color);
  }

  .info-banner p {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.6;
  }

  /* Style for injected segments */
  :global(.segment) {
    cursor: pointer;
    border-radius: 3px;
    padding: 2px 4px;
    margin: -2px -4px;
    transition:
      background-color 0.15s ease,
      box-shadow 0.15s ease,
      color 0.15s ease;
  }

  :global(.segment:hover) {
    background-color: var(--selected-bg);
    box-shadow: 0 0 0 2px var(--border-color);
  }

  :global(.segment:focus) {
    outline: 2px solid var(--primary-color);
    outline-offset: 2px;
    background-color: var(--selected-bg);
  }

  :global(.segment.active) {
    background-color: var(--highlight-bg);
    color: var(--highlight-text);
    border-radius: 3px;
    box-shadow: none;
    outline: 2px solid var(--highlight-border);
    outline-offset: 1px;
  }

  /* Progressive Generation Segment States */
  :global(.segment-pending) {
    opacity: 0.5;
    color: var(--secondary-text);
    cursor: default;
  }

  :global(.segment-pending:hover) {
    background-color: var(--feature-bg);
    box-shadow: 0 0 0 2px var(--border-color);
  }

  :global(.segment-generating) {
    opacity: 0.7;
    animation: pulseSegment 1.5s ease-in-out infinite;
    background-color: var(--feature-bg);
  }

  :global(.segment-generating:hover) {
    background-color: var(--selected-bg);
    box-shadow: 0 0 0 2px var(--border-color);
  }

  @keyframes pulseSegment {
    0%,
    100% {
      opacity: 0.5;
    }
    50% {
      opacity: 0.9;
    }
  }

  :global(.segment-generated) {
    opacity: 1;
    cursor: pointer;
    position: relative;
  }

  :global(.segment-generated:hover) {
    background-color: rgba(34, 197, 94, 0.2);
    box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.5);
  }

  :global(.segment-generated::after) {
    content: '';
    position: absolute;
    left: 0;
    bottom: -1px;
    width: 100%;
    height: 2px;
    background-color: #22c55e;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  :global(.segment-generated:hover::after) {
    opacity: 0.7;
  }

  /* Settings Menu */
  .settings-menu {
    position: fixed;
    bottom: 90px;
    right: max(24px, calc((100vw - 900px) / 2 + 24px));
    background: var(--header-bg);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 16px;
    width: 300px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
    z-index: 101;
  }

  .settings-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border-color);
  }

  .settings-header h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .close-settings {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-color);
    font-size: 18px;
    padding: 4px;
  }

  .setting-item {
    margin-bottom: 16px;
  }

  .setting-item label {
    display: block;
    margin-bottom: 8px;
    font-size: 14px;
    font-weight: 500;
  }

  .speed-selector {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .speed-btn {
    flex: 1;
    padding: 6px 4px;
    border: 1px solid var(--border-color);
    background: var(--bg-color);
    color: var(--text-color);
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .speed-btn:hover {
    background: var(--surface-color);
  }

  .font-size-selector {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .font-size-btn {
    padding: 6px 12px;
    border: 1px solid var(--border-color);
    background: var(--bg-color);
    color: var(--text-color);
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
  }

  .font-size-btn:hover {
    background: var(--surface-color);
  }

  .font-size-value {
    min-width: 40px;
    text-align: center;
    font-size: 13px;
    color: var(--secondary-text);
  }

  .chapter-progress {
    font-size: 0.8rem;
    color: var(--secondary-text);
    white-space: nowrap;
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--surface-color);
    border: 1px solid var(--border-color);
  }

  /* Subtle indicator for buffered segments */
  .theme-selector {
    display: flex;
    gap: 8px;
  }

  .theme-btn {
    flex: 1;
    padding: 6px 4px;
    border: 1px solid var(--border-color);
    background: var(--bg-color);
    color: var(--text-color);
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .theme-btn:hover {
    background: var(--surface-color);
  }

  .theme-btn.active {
    background: var(--text-color);
    color: var(--bg-color);
    border-color: var(--text-color);
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
    margin-bottom: 4px;
    color: var(--text-color);
    opacity: 0.8;
  }

  .hint {
    font-size: 11px;
    color: var(--secondary-text);
    font-style: italic;
    margin-left: 8px;
  }

  .model-select {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--border-color);
    background: var(--bg-color);
    color: var(--text-color);
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    margin-bottom: 4px;
  }

  .model-select:hover {
    background: var(--surface-color);
  }

  .info-row .value {
    font-weight: 500;
  }

  @media (max-width: 640px) {
    .text-content {
      padding: 16px 16px 100px 16px;
      font-size: 17px;
      line-height: 1.7;
    }

    .settings-menu {
      right: 16px;
      left: 16px;
      width: auto;
      bottom: 80px;
    }
  }

  .resume-prompt {
    position: fixed;
    top: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 16px 24px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 1000;
  }

  .resume-content p {
    margin: 0 0 12px 0;
    color: var(--text-color);
  }

  .resume-actions {
    display: flex;
    gap: 8px;
  }

  .resume-btn {
    padding: 8px 16px;
    border: 1px solid var(--border-color);
    background: var(--bg-color);
    color: var(--text-color);
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
  }

  .resume-btn.primary {
    background: #3b82f6;
    color: white;
    border-color: #3b82f6;
  }

  .resume-btn:hover {
    opacity: 0.8;
  }

  .keyboard-help-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
  }

  .keyboard-help-content {
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 24px;
    max-width: 500px;
    width: 90%;
  }

  .keyboard-help-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }

  .keyboard-help-header h3 {
    margin: 0;
    color: var(--text-color);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-color);
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
  }

  .shortcuts-grid {
    display: grid;
    gap: 12px;
  }

  .shortcut-item {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .shortcut-item kbd {
    background: var(--bg-color);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    padding: 4px 8px;
    font-family: monospace;
    font-size: 13px;
    min-width: 32px;
    text-align: center;
  }

  .shortcut-item span {
    color: var(--text-color);
    font-size: 14px;
  }
</style>
