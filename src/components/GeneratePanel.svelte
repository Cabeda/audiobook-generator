<script lang="ts">
  import type { EPubBook, Chapter } from '../lib/epubParser'
  import { getTTSWorker } from '../lib/ttsWorkerManager'
  import { listVoices, type VoiceId } from '../lib/kokoro/kokoroClient'
  import {
    concatenateAudioChapters,
    downloadAudioFile,
    type AudioChapter,
    type ConcatenationProgress,
    type AudioFormat,
  } from '../lib/audioConcat'
  import { createEventDispatcher } from 'svelte'

  export let book: EPubBook
  export let selectedMap: Map<string, boolean>

  const dispatch = createEventDispatcher()
  let running = false
  let progressText = ''
  let canceled = false
  let generatedChapters: Map<string, Blob> = new Map()
  let concatenating = false
  let concatenationProgress = ''
  let selectedFormat: AudioFormat = 'mp3'
  let selectedBitrate = 192
  let selectedVoice: VoiceId = 'af_heart'

  // Detailed progress tracking
  let currentChapter = 0
  let totalChapters = 0
  let currentChunk = 0
  let totalChunks = 0
  let overallProgress = 0

  // Get available voices
  const availableVoices = listVoices()

  // Voice metadata for better UI labels
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

  function getSelectedChapters(): Chapter[] {
    return book.chapters.filter((ch) => selectedMap.get(ch.id))
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
        const blob = await worker.generateVoice({
          text: ch.content,
          voice: selectedVoice,
          onProgress: (msg) => {
            progressText = `Chapter ${currentChapter}/${totalChapters}: ${msg}`
          },
          onChunkProgress: (current, total) => {
            currentChunk = current
            totalChunks = total
            // Calculate overall progress: completed chapters + current chapter progress
            const completedProgress = (i / totalChapters) * 100
            const currentChapterProgress = (current / total) * (100 / totalChapters)
            overallProgress = Math.round(completedProgress + currentChapterProgress)
          },
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
          format: selectedFormat,
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

  function cancel() {
    canceled = true
    const worker = getTTSWorker()
    worker.cancelAll()
    progressText = 'Cancelling...'
  }
</script>

<div class="panel">
  <h3>Generate Audio</h3>
  <div>Selected chapters: {getSelectedChapters().length}</div>

  <div class="format-selector">
    <label>
      🎤 Voice:
      <select bind:value={selectedVoice} disabled={running || concatenating}>
        {#each availableVoices as voice}
          <option value={voice}>{voiceLabels[voice] || voice}</option>
        {/each}
      </select>
    </label>
  </div>

  <div class="format-selector">
    <label>
      Output Format:
      <select bind:value={selectedFormat} disabled={running || concatenating}>
        <option value="mp3">MP3 (Recommended)</option>
        <option value="m4b">M4B (Audiobook)</option>
        <option value="wav">WAV (Uncompressed)</option>
      </select>
    </label>

    {#if selectedFormat === 'mp3' || selectedFormat === 'm4b'}
      <label>
        Bitrate:
        <select bind:value={selectedBitrate} disabled={running || concatenating}>
          <option value={128}>128 kbps (Smaller file)</option>
          <option value={192}>192 kbps (Balanced)</option>
          <option value={256}>256 kbps (High quality)</option>
          <option value={320}>320 kbps (Maximum)</option>
        </select>
      </label>
    {/if}
  </div>

  <div style="margin-top:8px">
    <button on:click={generate} disabled={running || concatenating}>Generate Chapters</button>
    <button on:click={generateAndConcatenate} disabled={running || concatenating}>
      Generate & Download Audiobook
    </button>
    <button on:click={cancel} disabled={!running}>Cancel</button>
  </div>

  {#if running || concatenating}
    <div class="progress-container">
      <div class="progress-bar">
        <div class="progress-fill" style="width: {overallProgress}%">
          <span class="progress-text">{overallProgress}%</span>
        </div>
      </div>
      <div class="progress-details">
        {#if running && totalChapters > 0}
          <div class="progress-info">
            📖 Chapter: {currentChapter}/{totalChapters}
            {#if totalChunks > 0}
              | 🔊 Chunk: {currentChunk}/{totalChunks}
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
    <div style="margin-top:12px; padding-top:12px; border-top: 1px solid #eee">
      <button on:click={concatenateAndDownload} disabled={concatenating}>
        📥 Download Complete Audiobook ({generatedChapters.size} chapters)
      </button>
    </div>
  {/if}
</div>

<style>
  .panel {
    border: 1px solid #eee;
    padding: 12px;
    border-radius: 8px;
    margin-top: 12px;
  }
  .format-selector {
    margin-top: 12px;
    padding: 8px;
    background: #f8f8f8;
    border-radius: 4px;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
  }
  .format-selector label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    font-weight: 500;
  }
  .format-selector select {
    padding: 6px 10px;
    border-radius: 4px;
    border: 1px solid #ddd;
    background: white;
    font-size: 14px;
    cursor: pointer;
    min-width: 180px;
  }
  .format-selector select:hover:not(:disabled) {
    border-color: #4caf50;
  }
  .format-selector select:disabled {
    opacity: 0.6;
    cursor: not-allowed;
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
