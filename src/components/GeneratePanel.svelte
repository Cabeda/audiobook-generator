<script lang="ts">
  import type { EPubBook, Chapter } from '../lib/epubParser'
  import { getTTSWorker } from '../lib/ttsWorkerManager'
  import { concatenateAudioChapters, downloadAudioFile, type AudioChapter, type ConcatenationProgress, type AudioFormat } from '../lib/audioConcat'
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

  function getSelectedChapters(): Chapter[] {
    return book.chapters.filter(ch => selectedMap.get(ch.id))
  }

  async function generate() {
    const chapters = getSelectedChapters()
    if (chapters.length === 0) { alert('No chapters selected'); return }
    running = true
    canceled = false
    generatedChapters.clear()

    const worker = getTTSWorker()

    for (let i = 0; i < chapters.length; i++) {
      if (canceled) break
      const ch = chapters[i]
      progressText = `Generating ${i+1}/${chapters.length}: ${ch.title}`
      
      try {
        // Use worker for TTS generation (non-blocking)
        const blob = await worker.generateVoice({ 
          text: ch.content,
          onProgress: (msg) => {
            progressText = `${i+1}/${chapters.length}: ${msg}`
          }
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
      .filter(ch => generatedChapters.has(ch.id))
      .map(ch => ({
        id: ch.id,
        title: ch.title,
        blob: generatedChapters.get(ch.id)!
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
          bookAuthor: book.author
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

<style>
  .panel { border: 1px solid #eee; padding: 12px; border-radius: 8px; margin-top:12px }
  .format-selector { margin-top: 12px; padding: 8px; background: #f8f8f8; border-radius: 4px; }
  .format-selector label { display: inline-block; margin-right: 12px; }
  .format-selector select { padding: 4px 8px; border-radius: 4px; border: 1px solid #ddd; }
</style>

<div class="panel">
  <h3>Generate Audio</h3>
  <div>Selected chapters: {getSelectedChapters().length}</div>
  
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
  <div style="margin-top:8px">
    {#if progressText}
      <span style="color: #666">{progressText}</span>
    {/if}
    {#if concatenationProgress}
      <span style="color: #0066cc; font-weight: 500">{concatenationProgress}</span>
    {/if}
  </div>
  {#if generatedChapters.size > 0 && !running && !concatenating}
    <div style="margin-top:12px; padding-top:12px; border-top: 1px solid #eee">
      <button on:click={concatenateAndDownload} disabled={concatenating}>
        📥 Download Complete Audiobook ({generatedChapters.size} chapters)
      </button>
    </div>
  {/if}
</div>