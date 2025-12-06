<script lang="ts">
  import { onMount } from 'svelte'
  import { fade, fly } from 'svelte/transition'
  import {
    book,
    selectedChapters,
    chapterStatus,
    chapterErrors,
    generatedAudio,
    selectedChapterIds,
  } from '../stores/bookStore'
  import {
    selectedModel,
    selectedVoice,
    availableVoices,
    selectedQuantization,
    selectedDevice,
    voiceLabels,
  } from '../stores/ttsStore'
  import { generationService } from '../lib/services/generationService'
  import { TTS_MODELS } from '../lib/tts/ttsModels'
  import ChapterItem from './ChapterItem.svelte'
  import { createEventDispatcher } from 'svelte'
  import type { Chapter } from '../lib/types/book'

  const dispatch = createEventDispatcher()

  // Local state for UI
  let showSettings = $state(false)
  let isGenerating = $state(false)

  // Derived state from stores
  let currentBook = $derived($book)
  let statusMap = $derived($chapterStatus)
  let errorsMap = $derived($chapterErrors)
  let audioMap = $derived($generatedAudio)
  let selections = $derived($selectedChapters)

  // Actions
  function toggleChapter(id: string) {
    selectedChapters.update((m) => {
      const newMap = new Map(m)
      newMap.set(id, !newMap.get(id))
      return newMap
    })
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

  async function handleGenerate() {
    if (!$book) return

    // Get selected chapters
    const chaptersToGen = $book.chapters.filter((c) => selections.get(c.id))
    if (chaptersToGen.length === 0) {
      alert('No chapters selected')
      return
    }

    isGenerating = true
    try {
      await generationService.generateChapters(chaptersToGen)
    } finally {
      isGenerating = false
    }
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
      alert('No completed chapters selected for export')
      return
    }

    // Default to MP3 192kbps for now (simplified)
    // Could add a dropdown for format later
    await generationService.exportAudio(relevantChapters, 'mp3', 192, {
      title: $book.title,
      author: $book.author,
    })
  }

  function handleRead(chapter: Chapter) {
    dispatch('read', { chapter })
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
          </div>
        </div>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="toolbar glass-panel">
      <div class="toolbar-left">
        <button class="text-btn" onclick={selectAll}>Select All</button>
        <button class="text-btn" onclick={deselectAll}>Deselect All</button>
      </div>

      <div class="toolbar-center">
        <div class="quick-settings">
          <select bind:value={$selectedModel} disabled={isGenerating} class="premium-select">
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
      </div>

      <div class="toolbar-right">
        <button class="text-btn export-btn" onclick={handleExport}> 📥 Export MP3 </button>
        <button
          class="primary-btn generate-btn"
          class:loading={isGenerating}
          disabled={isGenerating}
          onclick={handleGenerate}
        >
          {#if isGenerating}
            Generating...
          {:else}
            ✨ Generate Selected
          {/if}
        </button>
      </div>
    </div>

    <!-- Chapter List -->
    <div class="content-area">
      <div class="chapter-list">
        {#each currentBook.chapters as chapter (chapter.id)}
          <ChapterItem
            {chapter}
            selected={selections.get(chapter.id)}
            status={statusMap.get(chapter.id)}
            error={errorsMap.get(chapter.id)}
            audioData={audioMap.get(chapter.id)}
            onToggle={toggleChapter}
            onRead={handleRead}
            onRetry={handleRetry}
            onDownloadWav={() => {}}
            onDownloadMp3={() => {}}
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
    backdrop-filter: blur(10px);
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
    padding: 16px 24px;
    border-radius: 12px;
    gap: 20px;
    flex-wrap: wrap;
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .quick-settings {
    display: flex;
    gap: 12px;
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
    background: #646cff; /* Fallback */
    background: linear-gradient(135deg, #646cff 0%, #9f5afd 100%);
    color: white;
    border: none;
    padding: 10px 24px;
    border-radius: 10px;
    font-weight: 600;
    font-size: 1rem;
    cursor: pointer;
    transition:
      transform 0.2s,
      box-shadow 0.2s;
    box-shadow: 0 4px 12px rgba(100, 108, 255, 0.3);
  }

  .primary-btn:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(100, 108, 255, 0.4);
  }

  .primary-btn:disabled {
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

  @media (max-width: 768px) {
    .hero-header {
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    .hero-content {
      flex-direction: column;
      align-items: center;
    }
    .toolbar {
      flex-direction: column;
      align-items: stretch;
    }
    .quick-settings {
      flex-direction: column;
    }
  }
</style>
