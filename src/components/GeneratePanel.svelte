<script lang="ts">
  import type { EPubBook, Chapter } from '../lib/epubParser'
  import { getTTSWorker } from '../lib/ttsWorkerManager'
  import {
    listVoices as listKokoroVoices,
    type VoiceId,
    isWebGPUAvailable,
    isWebGPUAvailableAsync,
  } from '../lib/kokoro/kokoroClient'
  import { onMount, untrack } from 'svelte'
  import { get } from 'svelte/store' // Added 'get'
  import { piperClient } from '../lib/piper/piperClient'
  import { type TTSModelType, TTS_MODELS } from '../lib/tts/ttsModels'
  import { lastKokoroVoice, lastPiperVoice, advancedSettings } from '../stores/ttsStore'
  import { ADVANCED_SETTINGS_SCHEMA } from '../lib/types/settings'
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
  import { toastStore } from '../stores/toastStore'
  import { getChapterAudioWithSettings, type AudioGenerationSettings } from '../lib/libraryDB'

  let {
    book,
    bookId = null,
    selectedMap,
    selectedVoice,
    selectedQuantization,
    selectedDevice,
    selectedModel = 'kokoro',
    chapterStatus = $bindable(new Map()),
    chapterErrors = $bindable(new Map()),
  } = $props<{
    book: EPubBook
    bookId?: number | null
    selectedMap: Map<string, boolean>
    selectedVoice: string
    selectedQuantization: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
    selectedDevice: 'auto' | 'wasm' | 'webgpu' | 'cpu'
    selectedModel?: TTSModelType
    chapterStatus?: Map<string, 'pending' | 'processing' | 'done' | 'error'>
    chapterErrors?: Map<string, string>
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

  // Set up Web Speech voices handler once
  let webSpeechVoicesLoaded = $state(false)

  onMount(() => {
    // Load Web Speech voices once on mount
    const loadWebSpeechVoices = () => {
      const voices = window.speechSynthesis.getVoices()
      if (voices.length > 0) {
        webSpeechVoicesLoaded = true
      }
    }

    loadWebSpeechVoices()
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadWebSpeechVoices
    }
  })

  // Update voices when model changes
  $effect(() => {
    // Track the model change
    const currentModel = selectedModel

    if (currentModel === 'kokoro') {
      availableVoices = kokoroVoices.map((v) => ({
        id: v,
        label: voiceLabels[v] || v,
      }))
      // Only change voice if it's invalid - use untrack to prevent circular updates
      untrack(() => {
        // Try to restore last used Kokoro voice
        const lastVoice = $lastKokoroVoice
        if (kokoroVoices.includes(lastVoice as VoiceId)) {
          if (selectedVoice !== lastVoice) {
            selectedVoice = lastVoice
            dispatch('voicechanged', { voice: selectedVoice })
          }
        } else if (
          !kokoroVoices.includes(selectedVoice as VoiceId) &&
          selectedVoice !== 'af_heart'
        ) {
          selectedVoice = 'af_heart'
          // Notify parent of voice change
          dispatch('voicechanged', { voice: selectedVoice })
        }
      })
    } else if (currentModel === 'piper') {
      // Clear voices immediately to prevent stale data usage during async load
      availableVoices = []
      // Load Piper voices
      piperClient.getVoices().then((voices) => {
        // Only update if still on piper model (model may have changed while loading)
        if (selectedModel !== 'piper') return

        availableVoices = voices.map((v) => ({
          id: v.key,
          label: `${v.name} (${v.language}) - ${v.quality}`,
        }))
        // Set default if current selection is invalid or empty
        // We need to check against the NEW availableVoices list
        const currentVoiceExists = availableVoices.find((v) => v.id === selectedVoice)

        untrack(() => {
          // Try to restore last used Piper voice
          const lastVoice = $lastPiperVoice
          const lastVoiceExists = availableVoices.find((v) => v.id === lastVoice)

          if (lastVoiceExists) {
            if (selectedVoice !== lastVoice) {
              selectedVoice = lastVoice
              dispatch('voicechanged', { voice: selectedVoice })
            }
          } else if (!currentVoiceExists) {
            // Default to a known good voice or the first one
            const defaultVoice =
              availableVoices.find((v) => v.id === 'en_US-hfc_female-medium') || availableVoices[0]
            if (defaultVoice && selectedVoice !== defaultVoice.id) {
              selectedVoice = defaultVoice.id
              // Notify parent of voice change
              dispatch('voicechanged', { voice: selectedVoice })
            }
          }
        })
      })
    } else {
      availableVoices = []
    }
  })

  // Persist voice selection changes to the appropriate store
  $effect(() => {
    if (selectedModel === 'kokoro') {
      // Only persist if it's a valid Kokoro voice
      if (kokoroVoices.includes(selectedVoice as VoiceId)) {
        $lastKokoroVoice = selectedVoice
      }
    } else if (selectedModel === 'piper') {
      // Only persist if it's a valid Piper voice (in the current list)
      // This prevents overwriting with a Kokoro voice ID during transition
      if (availableVoices.some((v) => v.id === selectedVoice)) {
        $lastPiperVoice = selectedVoice
      }
    }
  })

  // Detailed progress tracking
  let currentChapter = $state(0)
  let totalChapters = $state(0)
  let currentChunk = $state(0)
  let totalChunks = $state(0)
  let overallProgress = $state(0)

  // Chapter status tracking for UI feedback
  // (Props defined at top of file)

  // Check WebGPU availability
  let webgpuAvailable = $state(isWebGPUAvailable())

  // Re-check availability asynchronously (more accurate in headless/test envs)
  onMount(async () => {
    try {
      webgpuAvailable = await isWebGPUAvailableAsync()
    } catch {
      webgpuAvailable = false
    }
  })

  function getSelectedChapters(): Chapter[] {
    return book.chapters.filter((ch: Chapter) => selectedMap.get(ch.id))
  }

  async function generate(chaptersToProcess?: Chapter[]) {
    const chapters = chaptersToProcess || getSelectedChapters()
    if (chapters.length === 0) {
      toastStore.warning('No chapters selected')
      return
    }

    // Ensure we aren't already running
    if (running) return

    running = true
    canceled = false
    progressText = 'Starting generation...'

    // Reset progress tracking variables for UI
    totalChapters = chapters.length
    currentChapter = 0
    overallProgress = 0

    try {
      // Use the unified service
      const { generationService } = await import('../lib/services/generationService')

      // We need to sync the loop/progress with the store-based service?
      // generationService updates chapterProgress store.
      // We can just rely on that... but GeneratePanel has its own `progressText` and `overallProgress` UI.
      // For minimal friction, we let generationService do the work, and we can't easily hook into its exact progress calc
      // without subscribing to the store.
      // But for this task, the goal is unified engine.

      await generationService.generateChapters(chapters)

      if (canceled) {
        dispatch('canceled')
      } else {
        // Check if service was canceled? generationService has internal cancel state.
        // If we cancel via panel, we should call service.cancel().
        if (generationService.isRunning()) {
          // It finished successfully
          // Refresh generated audio map?
          // generationService updates 'generatedAudio' store.
          // GeneratePanel should probably subscribe to it or just rely on parent passing it down?
          // But GeneratePanel has `generatedChapters` local state.
          // We should sync local state from store.
          const { generatedAudio } = await import('../stores/bookStore')
          const audioMap = untrack(() => get(generatedAudio))

          for (const ch of chapters) {
            if (audioMap.has(ch.id)) {
              generatedChapters.set(ch.id, audioMap.get(ch.id)!.blob)
              dispatch('generated', { id: ch.id, blob: audioMap.get(ch.id)!.blob })
            }
          }
          dispatch('done')
        } else {
          // It was canceled externally or failed?
          if (canceled) dispatch('canceled')
        }
      }
    } catch (err) {
      console.error('Generation failed', err)
      toastStore.error('Generation failed: ' + err)
    } finally {
      running = false
      progressText = ''
      overallProgress = 0
    }
  }

  async function generateAudio() {
    const selectedChapters = getSelectedChapters()

    // Check if we have existing audio and which chapters need (re)generation
    const currentSettings: AudioGenerationSettings = {
      model: selectedModel,
      voice: selectedVoice,
      quantization: selectedModel === 'kokoro' ? selectedQuantization : undefined,
      device: selectedModel === 'kokoro' ? selectedDevice : undefined,
    }

    // Load existing audio and check settings
    const chaptersToGenerate: Chapter[] = []
    if (bookId) {
      for (const ch of selectedChapters) {
        const existingAudio = await getChapterAudioWithSettings(bookId, ch.id)
        if (existingAudio) {
          // Check if settings match
          const settingsMatch =
            existingAudio.settings &&
            existingAudio.settings.model === currentSettings.model &&
            existingAudio.settings.voice === currentSettings.voice &&
            existingAudio.settings.quantization === currentSettings.quantization &&
            existingAudio.settings.device === currentSettings.device

          if (settingsMatch) {
            // Reuse existing audio
            if (!generatedChapters.has(ch.id)) {
              generatedChapters.set(ch.id, existingAudio.blob)
            }
          } else {
            // Settings don't match, needs regeneration
            chaptersToGenerate.push(ch)
          }
        } else {
          // No existing audio
          chaptersToGenerate.push(ch)
        }
      }
    } else {
      // No bookId, generate all selected chapters
      chaptersToGenerate.push(...selectedChapters)
    }

    // Only generate if we have chapters that need generation
    if (chaptersToGenerate.length > 0) {
      await generate(chaptersToGenerate)
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
      toastStore.warning('No audio chapters to concatenate')
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
      const extension =
        selectedFormat === 'wav'
          ? 'wav'
          : selectedFormat === 'm4b'
            ? 'm4b'
            : selectedFormat === 'mp4'
              ? 'mp4'
              : 'mp3'
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
      toastStore.error('Failed to concatenate audio chapters')
      concatenating = false
      concatenationProgress = ''
    }
  }

  async function exportEpub() {
    const chapters = getSelectedChapters()
    if (chapters.length === 0) {
      toastStore.warning('No chapters selected')
      return
    }

    running = true
    canceled = false
    progressText = 'Exporting EPUB...'
    overallProgress = 0

    try {
      const { generationService } = await import('../lib/services/generationService')

      await generationService.exportEpub(chapters, {
        title: book.title,
        author: book.author,
        cover: book.cover,
      })

      if (canceled) {
        // Handle cancel if relevant
      } else {
        dispatch('done')
      }
    } catch (err) {
      console.error('EPUB Export failed', err)
      toastStore.error('EPUB Export failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      running = false
      progressText = ''
      overallProgress = 0
    }
  }

  export async function retryChapter(chapterId: string) {
    const chapter = book.chapters.find((c: Chapter) => c.id === chapterId)
    if (chapter) {
      // Clear error state before retrying
      chapterStatus.set(chapterId, 'pending')
      chapterErrors.delete(chapterId)
      await generate([chapter])
    }
  }

  async function exportAudio() {
    // Ensure all audio is generated before exporting
    await generateAudio()

    if (canceled) return

    if (selectedFormat === 'epub') {
      await exportEpub()
    } else {
      await concatenateAndDownload()
    }
  }

  async function cancel() {
    canceled = true
    const { generationService } = await import('../lib/services/generationService')
    generationService.cancel()
    progressText = 'Cancelling...'
  }

  let showExportMenu = $state(false)

  function selectProcessedAndExport() {
    // 1. Select all processed chapters
    for (const [id, status] of chapterStatus) {
      if (status === 'done' && generatedChapters.has(id)) {
        selectedMap.set(id, true)
      } else {
        // Optional: Deselect others? User asked to "select all ... processed",
        // implying we might want to ONLY export processed ones.
        // Let's assume we want to ONLY select processed ones for this action.
        selectedMap.set(id, false)
      }
    }
    // Force reactivity for the map if needed (Svelte 5 Map reactivity is usually fine if using $bindable or State)
    // But since selectedMap is a Prop, updating it might require re-assignment or it's a Map so it's mutable.
    // However, for the UI to update, we might need to trigger reactivity if it's passed down.
    // Since it's a Map object, Svelte 5 $state on a Map works fine for internal mutations if the map itself is reactive.
    // If selectedMap comes from parent as a prop, we need to be careful.
    // Assuming Svelte 5 reactivity handles Map mutations if it was created with $state in parent.

    // 2. Close menu
    showExportMenu = false

    // 3. Trigger export
    // We export immediately. Since we selected only processed ones, it should jump to concatenation.
    exportAudio()
  }

  // Helper to group settings
  function getSettingsGroups(model: string) {
    const schema = ADVANCED_SETTINGS_SCHEMA[model] || []
    const groups: Record<string, typeof schema> = {}

    schema.forEach((setting) => {
      const groupName = setting.group || 'General'
      if (!groups[groupName]) groups[groupName] = []
      groups[groupName].push(setting)
    })

    // Sort groups to ensure consistent order (e.g. Performance last, or alphabetical)
    // Let's prioritize: Text Processing, Audio Characteristics, Performance, General
    const priority = ['Text Processing', 'Audio Characteristics', 'Performance', 'General']
    return Object.entries(groups).sort((a, b) => {
      const idxA = priority.indexOf(a[0])
      const idxB = priority.indexOf(b[0])
      if (idxA !== -1 && idxB !== -1) return idxA - idxB
      if (idxA !== -1) return -1
      if (idxB !== -1) return 1
      return a[0].localeCompare(b[0])
    })
  }
</script>

<div class="panel">
  <h3>Generate Audiobook</h3>

  <div class="summary">
    <span class="chapter-count"
      >📚 {getSelectedChapters().length} chapter{getSelectedChapters().length !== 1 ? 's' : ''} selected</span
    >
  </div>

  <!-- Essential Options - Main Card -->
  <div class="form-card primary-settings">
    <h4 class="card-title">Generation Settings</h4>
    <div class="form-grid">
      <div class="form-field">
        <label for="model-select">
          <span class="label-text">🧠 TTS Model</span>
          <p class="help-text">Choose the text-to-speech engine</p>
        </label>
        <select id="model-select" bind:value={selectedModel} disabled={running || concatenating}>
          {#each TTS_MODELS as model}
            <option value={model.id}>{model.name}</option>
          {/each}
        </select>
      </div>
      <div class="form-field">
        <label for="voice-select">
          <span class="label-text">🎤 Voice</span>
          <p class="help-text">Select the speaker voice</p>
        </label>
        <select
          id="voice-select"
          bind:value={selectedVoice}
          disabled={running || concatenating}
          onchange={() => dispatch('voicechanged', { voice: selectedVoice })}
        >
          {#each availableVoices as voice}
            <option value={voice.id}>{voice.label}</option>
          {/each}
        </select>
      </div>
    </div>
  </div>

  <!-- Export Format Options - Secondary Card -->
  <div class="form-card export-settings">
    <h4 class="card-title">Export Options</h4>
    <div class="form-grid">
      <div class="form-field">
        <label for="format-select">
          <span class="label-text">📦 Export Format</span>
          <p class="help-text">Output file format (MP3 recommended for compatibility)</p>
        </label>
        <select id="format-select" bind:value={selectedFormat} disabled={running}>
          <option value="mp3">MP3 (Recommended)</option>
          <option value="mp4">MP4 (With Chapters)</option>
          <option value="m4b">M4B (Audiobook)</option>
          <option value="wav">WAV (Uncompressed)</option>
          <option value="epub">EPUB3 (Media Overlays)</option>
        </select>
      </div>

      {#if selectedFormat === 'mp3' || selectedFormat === 'm4b' || selectedFormat === 'mp4'}
        <div class="form-field quality-field">
          <label for="bitrate-select">
            <span class="label-text">🎚️ Audio Quality</span>
            <p class="help-text">Higher bitrate = better quality but larger file</p>
          </label>
          <select id="bitrate-select" bind:value={selectedBitrate} disabled={running}>
            <option value={128}>128 kbps (Smaller)</option>
            <option value={192}>192 kbps (Balanced) — Recommended</option>
            <option value={256}>256 kbps (High)</option>
            <option value={320}>320 kbps (Maximum)</option>
          </select>
        </div>
      {/if}
    </div>
  </div>

  <!-- Advanced Options Toggle -->
  <button
    class="advanced-toggle"
    onclick={() => (showAdvanced = !showAdvanced)}
    aria-expanded={showAdvanced}
    aria-controls="advanced-options-panel"
  >
    <span class="toggle-icon">{showAdvanced ? '▼' : '▶'}</span>
    <span>⚙️ Advanced Options</span>
  </button>

  {#if showAdvanced}
    <div id="advanced-options-panel" class="form-card advanced-settings">
      {#if selectedModel === 'kokoro'}
        <div class="advanced-group">
          <h5 class="group-title">Model Configuration</h5>
          <div class="form-grid">
            <div class="form-field">
              <label for="quantization-select">
                <span class="label-text">🧮 Quantization</span>
                <p class="help-text">Precision trade-off: lower = smaller model, faster</p>
              </label>
              <select
                id="quantization-select"
                bind:value={selectedQuantization}
                disabled={running || concatenating}
                onchange={() =>
                  dispatch('quantizationchanged', { quantization: selectedQuantization })}
              >
                <option value="q8">q8 (default — fastest)</option>
                <option value="q4">q4 (smallest)</option>
                <option value="q4f16">q4f16 (balanced)</option>
                <option value="fp16">fp16 (higher precision)</option>
                <option value="fp32">fp32 (full precision)</option>
              </select>
            </div>

            <div class="form-field">
              <label for="device-select">
                <span class="label-text">⚙️ Device</span>
                <p class="help-text">Where to run the model</p>
              </label>
              <select
                id="device-select"
                bind:value={selectedDevice}
                disabled={running || concatenating}
                onchange={() => dispatch('devicechanged', { device: selectedDevice })}
              >
                <option value="auto">Auto {webgpuAvailable ? '(WebGPU ✅)' : '(WASM)'}</option>
                <option value="webgpu" disabled={!webgpuAvailable}
                  >WebGPU {!webgpuAvailable ? '(unavailable)' : '(fastest)'}</option
                >
                <option value="wasm">WASM (compatible)</option>
                <option value="cpu">CPU (fallback)</option>
              </select>
            </div>
          </div>
        </div>
      {/if}

      <!-- Dynamic Advanced Settings -->
      {#if ADVANCED_SETTINGS_SCHEMA[selectedModel]}
        {#each getSettingsGroups(selectedModel) as [groupName, settings]}
          <div class="advanced-group">
            <h5 class="group-title">{groupName}</h5>
            <div class="advanced-form-stack">
              {#each settings as setting, idx}
                {#if !setting.conditional || $advancedSettings[selectedModel]?.[setting.conditional.key] === setting.conditional.value}
                  <div class="setting-item">
                    {#if setting.type === 'boolean'}
                      <div class="checkbox-wrapper">
                        <input
                          id="setting-{selectedModel}-{setting.key}"
                          type="checkbox"
                          bind:checked={$advancedSettings[selectedModel][setting.key]}
                          disabled={running || concatenating}
                        />
                        <label for="setting-{selectedModel}-{setting.key}" class="checkbox-label">
                          <span class="label-text">{setting.label}</span>
                          {#if setting.description}
                            <p class="help-text">{setting.description}</p>
                          {/if}
                        </label>
                      </div>
                    {:else}
                      <div class="form-field">
                        <label for="setting-{selectedModel}-{setting.key}">
                          <span class="label-text">{setting.label}</span>
                          {#if setting.description}
                            <p class="help-text">{setting.description}</p>
                          {/if}
                        </label>

                        {#if setting.type === 'select'}
                          <select
                            id="setting-{selectedModel}-{setting.key}"
                            bind:value={$advancedSettings[selectedModel][setting.key]}
                            disabled={running || concatenating}
                          >
                            {#each setting.options || [] as opt}
                              <option value={opt.value}>{opt.label}</option>
                            {/each}
                          </select>
                        {:else if setting.type === 'slider'}
                          <div class="slider-container">
                            <input
                              id="setting-{selectedModel}-{setting.key}"
                              type="range"
                              min={setting.min}
                              max={setting.max}
                              step={setting.step}
                              bind:value={$advancedSettings[selectedModel][setting.key]}
                              disabled={running || concatenating}
                            />
                            <span class="value-display"
                              >{$advancedSettings[selectedModel][setting.key]}</span
                            >
                          </div>
                        {:else if setting.type === 'number'}
                          <input
                            id="setting-{selectedModel}-{setting.key}"
                            type="number"
                            min={setting.min}
                            max={setting.max}
                            step={setting.step}
                            bind:value={$advancedSettings[selectedModel][setting.key]}
                            disabled={running || concatenating}
                          />
                        {/if}
                      </div>
                    {/if}
                  </div>
                {/if}
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {/if}

  <!-- Action Buttons -->
  <div class="actions">
    {@const selectedChapters = getSelectedChapters()}
    {@const allGenerated =
      selectedChapters.length > 0 && selectedChapters.every((ch) => generatedChapters.has(ch.id))}

    <div class="button-group">
      <button
        class="primary"
        onclick={generateAudio}
        disabled={running || concatenating || selectedChapters.length === 0}
        aria-busy={running}
      >
        {running ? '⏳ Generating...' : '🎧 Generate Audio'}
      </button>

      <div class="export-group">
        <button
          class="secondary export-btn"
          onclick={exportAudio}
          disabled={running || concatenating || selectedChapters.length === 0}
          aria-busy={concatenating}
        >
          {concatenating
            ? '📦 Exporting...'
            : allGenerated
              ? `📥 Export ${selectedFormat.toUpperCase()}`
              : `⚡ Generate & Export ${selectedFormat.toUpperCase()}`}
        </button>
        <div class="export-menu-wrapper">
          <button
            class="secondary icon-btn"
            onclick={() => (showExportMenu = !showExportMenu)}
            disabled={running || concatenating}
            aria-label="Export options"
            aria-expanded={showExportMenu}
          >
            ⚙️
          </button>
          {#if showExportMenu}
            <!-- Backdrop to close menu -->
            <div
              class="menu-backdrop"
              onclick={() => (showExportMenu = false)}
              role="presentation"
            ></div>
            <div class="export-menu">
              <div class="menu-header">
                <span>Export Options</span>
                <button class="close-btn" onclick={() => (showExportMenu = false)}>×</button>
              </div>
              <div class="menu-list">
                <button class="menu-item" onclick={selectProcessedAndExport}>
                  <span class="icon">✅</span>
                  <span class="text">Select Processed & Export</span>
                </button>
              </div>
            </div>
          {/if}
        </div>
      </div>
    </div>
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
    border: 1px solid var(--border-color);
    padding: 20px;
    border-radius: 12px;
    margin-top: 16px;
    background: var(--surface-color);
    box-shadow: 0 2px 8px var(--shadow-color);
    transition:
      background-color 0.3s,
      border-color 0.3s;
  }

  .panel h3 {
    margin: 0 0 16px 0;
    color: var(--text-color);
    font-size: 20px;
  }

  .summary {
    margin-bottom: 16px;
    padding: 12px;
    background: var(--bg-color);
    border-radius: 8px;
  }

  .chapter-count {
    font-size: 14px;
    font-weight: 500;
    color: var(--secondary-text);
  }

  /* Form Card Styling - Better visual grouping */
  .form-card {
    background: var(--bg-color);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 20px;
    margin-bottom: 20px;
    transition: all 0.3s ease;
  }

  .form-card.primary-settings {
    border-left: 4px solid var(--primary-color);
  }

  .form-card.export-settings {
    border-left: 4px solid #0066cc;
  }

  .form-card.advanced-settings {
    border-left: 4px solid #666;
    background: linear-gradient(to right, var(--bg-color), var(--surface-color));
  }

  .card-title {
    margin: 0 0 18px 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-color);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  /* Form Grid - Responsive two-column on desktop */
  .form-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
  }

  @media (min-width: 768px) {
    .form-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  /* Form Field - Better label + input pairing */
  .form-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .form-field label {
    display: block;
  }

  .form-field.quality-field {
    grid-column: 1;
  }

  /* Help text - guidance below labels */
  .help-text {
    font-size: 13px;
    color: var(--secondary-text);
    margin: 0;
    font-weight: normal;
    line-height: 1.4;
  }

  .label-text {
    display: block;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color);
    margin-bottom: 4px;
  }

  /* Advanced group styling */
  .advanced-group {
    margin-bottom: 24px;
  }

  .advanced-group:last-child {
    margin-bottom: 0;
  }

  .advanced-form-stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .setting-item {
    width: 100%;
  }

  .group-title {
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--secondary-text);
    margin: 0 0 12px 0;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border-color);
  }

  .slider-container {
    display: flex;
    align-items: center;
    gap: 12px;
    background: rgba(0, 0, 0, 0.02);
    padding: 8px 12px;
    border-radius: 6px;
  }

  .slider-container input[type='range'] {
    flex: 1;
  }

  .value-display {
    min-width: 24px;
    text-align: right;
    font-weight: 600;
    color: var(--primary-color);
    font-family: monospace;
  }

  .checkbox-wrapper {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px;
    background: rgba(0, 0, 0, 0.02);
    border-radius: 8px;
    border: 1px solid var(--border-color);
    transition: all 0.2s;
    cursor: pointer;
  }

  .checkbox-wrapper:hover {
    background: rgba(0, 0, 0, 0.04);
    border-color: var(--primary-color);
  }

  .checkbox-wrapper input[type='checkbox'] {
    width: 18px;
    height: 18px;
    margin-top: 2px;
    cursor: pointer;
  }

  .checkbox-label {
    cursor: pointer;
    margin: 0 !important;
    flex: 1;
  }
  select,
  input[type='number'],
  input[type='range'] {
    width: 100%;
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: var(--text-color);
    font-size: 14px;
    font-family: inherit;
    transition:
      border-color 0.2s,
      box-shadow 0.2s;
  }

  select,
  input[type='number'] {
    cursor: pointer;
  }

  select:hover:not(:disabled),
  input[type='number']:hover:not(:disabled) {
    border-color: var(--primary-color);
  }

  select:focus,
  input[type='number']:focus {
    outline: none;
    border-color: var(--primary-color);
    box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.1);
  }

  select:disabled,
  input[type='number']:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    background: var(--bg-color);
  }

  /* Checkbox styling */
  .checkbox-wrapper {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
  }

  .checkbox-wrapper input[type='checkbox'] {
    width: 20px;
    height: 20px;
    cursor: pointer;
    accent-color: var(--primary-color);
  }

  .checkbox-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    cursor: pointer;
    flex: 1;
  }

  .checkbox-label .label-text {
    margin-bottom: 0;
  }

  /* Slider styling */
  .slider-container {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  input[type='range'] {
    flex: 1;
    height: 6px;
    padding: 0;
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
    background: var(--input-bg);
  }

  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--primary-color);
    cursor: pointer;
    transition: box-shadow 0.2s;
  }

  input[type='range']::-webkit-slider-thumb:hover {
    box-shadow: 0 0 0 6px rgba(76, 175, 80, 0.2);
  }

  input[type='range']::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--primary-color);
    cursor: pointer;
    border: none;
    transition: box-shadow 0.2s;
  }

  input[type='range']::-moz-range-thumb:hover {
    box-shadow: 0 0 0 6px rgba(76, 175, 80, 0.2);
  }

  .value-display {
    min-width: 40px;
    text-align: right;
    font-weight: 600;
    color: var(--text-color);
    font-size: 14px;
  }

  /* Advanced toggle button */
  .advanced-toggle {
    width: 100%;
    padding: 12px 16px;
    margin-bottom: 20px;
    background: var(--bg-color);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--secondary-text);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 10px;
    transition: all 0.2s;
  }

  .advanced-toggle:hover {
    background: var(--surface-color);
    border-color: var(--primary-color);
    color: var(--text-color);
  }

  .toggle-icon {
    font-size: 12px;
    transition: transform 0.2s;
    display: inline-block;
  }

  .setting-item {
    gap: 10px;
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

  .button-group {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1; /* Allow group to take available space */
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
    background: linear-gradient(135deg, var(--primary-color), var(--primary-hover));
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
    background: var(--surface-color);
    color: var(--secondary-text);
    border: 1px solid var(--input-border);
  }

  button.secondary:hover:not(:disabled) {
    background: var(--bg-color);
    border-color: var(--text-color);
    color: var(--text-color);
  }

  button.secondary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    background: var(--bg-color);
  }

  .download-section {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--border-color);
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

  .warning-message {
    background: #fff3cd;
    border: 1px solid #ffc107;
    color: #856404;
    padding: 12px;
    border-radius: 6px;
    margin-bottom: 12px;
    font-size: 14px;
    line-height: 1.5;
  }

  .export-group {
    display: flex;
    align-items: stretch;
  }

  /* Split Button Styling */
  .export-btn {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    border-right: 1px solid rgba(0, 0, 0, 0.1);
    margin-right: 0;
  }

  .icon-btn {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    padding: 0 10px;
    font-size: 16px;
    border-left: none; /* managed by export-btn border-right usually, or just visually merged */
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .export-menu-wrapper {
    position: relative;
  }

  /* Dropdown Menu - GitHub Style */
  .export-menu {
    position: absolute;
    bottom: 100%;
    right: 0;
    margin-bottom: 8px;
    background: #1c2128; /* Dark GitHub-like bg */
    border: 1px solid #444c56;
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    z-index: 1000;
    min-width: 250px;
    animation: fadeIn 0.1s ease-out;
    color: #adbac7; /* GitHub text color */
    overflow: hidden;
  }

  .menu-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 600;
    background: #2d333b; /* Slightly lighter header */
    border-bottom: 1px solid #444c56;
    color: #adbac7;
  }

  .close-btn {
    background: none;
    border: none;
    color: #adbac7;
    font-size: 16px;
    padding: 0;
    cursor: pointer;
    line-height: 1;
    width: auto;
    height: auto;
    opacity: 0.7;
  }

  .close-btn:hover {
    opacity: 1;
    background: none;
  }

  .menu-list {
    padding: 4px 0;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    background: transparent;
    color: #adbac7;
    padding: 8px 16px;
    border: none;
    border-radius: 0;
    font-size: 14px;
    font-weight: normal;
    cursor: pointer;
  }

  .menu-item:hover {
    background: #316dca; /* GitHub selection blue */
    color: white;
  }

  .menu-item .icon {
    font-size: 16px;
    min-width: 20px;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .menu-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 999;
  }

  /* Light mode override for split button borders if needed, 
     though usually secondary buttons handle it. 
     For the menu, GitHub usually implies strict design, but let's support light mode variables if app is light. 
  */
  @media (prefers-color-scheme: light) {
    .export-menu {
      background: #ffffff;
      border-color: #d0d7de;
      color: #24292f;
    }
    .menu-header {
      background: #f6f8fa;
      border-bottom-color: #d0d7de;
      color: #24292f;
    }
    .close-btn {
      color: #57606a;
    }
    .menu-item {
      color: #24292f;
    }
    .menu-item:hover {
      background: #0969da;
      color: white;
    }
  }
</style>
