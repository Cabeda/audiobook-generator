<script lang="ts">
  import { onMount } from 'svelte'
  import { fade, fly } from 'svelte/transition'
  import { get } from 'svelte/store'
  import {
    book,
    selectedChapters,
    chapterStatus,
    chapterErrors,
    chapterProgress,
    generatedAudio,
    selectedChapterIds,
  } from '../stores/bookStore'
  import {
    selectedModel as selectedModelStore,
    selectedVoice,
    availableVoices,
    selectedQuantization,
    selectedDevice,
    voiceLabels,
    advancedSettings,
  } from '../stores/ttsStore'
  import { toastStore } from '../stores/toastStore'
  import { generationService } from '../lib/services/generationService'
  import { TTS_MODELS } from '../lib/tts/ttsModels'
  import ChapterItem from './ChapterItem.svelte'
  import type { Chapter } from '../lib/types/book'
  import type { LibraryBook } from '../lib/libraryDB'
  import {
    countWords,
    estimateSpeechDurationSeconds,
    formatDurationShort,
  } from '../lib/utils/textStats'
  import { ADVANCED_SETTINGS_SCHEMA } from '../lib/types/settings'

  let { onread }: { onread: (detail: { chapter: Chapter }) => void } = $props()

  // Helper to group settings
  function getSettingsGroups(model: string) {
    const schema = ADVANCED_SETTINGS_SCHEMA[model] || []
    const groups: Record<string, typeof schema> = {}

    schema.forEach((setting) => {
      const groupName = setting.group || 'General'
      if (!groups[groupName]) groups[groupName] = []
      groups[groupName].push(setting)
    })

    // Sort groups to ensure consistent order
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

  /**
   * Type guard to check if a book is a LibraryBook with an ID
   */
  function isLibraryBook(book: any): book is LibraryBook & { id: number } {
    return (
      book !== null &&
      typeof book === 'object' &&
      typeof book.id === 'number' &&
      typeof book.title === 'string' &&
      typeof book.author === 'string' &&
      typeof book.dateAdded === 'number' &&
      typeof book.lastAccessed === 'number' &&
      Array.isArray(book.chapters)
    )
  }

  const numberFormatter = new Intl.NumberFormat()

  // Local state for UI
  let showSettings = $state(false)
  let isGenerating = $state(false)
  let showAdvanced = $state(false)
  let selectedFormat = $state<'mp3' | 'mp4' | 'm4b' | 'wav' | 'epub'>('mp3')
  let selectedBitrate = $state(192)

  let selectedModel = $derived($selectedModelStore)
  let currentBook = $derived($book)
  let statusMap = $derived($chapterStatus)
  let errorsMap = $derived($chapterErrors)
  let audioMap = $derived($generatedAudio)
  let selections = $derived($selectedChapters)
  let totalWords = $derived(
    currentBook ? currentBook.chapters.reduce((sum, ch) => sum + countWords(ch.content), 0) : 0
  )
  let estimatedBookDurationSeconds = $derived(estimateSpeechDurationSeconds(totalWords))
  let hasExportableChapters = $derived(
    currentBook
      ? currentBook.chapters.some((c) => selections.get(c.id) && statusMap.get(c.id) === 'done')
      : false
  )

  // Actions
  function toggleChapter(id: string) {
    selectedChapters.update((m) => {
      const newMap = new Map(m)
      newMap.set(id, !newMap.get(id))
      return newMap
    })
  }

  async function handleModelChange(chapterId: string, model: string | undefined) {
    if (currentBook && isLibraryBook(currentBook)) {
      const { updateChapterModel } = await import('../lib/libraryDB')
      try {
        await updateChapterModel(currentBook.id, chapterId, model)
        // Update local state
        book.update((b) => {
          if (b) {
            const chapterIndex = b.chapters.findIndex((c) => c.id === chapterId)
            if (chapterIndex !== -1) {
              b.chapters[chapterIndex].model = model
            }
          }
          return b
        })
        const modelName = model ? TTS_MODELS.find((m) => m.id === model)?.name || model : 'default'
        toastStore.success(model ? `Model set to ${modelName}` : 'Model reset to default')
      } catch (error) {
        toastStore.error(`Failed to update chapter model: ${error}`)
      }
    }
  }

  async function handleVoiceChange(chapterId: string, voice: string | undefined) {
    if (currentBook && isLibraryBook(currentBook)) {
      const { updateChapterVoice } = await import('../lib/libraryDB')
      try {
        await updateChapterVoice(currentBook.id, chapterId, voice)
        // Update local state
        book.update((b) => {
          if (b) {
            const chapterIndex = b.chapters.findIndex((c) => c.id === chapterId)
            if (chapterIndex !== -1) {
              b.chapters[chapterIndex].voice = voice
            }
          }
          return b
        })
        const voiceLabel = voice
          ? get(availableVoices).find((v) => v.id === voice)?.label || voiceLabels[voice] || voice
          : 'auto-select'
        toastStore.success(voice ? `Voice set to ${voiceLabel}` : 'Voice reset to auto-select')
      } catch (error) {
        toastStore.error(`Failed to update chapter voice: ${error}`)
      }
    }
  }

  async function handleLanguageChange(chapterId: string, language: string | undefined) {
    if (currentBook && isLibraryBook(currentBook)) {
      const { updateChapterLanguage } = await import('../lib/libraryDB')
      try {
        await updateChapterLanguage(currentBook.id, chapterId, language)
        // Update local state
        book.update((b) => {
          if (b) {
            const chapterIndex = b.chapters.findIndex((c) => c.id === chapterId)
            if (chapterIndex !== -1) {
              b.chapters[chapterIndex].language = language
            }
          }
          return b
        })
        const { getLanguageLabel } = await import('../lib/utils/languageResolver')
        const languageLabel = language ? getLanguageLabel(language) : 'auto-detect'
        toastStore.success(
          language ? `Language set to ${languageLabel}` : 'Language reset to auto-detect'
        )
      } catch (error) {
        toastStore.error(`Failed to update chapter language: ${error}`)
      }
    }
  }

  function selectAll() {
    if (!$book) return
    selectedChapters.update((m) => {
      const newMap = new Map(m)
      $book!.chapters.forEach((c) => newMap.set(c.id, true))
      return newMap
    })
  }

  function deselectAll() {
    if (!$book) return
    selectedChapters.update((m) => {
      const newMap = new Map(m)
      $book!.chapters.forEach((c) => newMap.set(c.id, false))
      return newMap
    })
  }

  function selectOnlyChapter(chapterId: string) {
    if (!$book) return
    selectedChapters.update((m) => {
      const newMap = new Map(m)
      // Deselect all chapters
      $book!.chapters.forEach((c) => newMap.set(c.id, false))
      // Select only the target chapter
      newMap.set(chapterId, true)
      return newMap
    })
    // Automatically start generation after selection
    setTimeout(() => handleGenerate(), 100)
  }

  async function handleGenerate() {
    if (!$book) return

    // Get selected chapters
    const chaptersToGen = $book.chapters.filter((c) => selections.get(c.id))
    if (chaptersToGen.length === 0) {
      toastStore.warning('No chapters selected')
      return
    }

    isGenerating = true
    try {
      await generationService.generateChapters(chaptersToGen)
    } finally {
      isGenerating = false
    }
  }

  function handleCancel() {
    generationService.cancel()
    isGenerating = false
  }

  function handleCancelChapter(id: string) {
    generationService.cancelChapter(id)
  }

  function handleRetry(id: string) {
    if (!$book) return
    const ch = $book.chapters.find((c) => c.id === id)
    if (ch) {
      generationService.generateChapters([ch])
    }
  }

  async function handleExport() {
    if (!$book) return
    // Export all selected that are done
    const relevantChapters = $book.chapters.filter(
      (c) => selections.get(c.id) && statusMap.get(c.id) === 'done'
    )
    if (relevantChapters.length === 0) {
      toastStore.warning('No completed chapters selected for export')
      return
    }

    if (selectedFormat === 'epub') {
      // EPUB with Media Overlays
      await generationService.exportEpub(relevantChapters, {
        title: $book.title,
        author: $book.author,
        // Cover is optional in Book type
      })
    } else {
      // Audio formats (mp3, mp4, m4b, wav)
      await generationService.exportAudio(
        relevantChapters,
        selectedFormat as any,
        selectedBitrate,
        {
          title: $book.title,
          author: $book.author,
        }
      )
    }
  }

  function handleRead(chapter: Chapter) {
    onread({ chapter })
  }

  async function handleDownload(chapterId: string, format: 'wav' | 'mp3' | 'm4b' | 'mp4') {
    const audioData = audioMap.get(chapterId)
    const chapter = $book?.chapters.find((c) => c.id === chapterId)

    if (!audioData || !chapter) {
      toastStore.error('No audio data available for this chapter')
      return
    }

    try {
      toastStore.info(`Preparing ${format.toUpperCase()} download...`)

      let downloadBlob = audioData.blob

      // Convert if needed
      if (format !== 'wav') {
        const { concatenateAudioChapters } = await import('../lib/audioConcat')
        const converted = await concatenateAudioChapters(
          [{ id: chapter.id, title: chapter.title, blob: audioData.blob }],
          { format, bitrate: selectedBitrate },
          (progress) => {
            if (progress.message) {
              toastStore.info(progress.message)
            }
          }
        )
        downloadBlob = converted
      }

      const { downloadAudioFile } = await import('../lib/audioConcat')
      const ext =
        format === 'm4b' ? 'm4b' : format === 'mp4' ? 'mp4' : format === 'mp3' ? 'mp3' : 'wav'
      const safeTitle = chapter.title.replace(/[^a-z0-9]/gi, '_')
      downloadAudioFile(downloadBlob, `${safeTitle}.${ext}`)

      toastStore.success(`Downloaded ${chapter.title} as ${format.toUpperCase()}`)
    } catch (error) {
      toastStore.error(
        `Download failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }
</script>

<div class="book-view" in:fade>
  {#if currentBook}
    <!-- Hero Header -->
    <div class="hero-header">
      <div class="hero-bg" style="background-image: url({currentBook.cover || ''})"></div>
      <div class="hero-content">
        <div class="cover-wrapper">
          {#if currentBook.cover}
            <img src={currentBook.cover} alt={currentBook.title} class="book-cover" />
          {:else}
            <div class="book-cover placeholder">📚</div>
          {/if}
        </div>
        <div class="book-info">
          <h1>{currentBook.title}</h1>
          <p class="author">by {currentBook.author}</p>
          <div class="meta-badges">
            {#if currentBook.format}
              <span class="badge">{currentBook.format.toUpperCase()}</span>
            {/if}
            <span class="badge">{currentBook.chapters.length} Chapters</span>
            <span class="badge">{numberFormatter.format(totalWords)} words</span>
            <span class="badge">~{formatDurationShort(estimatedBookDurationSeconds)}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="toolbar">
      <div class="toolbar-left">
        <select bind:value={$selectedModelStore} disabled={isGenerating} class="premium-select">
          {#each TTS_MODELS as model}
            <option value={model.id}>{model.name}</option>
          {/each}
        </select>

        <select bind:value={$selectedVoice} disabled={isGenerating} class="premium-select">
          {#each $availableVoices as voice}
            <option value={voice.id}>{voice.label}</option>
          {/each}
        </select>
      </div>

      <div class="toolbar-right">
        {#if isGenerating}
          <button class="cancel-btn" onclick={handleCancel}>Cancel</button>
        {/if}
        <button
          class="primary-btn"
          class:loading={isGenerating}
          disabled={isGenerating}
          onclick={handleGenerate}
        >
          {#if isGenerating}
            Generating...
          {:else}
            Generate Selected
          {/if}
        </button>
        {#if hasExportableChapters}
          <button
            class="export-primary-btn"
            onclick={handleExport}
            disabled={isGenerating}
            title="Export as {selectedFormat.toUpperCase()}"
          >
            Export {selectedFormat.toUpperCase()}
          </button>
        {/if}
      </div>
    </div>

    <!-- Chapter selection + advanced toggle -->
    <div class="sub-toolbar">
      <div class="selection-actions">
        <button class="text-btn" onclick={selectAll}>Select All</button>
        <button class="text-btn" onclick={deselectAll}>Deselect All</button>
      </div>
      <button class="text-btn" onclick={() => (showAdvanced = !showAdvanced)}>
        {showAdvanced ? '▾' : '▸'} Advanced
      </button>
    </div>

    {#if showAdvanced}
      <div class="advanced-panel">
        <div class="setting-group">
          <h4 class="setting-group-title">Export</h4>
          <div class="setting-row">
            <label for="adv-format">
              <span class="setting-label">Format</span>
            </label>
            <select
              id="adv-format"
              bind:value={selectedFormat}
              disabled={isGenerating}
              class="premium-select"
            >
              <option value="mp3">MP3</option>
              <option value="mp4">MP4 (Chapters)</option>
              <option value="m4b">M4B (Audiobook)</option>
              <option value="wav">WAV</option>
              <option value="epub">EPUB (Media Overlays)</option>
            </select>
          </div>
          <div class="setting-row">
            <label for="adv-bitrate">
              <span class="setting-label">Quality (Bitrate)</span>
            </label>
            <select id="adv-bitrate" bind:value={selectedBitrate} class="premium-select">
              <option value={128}>128 kbps</option>
              <option value={192}>192 kbps</option>
              <option value={256}>256 kbps</option>
              <option value={320}>320 kbps</option>
            </select>
          </div>
          <button class="text-btn export-btn" onclick={handleExport} disabled={isGenerating}>
            Export
          </button>
        </div>

        <div class="setting-group">
          <h4 class="setting-group-title">Device & Precision</h4>
          {#if $selectedModelStore === 'kokoro'}
            <div class="setting-row">
              <label for="adv-device">
                <span class="setting-label">Execution Device</span>
              </label>
              <select
                id="adv-device"
                bind:value={$selectedDevice}
                disabled={isGenerating}
                class="premium-select"
              >
                <option value="auto">Auto (Best)</option>
                <option value="webgpu">WebGPU (Fast)</option>
                <option value="wasm">WASM (CPU)</option>
              </select>
            </div>
            <div class="setting-row">
              <label for="adv-quant">
                <span class="setting-label">Quantization</span>
                <small class="setting-desc">Model precision. FP32 is best, Q4 is fastest.</small>
              </label>
              <select id="adv-quant" bind:value={$selectedQuantization} class="premium-select">
                <option value="fp32">FP32 (Best Quality)</option>
                <option value="fp16">FP16 (Balanced)</option>
                <option value="q8">Q8 (Faster)</option>
                <option value="q4">Q4 (Fastest)</option>
              </select>
            </div>
          {:else}
            <p class="setting-desc">
              Device and quantization options are only available for the Kokoro model.
            </p>
          {/if}
        </div>

        {#if ADVANCED_SETTINGS_SCHEMA[$selectedModelStore]}
          {#each getSettingsGroups($selectedModelStore) as [groupName, settings]}
            <div class="setting-group">
              <h4 class="setting-group-title">{groupName}</h4>
              {#each settings as setting, idx}
                {#if !setting.conditional || $advancedSettings[$selectedModelStore]?.[setting.conditional.key] === setting.conditional.value}
                  {#if setting.type === 'boolean'}
                    <label class="checkbox-row" for={`adv-${$selectedModelStore}-${setting.key}`}>
                      <input
                        id={`adv-${$selectedModelStore}-${setting.key}`}
                        type="checkbox"
                        bind:checked={$advancedSettings[$selectedModelStore][setting.key]}
                        disabled={isGenerating}
                      />
                      <div class="checkbox-text">
                        <span>{setting.label}</span>
                        {#if setting.description}
                          <small>{setting.description}</small>
                        {/if}
                      </div>
                    </label>
                  {:else}
                    <div class="setting-row">
                      <label for={`adv-${$selectedModelStore}-${setting.key}`}>
                        <span class="setting-label">{setting.label}</span>
                        {#if setting.description}
                          <small class="setting-desc">{setting.description}</small>
                        {/if}
                      </label>

                      {#if setting.type === 'select'}
                        <select
                          id={`adv-${$selectedModelStore}-${setting.key}`}
                          bind:value={$advancedSettings[$selectedModelStore][setting.key]}
                          disabled={isGenerating}
                          class="premium-select"
                        >
                          {#each setting.options || [] as opt}
                            <option value={opt.value}>{opt.label}</option>
                          {/each}
                        </select>
                      {:else if setting.type === 'slider'}
                        <div class="slider-container">
                          <input
                            id={`adv-${$selectedModelStore}-${setting.key}`}
                            type="range"
                            min={setting.min}
                            max={setting.max}
                            step={setting.step}
                            bind:value={$advancedSettings[$selectedModelStore][setting.key]}
                            disabled={isGenerating}
                          />
                          <span class="value-display"
                            >{$advancedSettings[$selectedModelStore][setting.key]}</span
                          >
                        </div>
                      {:else if setting.type === 'number'}
                        <input
                          id={`adv-${$selectedModelStore}-${setting.key}`}
                          type="number"
                          min={setting.min}
                          max={setting.max}
                          step={setting.step}
                          bind:value={$advancedSettings[$selectedModelStore][setting.key]}
                          disabled={isGenerating}
                          class="premium-input"
                        />
                      {/if}
                    </div>
                  {/if}
                {/if}
              {/each}
            </div>
          {/each}
        {/if}
      </div>
    {/if}

    <!-- Chapter List -->
    <div class="content-area">
      <div class="chapter-list">
        {#each currentBook.chapters as chapter (chapter.id)}
          <ChapterItem
            {chapter}
            book={currentBook}
            selected={selections.get(chapter.id)}
            status={statusMap.get(chapter.id)}
            error={errorsMap.get(chapter.id)}
            progress={$chapterProgress.get(chapter.id)}
            audioData={audioMap.get(chapter.id)}
            onToggle={toggleChapter}
            onRead={handleRead}
            onRetry={handleRetry}
            onCancel={handleCancelChapter}
            onDownload={handleDownload}
            onModelChange={handleModelChange}
            onVoiceChange={handleVoiceChange}
            onLanguageChange={handleLanguageChange}
            onSelectOnly={selectOnlyChapter}
          />
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .book-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    gap: 24px;
    padding-bottom: 80px; /* Space for player bar */
  }

  /* Hero Header */
  .hero-header {
    position: relative;
    padding: 40px;
    border-radius: 20px;
    overflow: hidden;
    color: white;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    min-height: 200px;
  }

  .hero-bg {
    position: absolute;
    inset: 0;
    background-size: cover;
    background-position: center;
    filter: blur(20px) brightness(0.4);
    z-index: 0;
  }

  .hero-content {
    position: relative;
    z-index: 1;
    display: flex;
    gap: 32px;
    align-items: flex-end;
  }

  .book-cover {
    width: 140px;
    height: 210px;
    object-fit: cover;
    border-radius: 8px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
    border: 2px solid rgba(255, 255, 255, 0.1);
  }

  .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 3rem;
    background: rgba(255, 255, 255, 0.1);
  }

  .book-info h1 {
    font-size: 2.5rem;
    font-weight: 800;
    margin: 0 0 8px 0;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    line-height: 1.1;
  }

  .author {
    font-size: 1.2rem;
    opacity: 0.9;
    margin: 0 0 16px 0;
  }

  .meta-badges {
    display: flex;
    gap: 12px;
  }

  .badge {
    background: rgba(255, 255, 255, 0.2);
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 0.9rem;
    font-weight: 500;
  }

  /* Toolbar */
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-radius: 12px;
    gap: 12px;
    flex-wrap: wrap;
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .toolbar-left {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .toolbar-right {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .sub-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 4px;
  }

  .selection-actions {
    display: flex;
    gap: 4px;
  }

  .premium-select {
    background: var(--bg-color);
    color: var(--text-color);
    border: 1px solid var(--border-color);
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 0.95rem;
    min-width: 150px;
    cursor: pointer;
  }

  /* Buttons */
  .primary-btn {
    background: var(--primary-color);
    color: var(--bg-color);
    border: none;
    padding: 10px 24px;
    border-radius: 10px;
    font-weight: 600;
    font-size: 1rem;
    cursor: pointer;
    transition:
      background-color 0.2s,
      box-shadow 0.2s;
    box-shadow: 0 4px 12px var(--shadow-color);
  }

  .primary-btn:hover:not(:disabled) {
    background: var(--primary-hover);
    box-shadow: 0 6px 16px var(--shadow-color);
  }

  .primary-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
    filter: grayscale(0.5);
  }

  .export-primary-btn {
    background: var(--success-color, #22c55e);
    color: white;
    border: none;
    padding: 10px 24px;
    border-radius: 10px;
    font-weight: 600;
    font-size: 1rem;
    cursor: pointer;
    transition:
      background-color 0.2s,
      box-shadow 0.2s;
    box-shadow: 0 4px 12px var(--shadow-color);
  }

  .export-primary-btn:hover:not(:disabled) {
    background: var(--success-hover, #16a34a);
    box-shadow: 0 6px 16px var(--shadow-color);
  }

  .export-primary-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
    filter: grayscale(0.5);
  }

  .text-btn {
    background: none;
    border: none;
    color: var(--secondary-text);
    padding: 8px 12px;
    cursor: pointer;
    font-weight: 500;
    transition: color 0.2s;
  }

  .text-btn:hover {
    color: var(--text-color);
    background: var(--bg-color);
    border-radius: 6px;
  }

  /* Loading state */
  .loading {
    position: relative;
    overflow: hidden;
  }

  /* Content */
  .content-area {
    padding: 0 8px;
  }

  .chapter-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .setting-row {
    margin-bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }

  .setting-label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-weight: 600;
    color: var(--text-color);
    font-size: 0.95rem;
  }

  .setting-desc {
    display: block;
    color: var(--secondary-text);
    font-size: 0.8rem;
    font-weight: normal;
    line-height: 1.4;
  }

  .slider-container {
    display: flex;
    align-items: center;
    gap: 16px;
    background: var(--feature-bg);
    padding: 12px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
  }

  .slider-container input[type='range'] {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    accent-color: var(--primary-color);
  }

  .value-display {
    min-width: 32px;
    text-align: center;
    font-weight: 700;
    color: var(--primary-color);
    background: var(--selected-bg);
    padding: 2px 8px;
    border-radius: 4px;
    font-family: monospace;
  }

  .premium-input {
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    color: var(--text-color);
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 14px;
    width: 100%;
    transition: border-color 0.2s;
  }

  .premium-input:focus {
    border-color: var(--primary-color);
    outline: none;
  }

  @media (max-width: 768px) {
    .hero-header {
      padding: 16px;
      min-height: auto;
      text-align: center;
    }
    .hero-bg {
      display: none;
    }
    .hero-header {
      background: var(--surface-color);
      color: var(--text-color);
      box-shadow: 0 4px 12px var(--shadow-color);
    }
    .hero-content {
      flex-direction: row;
      align-items: center;
      gap: 12px;
      text-align: left;
    }
    .book-cover {
      width: 60px;
      height: 90px;
      box-shadow: 0 4px 8px var(--shadow-color);
      border: 1px solid var(--border-color);
    }
    .placeholder {
      font-size: 1.5rem;
    }
    .book-info h1 {
      font-size: 1.3rem;
      font-weight: 700;
      text-shadow: none;
    }
    .author {
      font-size: 0.85rem;
      margin: 0 0 8px 0;
    }
    .meta-badges {
      flex-wrap: wrap;
      gap: 6px;
    }
    .badge {
      font-size: 0.75rem;
      padding: 3px 8px;
      background: var(--feature-bg);
      color: var(--secondary-text);
    }
    .toolbar {
      flex-direction: column;
      align-items: stretch;
    }
    .toolbar-left {
      flex-direction: column;
    }
  }

  .advanced-panel {
    margin: 0 8px 16px 8px;
    padding: 20px;
    border-radius: 12px;
    background: var(--feature-bg);
    border: 1px solid var(--border-color);
  }

  .setting-group-title {
    font-size: 1.1rem;
    font-weight: 700;
    margin: 24px 0 12px 0;
    color: var(--text-color);
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 8px;
    width: 100%;
  }

  .setting-group-title:first-child {
    margin-top: 0;
  }

  .checkbox-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px;
    border-radius: 8px;
    cursor: pointer;
    transition: background-color 0.2s;
    background: var(--feature-bg);
    border: 1px solid var(--border-color);
    margin-bottom: 8px;
  }

  .checkbox-row:hover {
    background: var(--selected-bg);
  }

  .checkbox-row input[type='checkbox'] {
    width: 18px;
    height: 18px;
    margin-top: 2px;
    cursor: pointer;
    accent-color: var(--primary-color);
  }

  .checkbox-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .checkbox-text span {
    font-weight: 600;
    font-size: 0.95rem;
  }

  .checkbox-text small {
    display: block;
    opacity: 0.7;
    font-size: 0.8rem;
    line-height: 1.4;
  }

  .setting-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 20px;
  }

  .cancel-btn {
    background: var(--error-bg);
    color: var(--error-text);
    border: 1px solid var(--error-border);
    padding: 8px 16px;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 500;
    transition:
      background-color 0.2s,
      color 0.2s;
  }

  .cancel-btn:hover {
    background: var(--error-color);
    color: var(--bg-color);
  }
</style>
