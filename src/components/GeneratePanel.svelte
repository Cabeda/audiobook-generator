<script lang="ts">
  import type { EPubBook, Chapter } from '../lib/epubParser'
  import { getTTSWorker } from '../lib/ttsWorkerManager'
  import {
    listVoices as listKokoroVoices,
    type VoiceId,
    isWebGPUAvailable,
  } from '../lib/kokoro/kokoroClient'
  import { piperClient } from '../lib/piper/piperClient'
  import { type TTSModelType, TTS_MODELS } from '../lib/tts/ttsModels'
  import {
    concatenateAudioChapters,
    downloadAudioFile,
    audioLikeToBlob,
    type AudioChapter,
    type ConcatenationProgress,
    type AudioFormat,
  } from '../lib/audioConcat'
  import { createEventDispatcher } from 'svelte'
  import { EpubGenerator, type EpubMetadata } from '../lib/epub/epubGenerator'

  let {
    book,
    selectedMap,
    selectedVoice,
    selectedQuantization,
    selectedDevice,
    selectedModel = 'kokoro',
  } = $props<{
    book: EPubBook
    selectedMap: Map<string, boolean>
    selectedVoice: string
    selectedQuantization: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
    selectedDevice: 'auto' | 'wasm' | 'webgpu' | 'cpu'
    selectedModel?: TTSModelType
  }>()

  const dispatch = createEventDispatcher()
  let running = $state(false)
  let progressText = $state('')
  let canceled = $state(false)
  let generatedChapters = $state(new Map<string, Blob>())
  let concatenating = $state(false)
  let concatenationProgress = $state('')
  let selectedFormat = $state<AudioFormat | 'epub'>('mp3')
  let selectedBitrate = $state(192)
  let showAdvanced = $state(false)

  // Notify parent when model changes via UI
  let lastEmittedModel = $state<TTSModelType | null>(null)
  $effect(() => {
    if (selectedModel && selectedModel !== lastEmittedModel) {
      lastEmittedModel = selectedModel
      dispatch('modelchanged', { model: selectedModel })
    }
  })

  // Voice metadata for better UI labels (for Kokoro voices)
  const voiceLabels: Record<string, string> = {
    af_heart: '❤️ Heart (Female American)',
    af_alloy: '🎵 Alloy (Female American)',
    af_aoede: '🎭 Aoede (Female American)',
    af_bella: '💫 Bella (Female American)',
    af_jessica: '🌸 Jessica (Female American)',
    af_kore: '🌺 Kore (Female American)',
    af_nicole: '✨ Nicole (Female American)',
    af_nova: '⭐ Nova (Female American)',
    af_river: '🌊 River (Female American)',
    af_sarah: '🌹 Sarah (Female American)',
    af_sky: '☁️ Sky (Female American)',
    am_adam: '👨 Adam (Male American)',
    am_echo: '📢 Echo (Male American)',
    am_eric: '🎤 Eric (Male American)',
    am_liam: '🎸 Liam (Male American)',
    am_michael: '🎩 Michael (Male American)',
    am_onyx: '💎 Onyx (Male American)',
    am_puck: '🎭 Puck (Male American)',
    am_santa: '🎅 Santa (Male American)',
    bf_emma: '🇬🇧 Emma (Female British)',
    bf_isabella: '🇬🇧 Isabella (Female British)',
    bf_alice: '🇬🇧 Alice (Female British)',
    bf_lily: '🇬🇧 Lily (Female British)',
    bm_george: '🇬🇧 George (Male British)',
    bm_lewis: '🇬🇧 Lewis (Male British)',
    bm_daniel: '🇬🇧 Daniel (Male British)',
    bm_fable: '🇬🇧 Fable (Male British)',
  }

  // Voice lists
  let kokoroVoices = listKokoroVoices()
  let availableVoices = $state<Array<{ id: string; label: string }>>([])

  // Update voices when model changes
  $effect(() => {
    if (selectedModel === 'kokoro') {
      availableVoices = kokoroVoices.map((v) => ({
        id: v,
        label: voiceLabels[v] || v,
      }))
      if (!kokoroVoices.includes(selectedVoice as VoiceId)) {
        selectedVoice = 'af_heart'
        // Notify parent of voice change
        dispatch('voicechanged', { voice: selectedVoice })
      }
    } else if (selectedModel === 'piper') {
      // Load Piper voices
      piperClient.getVoices().then((voices) => {
        availableVoices = voices.map((v) => ({
          id: v.key,
          label: `${v.name} (${v.language}) - ${v.quality}`,
        }))
        // Set default if current selection is invalid or empty
        // We need to check against the NEW availableVoices list
        const currentVoiceExists = availableVoices.find((v) => v.id === selectedVoice)
        if (!currentVoiceExists) {
          // Default to a known good voice or the first one
          const defaultVoice =
            availableVoices.find((v) => v.id === 'en_US-hfc_female-medium') || availableVoices[0]
          if (defaultVoice) {
            selectedVoice = defaultVoice.id
            // Notify parent of voice change
            dispatch('voicechanged', { voice: selectedVoice })
          }
        }
      })
    } else {
      availableVoices = []
    }
  })

  // Detailed progress tracking
  let currentChapter = $state(0)
  let totalChapters = $state(0)
  let currentChunk = $state(0)
  let totalChunks = $state(0)
  let overallProgress = $state(0)

  // Check WebGPU availability
  let webgpuAvailable = isWebGPUAvailable()

  function getSelectedChapters(): Chapter[] {
    return book.chapters.filter((ch: Chapter) => selectedMap.get(ch.id))
  }

  async function generate() {
    const chapters = getSelectedChapters()
    if (chapters.length === 0) {
      alert('No chapters selected')
      return
    }
    running = true
    canceled = false
    generatedChapters.clear()

    // Initialize progress tracking
    totalChapters = chapters.length
    currentChapter = 0
    overallProgress = 0

    const worker = getTTSWorker()

    for (let i = 0; i < chapters.length; i++) {
      if (canceled) break
      const ch = chapters[i]
      currentChapter = i + 1
      currentChunk = 0
      totalChunks = 0
      progressText = `Chapter ${currentChapter}/${totalChapters}: ${ch.title}`

      // Log chapter content length for debugging
      console.log(`Chapter ${i + 1} "${ch.title}": ${ch.content.length} characters`)

      try {
        // Use worker for TTS generation (non-blocking)
        const effectiveModel: TTSModelType = selectedModel
        // If Kokoro is selected ensure the voice is valid for Kokoro
        if (effectiveModel === 'kokoro' && !kokoroVoices.includes(selectedVoice as VoiceId)) {
          console.warn(
            'Selected voice is not available for Kokoro; switching to default kokoro voice af_heart for generation'
          )
          selectedVoice = 'af_heart'
        }

        const blob = await worker.generateVoice({
          text: ch.content,
          modelType: effectiveModel,
          voice: selectedVoice,
          onProgress: (msg) => {
            progressText = `Chapter ${currentChapter}/${totalChapters}: ${msg}`
          },
          onChunkProgress: (current, total) => {
            currentChunk = current
            totalChunks = total
            // Calculate overall progress: completed chapters + current chapter progress
            const completedProgress = (i / totalChapters) * 100
            // If total chunks is unknown (0), estimate progress based on time or just show indeterminate
            const currentChapterProgress = total > 0 ? (current / total) * (100 / totalChapters) : 0 // Don't add chunk progress if we don't know the total
            overallProgress = Math.round(completedProgress + currentChapterProgress)
          },
          dtype: effectiveModel === 'kokoro' ? selectedQuantization : undefined,
          device: selectedDevice,
        })

        if (canceled) break

        generatedChapters.set(ch.id, blob)
        dispatch('generated', { id: ch.id, blob })
      } catch (err) {
        if (canceled) break
        console.error('Synth error', err)
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        if (!errorMsg.includes('Cancelled')) {
          alert('Synthesis failed for chapter: ' + ch.title)
        }
      }
    }

    running = false
    progressText = ''
    currentChapter = 0
    totalChapters = 0
    currentChunk = 0
    totalChunks = 0
    overallProgress = 0
    if (canceled) dispatch('canceled')
    else dispatch('done')
  }

  async function generateAndConcatenate() {
    if (selectedFormat === 'epub') {
      await exportEpub()
      return
    }

    await generate()

    if (!canceled && generatedChapters.size > 0) {
      await concatenateAndDownload()
    }
  }

  async function concatenateAndDownload() {
    const chapters = getSelectedChapters()
    const audioChapters: AudioChapter[] = chapters
      .filter((ch) => generatedChapters.has(ch.id))
      .map((ch) => ({
        id: ch.id,
        title: ch.title,
        blob: generatedChapters.get(ch.id)!,
      }))

    if (audioChapters.length === 0) {
      alert('No audio chapters to concatenate')
      return
    }

    concatenating = true
    concatenationProgress = 'Starting concatenation...'

    try {
      const combinedBlob = await concatenateAudioChapters(
        audioChapters,
        {
          format: selectedFormat === 'epub' ? 'mp3' : selectedFormat,
          bitrate: selectedBitrate,
          bookTitle: book.title,
          bookAuthor: book.author,
        },
        (progress: ConcatenationProgress) => {
          concatenationProgress = progress.message
        }
      )

      // Generate filename from book title with appropriate extension
      const extension = selectedFormat === 'wav' ? 'wav' : selectedFormat === 'm4b' ? 'm4b' : 'mp3'
      const filename = `${book.title.replace(/[^a-z0-9]/gi, '_')}_audiobook.${extension}`
      // Log immediately before triggering the download so automated tests can detect it
      console.log('download-trigger', { filename, size: combinedBlob.size, format: selectedFormat })
      downloadAudioFile(combinedBlob, filename)

      concatenationProgress = 'Download started!'
      setTimeout(() => {
        concatenationProgress = ''
        concatenating = false
      }, 2000)
    } catch (err) {
      console.error('Concatenation error', err)
      alert('Failed to concatenate audio chapters')
      concatenating = false
      concatenationProgress = ''
    }
  }

  async function exportEpub() {
    const chapters = getSelectedChapters()
    if (chapters.length === 0) {
      alert('No chapters selected')
      return
    }

    running = true
    canceled = false
    progressText = 'Initializing EPUB generator...'
    overallProgress = 0

    try {
      const worker = getTTSWorker()
      const metadata: EpubMetadata = {
        title: book.title,
        author: book.author,
        language: 'en', // Could be inferred or selected
        identifier: `urn:uuid:${crypto.randomUUID()}`,
        cover: book.cover,
      }

      const epub = new EpubGenerator(metadata)

      totalChapters = chapters.length

      for (let i = 0; i < chapters.length; i++) {
        if (canceled) break
        const ch = chapters[i]
        currentChapter = i + 1
        progressText = `Generating Chapter ${currentChapter}/${totalChapters}: ${ch.title}`

        // Generate segments
        const segments = await worker.generateSegments({
          text: ch.content,
          modelType: selectedModel,
          voice: selectedVoice,
          dtype: selectedModel === 'kokoro' ? selectedQuantization : undefined,
          device: selectedDevice,
          onProgress: (msg) => {
            progressText = `Chapter ${currentChapter}/${totalChapters}: ${msg}`
          },
          onChunkProgress: (current, total) => {
            currentChunk = current
            // Estimate progress
            const completedProgress = (i / totalChapters) * 100
            const currentChapterProgress = total > 0 ? (current / total) * (100 / totalChapters) : 0
            overallProgress = Math.round(completedProgress + currentChapterProgress)
          },
        })

        // Calculate SMIL data and concatenate audio
        let currentTime = 0
        const smilPars = []
        const audioBlobs = []

        for (let j = 0; j < segments.length; j++) {
          const seg = segments[j]
          // Ensure blob is a Blob
          let blob = seg.blob
          if (!(blob instanceof Blob)) {
            blob = await audioLikeToBlob(blob)
          }

          // Calculate duration (approximate for now based on size)
          // Kokoro: 24kHz, 1 channel, float32 (4 bytes) -> 96000 bytes/sec
          // WAV header is 44 bytes
          const dataSize = blob.size - 44
          const duration = Math.max(0, dataSize / (24000 * 1 * 4))

          const clipBegin = currentTime
          const clipEnd = currentTime + duration
          currentTime = clipEnd

          // Add paragraph to SMIL
          // Note: SMIL files are in OEBPS/smil/, so we need ../ to reach OEBPS/ root
          smilPars.push({
            textSrc: `../${ch.id}.xhtml#p${j + 1}`,
            audioSrc: `../audio/${ch.id}.mp3`,
            clipBegin,
            clipEnd,
          })

          audioBlobs.push({
            id: `seg-${j}`,
            title: `Segment ${j}`,
            blob,
          })
        }

        // Concatenate audio
        progressText = `Concatenating audio for Chapter ${currentChapter}...`
        // Use MP3 for better EPUB3 compatibility (WAV is not a core media type)
        const combinedBlob = await concatenateAudioChapters(audioBlobs, {
          format: 'mp3',
          bitrate: 128,
        })

        // Generate XHTML with IDs
        const xhtmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${ch.title}</title></head>
<body>
  <h1>${ch.title}</h1>
  ${segments.map((s, idx) => `<p id="p${idx + 1}">${s.text}</p>`).join('\n')}
</body>
</html>`

        epub.addChapter({
          id: ch.id,
          title: ch.title,
          content: xhtmlContent,
          audioBlob: combinedBlob,
          smilData: {
            id: `${ch.id}-smil`,
            duration: currentTime,
            pars: smilPars,
          },
        })
      }

      if (!canceled) {
        progressText = 'Packaging EPUB...'
        const epubBlob = await epub.generate()
        const filename = `${book.title.replace(/[^a-z0-9]/gi, '_')}.epub`

        // Download
        const a = document.createElement('a')
        a.href = URL.createObjectURL(epubBlob)
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(a.href)

        dispatch('done')
      }
    } catch (err) {
      console.error('EPUB Export failed', err)
      alert('EPUB Export failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      running = false
      progressText = ''
      overallProgress = 0
    }
  }

  function cancel() {
    canceled = true
    const worker = getTTSWorker()
    worker.cancelAll()
    progressText = 'Cancelling...'
  }
</script>

<div class="panel">
  <h3>Generate Audiobook</h3>

  <div class="summary">
    <span class="chapter-count"
      >📚 {getSelectedChapters().length} chapter{getSelectedChapters().length !== 1 ? 's' : ''} selected</span
    >
  </div>

  <!-- Essential Options -->
  <div class="option-group">
    <label>
      <span class="label-text">🧠 Model</span>
      <select bind:value={selectedModel} disabled={running || concatenating}>
        {#each TTS_MODELS as model}
          <option value={model.id}>{model.name}</option>
        {/each}
      </select>
    </label>
    <label>
      <span class="label-text">🎤 Voice</span>
      <select
        bind:value={selectedVoice}
        disabled={running || concatenating}
        onchange={() => dispatch('voicechanged', { voice: selectedVoice })}
      >
        {#each availableVoices as voice}
          <option value={voice.id}>{voice.label}</option>
        {/each}
      </select>
    </label>
  </div>

  <!-- Advanced Options Toggle -->
  <button
    class="advanced-toggle"
    onclick={() => (showAdvanced = !showAdvanced)}
    aria-expanded={showAdvanced}
    aria-controls="advanced-options-panel"
  >
    <span class="toggle-icon" aria-hidden="true">{showAdvanced ? '▼' : '▶'}</span>
    Advanced Options
  </button>

  {#if showAdvanced}
    <div id="advanced-options-panel" class="advanced-options">
      <div class="option-group">
        {#if selectedModel === 'kokoro'}
          <label>
            <span class="label-text">🧮 Quantization</span>
            <select
              bind:value={selectedQuantization}
              disabled={running || concatenating}
              onchange={() =>
                dispatch('quantizationchanged', { quantization: selectedQuantization })}
            >
              <option value="q8">q8 (default — faster)</option>
              <option value="q4">q4 (smaller)</option>
              <option value="q4f16">q4f16 (balanced)</option>
              <option value="fp16">fp16 (higher precision)</option>
              <option value="fp32">fp32 (full precision)</option>
            </select>
          </label>

          <label>
            <span class="label-text">⚙️ Device</span>
            <select
              bind:value={selectedDevice}
              disabled={running || concatenating}
              onchange={() => dispatch('devicechanged', { device: selectedDevice })}
            >
              <option value="auto"
                >Auto {webgpuAvailable ? '(WebGPU detected ✅)' : '(WASM)'}</option
              >
              <option value="webgpu" disabled={!webgpuAvailable}
                >WebGPU {!webgpuAvailable ? '(unavailable ⚠️)' : '(fastest)'}</option
              >
              <option value="wasm">WASM (compatible)</option>
              <option value="cpu">CPU (fallback)</option>
            </select>
          </label>
        {/if}

        <label>
          <span class="label-text">📦 Format</span>
          <select bind:value={selectedFormat} disabled={running || concatenating}>
            <option value="mp3">MP3 (Recommended)</option>
            <option value="m4b">M4B (Audiobook)</option>
            <option value="wav">WAV (Uncompressed)</option>
            <option value="epub">EPUB3 (Media Overlays)</option>
          </select>
        </label>

        {#if selectedFormat === 'mp3' || selectedFormat === 'm4b'}
          <label>
            <span class="label-text">🎚️ Quality</span>
            <select bind:value={selectedBitrate} disabled={running || concatenating}>
              <option value={128}>128 kbps (Smaller)</option>
              <option value={192}>192 kbps (Balanced)</option>
              <option value={256}>256 kbps (High)</option>
              <option value={320}>320 kbps (Maximum)</option>
            </select>
          </label>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Action Buttons -->
  <div class="actions">
    <button
      class="primary"
      onclick={generateAndConcatenate}
      disabled={running || concatenating || getSelectedChapters().length === 0}
      aria-busy={running || concatenating}
    >
      {running || concatenating ? '⏳ Processing...' : '🎧 Generate & Download'}
    </button>
    {#if running}
      <button class="secondary" onclick={cancel} aria-label="Cancel generation"> ✕ Cancel </button>
    {/if}
  </div>

  {#if running || concatenating}
    <div class="progress-container" role="status" aria-live="polite">
      <div
        class="progress-bar"
        role="progressbar"
        aria-valuenow={overallProgress}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-label="Generation progress"
      >
        <div class="progress-fill" style="width: {overallProgress}%">
          <span class="progress-text">{overallProgress}%</span>
        </div>
      </div>
      <div class="progress-details">
        {#if running && totalChapters > 0}
          <div class="progress-info">
            📖 Chapter: {currentChapter}/{totalChapters}
            {#if currentChunk > 0}
              | 🔊 Chunk: {currentChunk}{totalChunks > 0 ? `/${totalChunks}` : ''}
            {/if}
          </div>
        {/if}
        {#if progressText}
          <div class="progress-status">{progressText}</div>
        {/if}
        {#if concatenationProgress}
          <div class="progress-status concat">{concatenationProgress}</div>
        {/if}
      </div>
    </div>
  {/if}
  {#if generatedChapters.size > 0 && !running && !concatenating}
    <div class="download-section">
      <button class="secondary" onclick={concatenateAndDownload} disabled={concatenating}>
        📥 Download Complete Audiobook ({generatedChapters.size} chapter{generatedChapters.size !==
        1
          ? 's'
          : ''})
      </button>
    </div>
  {/if}
</div>

<style>
  .panel {
    border: 1px solid #e0e0e0;
    padding: 20px;
    border-radius: 12px;
    margin-top: 16px;
    background: white;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  }

  .panel h3 {
    margin: 0 0 16px 0;
    color: #333;
    font-size: 20px;
  }

  .summary {
    margin-bottom: 16px;
    padding: 12px;
    background: #f5f5f5;
    border-radius: 8px;
  }

  .chapter-count {
    font-size: 14px;
    font-weight: 500;
    color: #555;
  }

  .option-group {
    margin-bottom: 16px;
  }

  .option-group label {
    display: block;
    margin-bottom: 12px;
  }

  .label-text {
    display: block;
    font-size: 14px;
    font-weight: 500;
    color: #333;
    margin-bottom: 6px;
  }

  select {
    width: 100%;
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid #ddd;
    background: white;
    font-size: 14px;
    cursor: pointer;
    transition: border-color 0.2s;
  }

  select:hover:not(:disabled) {
    border-color: #4caf50;
  }

  select:focus {
    outline: none;
    border-color: #4caf50;
    box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.1);
  }

  select:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    background: #f5f5f5;
  }

  .advanced-toggle {
    width: 100%;
    padding: 10px;
    margin-bottom: 12px;
    background: #f8f8f8;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    color: #666;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: all 0.2s;
  }

  .advanced-toggle:hover {
    background: #f0f0f0;
    border-color: #d0d0d0;
  }

  .toggle-icon {
    font-size: 10px;
    transition: transform 0.2s;
  }

  .advanced-options {
    padding: 16px;
    background: #fafafa;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    margin-bottom: 16px;
    animation: slideDown 0.2s ease-out;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  button {
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
  }

  button.primary {
    flex: 1;
    background: linear-gradient(135deg, #4caf50, #45a049);
    color: white;
    box-shadow: 0 2px 6px rgba(76, 175, 80, 0.3);
  }

  button.primary:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(76, 175, 80, 0.4);
  }

  button.primary:active:not(:disabled) {
    transform: translateY(0);
  }

  button.primary:disabled {
    background: #ccc;
    cursor: not-allowed;
    box-shadow: none;
  }

  button.secondary {
    background: white;
    color: #666;
    border: 1px solid #ddd;
  }

  button.secondary:hover:not(:disabled) {
    background: #f5f5f5;
    border-color: #ccc;
  }

  button.secondary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    background: #f5f5f5;
  }

  .download-section {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid #e0e0e0;
  }

  .download-section button {
    width: 100%;
  }

  .progress-container {
    margin-top: 16px;
    padding: 12px;
    background: #f8f8f8;
    border-radius: 6px;
  }

  .progress-bar {
    height: 32px;
    background: #e0e0e0;
    border-radius: 16px;
    overflow: hidden;
    position: relative;
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #4caf50, #45a049);
    transition: width 0.3s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 40px;
  }

  .progress-text {
    color: white;
    font-weight: bold;
    font-size: 14px;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }

  .progress-details {
    margin-top: 10px;
  }

  .progress-info {
    font-size: 13px;
    color: #555;
    font-weight: 500;
    margin-bottom: 4px;
  }

  .progress-status {
    font-size: 13px;
    color: #666;
    font-style: italic;
  }

  .progress-status.concat {
    color: #0066cc;
    font-weight: 500;
    font-style: normal;
  }
</style>
