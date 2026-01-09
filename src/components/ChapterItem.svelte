<script lang="ts">
  import type { Chapter } from '../lib/types/book'
  import type { Book } from '../lib/types/book'
  import {
    countWords,
    estimateSpeechDurationSeconds,
    formatDurationShort,
  } from '../lib/utils/textStats'
  import { toastStore } from '../stores/toastStore'
  import {
    selectedModel,
    selectedVoice,
    availableVoices,
    voiceLabels,
    type VoiceOption,
  } from '../stores/ttsStore'
  import { TTS_MODELS } from '../lib/tts/ttsModels'
  import { segmentProgress, segmentProgressPercentage } from '../stores/segmentProgressStore'
  import {
    LANGUAGE_OPTIONS,
    getLanguageLabel,
    resolveChapterLanguageWithDetection,
    DETECTION_CONFIDENCE_THRESHOLD,
  } from '../lib/utils/languageResolver'
  import {
    getKokoroVoicesForLanguage,
    getPiperVoicesForLanguage,
    isKokoroLanguageSupported,
  } from '../lib/utils/voiceSelector'
  import { listVoices as listKokoroVoices } from '../lib/kokoro/kokoroClient'
  import { onMount } from 'svelte'

  let {
    chapter,
    book,
    selected = false,
    audioData = undefined,
    onToggle,
    onRead,
    onDownload,
    status,
    error,
    onRetry,
    progress,
    onModelChange,
    onVoiceChange,
    onLanguageChange,
  } = $props<{
    chapter: Chapter
    book?: Book
    selected?: boolean
    audioData?: { url: string; blob: Blob }
    status?: 'pending' | 'processing' | 'done' | 'error'
    error?: string | null
    onToggle: (id: string) => void
    onRead: (chapter: Chapter) => void
    onDownload: (id: string, format: 'wav' | 'mp3' | 'm4b' | 'mp4') => void
    onRetry?: (id: string) => void
    progress?: { current: number; total: number; message?: string }
    onModelChange?: (chapterId: string, model: string | undefined) => void
    onVoiceChange?: (chapterId: string, voice: string | undefined) => void
    onLanguageChange?: (chapterId: string, language: string | undefined) => void
  }>()

  const numberFormatter = new Intl.NumberFormat()
  let wordCount = $derived(countWords(chapter.content))
  let estimatedDurationSeconds = $derived(estimateSpeechDurationSeconds(wordCount))
  let showAdvanced = $state(false)

  // Segment progress for this chapter
  let chapterSegmentProgress = $derived($segmentProgress.get(chapter.id))
  let segmentPercentage = $derived($segmentProgressPercentage.get(chapter.id) ?? 0)
  // A chapter is "partially generated" only if generation is NOT currently in progress
  // and there are some (but not all) segments generated. This differentiates between:
  // 1. Currently generating with partial progress (shown in processing state above)
  // 2. Paused/incomplete generation from a previous session (shown below as partial progress)
  let isPartiallyGenerated = $derived(
    chapterSegmentProgress &&
      !chapterSegmentProgress.isGenerating &&
      chapterSegmentProgress.generatedIndices.size > 0 &&
      chapterSegmentProgress.generatedIndices.size < chapterSegmentProgress.totalSegments
  )

  // Local state for chapter overrides
  let chapterModel = $state(chapter.model)
  let chapterVoice = $state(chapter.voice)
  let chapterLanguage = $state(chapter.language)

  // Piper voices with full metadata (loaded async)
  let piperVoicesWithMetadata = $state<
    Array<{ key: string; name: string; language: string; quality: string }>
  >([])
  let piperVoicesLoadAttempted = $state(false)

  // Load piper voices on mount (once)
  onMount(() => {
    if (!piperVoicesLoadAttempted) {
      piperVoicesLoadAttempted = true
      import('../lib/piper/piperClient')
        .then(({ PiperClient }) => {
          return PiperClient.getInstance().getVoices()
        })
        .then((voices) => {
          piperVoicesWithMetadata = voices
        })
        .catch((error) => {
          console.error('Failed to load Piper voices:', error)
        })
    }
  })

  // Update local state when chapter prop changes
  $effect(() => {
    chapterModel = chapter.model
    chapterVoice = chapter.voice
    chapterLanguage = chapter.language
  })

  // Compute the effective language for this chapter
  let effectiveLanguage = $derived(book ? resolveChapterLanguageWithDetection(chapter, book) : 'en')

  // Compute the effective model (with automatic fallback if language not supported)
  let effectiveModel = $derived.by(() => {
    const baseModel = chapterModel || $selectedModel
    // If Kokoro is selected but doesn't support the language, fallback to Piper
    if (baseModel === 'kokoro' && !isKokoroLanguageSupported(effectiveLanguage)) {
      return 'piper'
    }
    return baseModel
  })

  // Is this a fallback from the user's choice?
  let isModelFallback = $derived(
    (chapterModel || $selectedModel) === 'kokoro' && effectiveModel === 'piper'
  )

  // Compute available voices for the effective model and language
  let chapterAvailableVoices = $derived.by(() => {
    if (effectiveModel === 'kokoro') {
      const kokoroVoices = listKokoroVoices()
      const languageVoices = getKokoroVoicesForLanguage(effectiveLanguage)
      // Only show voices that support the effective language
      return kokoroVoices
        .filter((v) => languageVoices.includes(v))
        .map((v) => ({ id: v, label: voiceLabels[v] || v }))
    } else if (effectiveModel === 'piper') {
      // Filter piper voices by language using metadata
      if (piperVoicesWithMetadata.length > 0) {
        const matchingVoices = getPiperVoicesForLanguage(effectiveLanguage, piperVoicesWithMetadata)
        return matchingVoices.map((v) => ({ id: v.key, label: v.name }))
      }
      return []
    }
    return []
  })

  // Compute the effective voice (auto-select first available if current is invalid)
  let effectiveVoice = $derived.by(() => {
    if (chapterVoice) {
      // Check if the chapter's voice is valid for the effective model
      const isValid = chapterAvailableVoices.some((v) => v.id === chapterVoice)
      if (isValid) {
        return chapterVoice
      }
    }
    // Auto-select: pick first voice for the language
    if (chapterAvailableVoices.length > 0) {
      return chapterAvailableVoices[0].id
    }
    return $selectedVoice
  })

  function copy() {
    navigator.clipboard
      ?.writeText(chapter.content)
      .catch(() => toastStore.error('Clipboard not available'))
  }
  let audioElement = $state<HTMLAudioElement | null>(null)

  $effect(() => {
    if (audioElement && audioData?.url) {
      audioElement.load()
    }
  })

  function handleModelChange(event: Event) {
    const target = event.target as HTMLSelectElement
    const value = target.value === 'default' ? undefined : target.value
    chapterModel = value
    onModelChange?.(chapter.id, value)

    // Reset voice when model changes since voice options are different
    chapterVoice = undefined
    onVoiceChange?.(chapter.id, undefined)
  }

  function handleVoiceChange(event: Event) {
    const target = event.target as HTMLSelectElement
    const value = target.value === 'default' ? undefined : target.value
    chapterVoice = value
    onVoiceChange?.(chapter.id, value)
  }

  function handleLanguageChange(event: Event) {
    const target = event.target as HTMLSelectElement
    const value = target.value === 'default' ? undefined : target.value
    chapterLanguage = value
    onLanguageChange?.(chapter.id, value)

    // After language change, check if we need to fallback model
    const baseModel = chapterModel || $selectedModel
    if (baseModel === 'kokoro') {
      // Determine the new effective language after this change
      let newLang = value
      if (!newLang && book) {
        // When auto-detect is selected (value is undefined), compute the effective language
        // using the chapter's current detected language values. Note: chapter.language will
        // still be the old value here (updated async via callback), but we're checking what
        // the effective language will be based on the chapter's detectedLanguage field.
        newLang =
          chapter.detectedLanguage &&
          chapter.languageConfidence &&
          chapter.languageConfidence >= DETECTION_CONFIDENCE_THRESHOLD &&
          chapter.detectedLanguage !== 'und'
            ? chapter.detectedLanguage
            : book.language || 'en'
      }
      if (!newLang) {
        newLang = 'en' // fallback
      }

      if (!isKokoroLanguageSupported(newLang)) {
        // Auto-switch to Piper
        chapterModel = 'piper'
        onModelChange?.(chapter.id, 'piper')
        toastStore.info(
          `Switched to Piper for language ${newLang.toUpperCase()} (not supported by Kokoro)`
        )
      }
    }

    // Reset voice to auto-select for new language
    chapterVoice = undefined
    onVoiceChange?.(chapter.id, undefined)
  }

  function resetToDefault() {
    chapterModel = undefined
    chapterVoice = undefined
    chapterLanguage = undefined
    onModelChange?.(chapter.id, undefined)
    onVoiceChange?.(chapter.id, undefined)
    onLanguageChange?.(chapter.id, undefined)
  }

  let hasOverrides = $derived(
    chapterModel !== undefined || chapterVoice !== undefined || chapterLanguage !== undefined
  )
</script>

<div class="chapter-card" class:selected role="listitem">
  <div class="card-main">
    <div class="card-content">
      <label class="chapter-header">
        <input
          type="checkbox"
          class="chapter-checkbox"
          checked={selected}
          onchange={() => onToggle(chapter.id)}
          aria-label={`Select chapter: ${chapter.title}`}
        />
        <span class="chapter-title">{chapter.title}</span>
      </label>
      <div class="chapter-meta">
        <span>{numberFormatter.format(wordCount)} words</span>
        <span class="dot" aria-hidden="true">•</span>
        <span>~{formatDurationShort(estimatedDurationSeconds)}</span>
        {#if chapter.detectedLanguage && chapter.detectedLanguage !== 'und'}
          <span class="dot" aria-hidden="true">•</span>
          <span
            class="language-badge"
            title={`Detected: ${chapter.detectedLanguage} (confidence: ${Math.round((chapter.languageConfidence || 0) * 100)}%)`}
          >
            🌐 {chapter.detectedLanguage.toUpperCase()}
            {#if chapter.languageConfidence !== undefined}
              <span class="confidence">{Math.round(chapter.languageConfidence * 100)}%</span>
            {/if}
          </span>
        {/if}
      </div>
      <p class="chapter-preview">
        {chapter.content.slice(0, 180)}{chapter.content.length > 180 ? '…' : ''}
      </p>
    </div>

    <div class="card-actions">
      {#if status === 'processing'}
        <div class="spinner-container">
          <span class="spinner" aria-hidden="true"></span>
        </div>
      {/if}
      <button
        class="action-btn"
        onclick={() => onRead(chapter)}
        title="Read chapter"
        aria-label={`Read chapter: ${chapter.title}`}
      >
        <span class="icon" aria-hidden="true">📖</span> Read
      </button>

      <button
        class="action-btn icon-only"
        onclick={copy}
        title="Copy text"
        aria-label={`Copy text of chapter: ${chapter.title}`}
      >
        <span aria-hidden="true">📋</span>
      </button>
    </div>
  </div>

  {#if status === 'processing'}
    <div class="progress-details">
      {#if chapterSegmentProgress && chapterSegmentProgress.totalSegments > 0}
        <div class="segment-progress-container">
          <div class="segment-progress-bar">
            <div class="segment-progress-fill" style="width: {segmentPercentage}%"></div>
          </div>
          <div class="segment-progress-info">
            <span class="segment-count">
              {chapterSegmentProgress.generatedIndices.size} / {chapterSegmentProgress.totalSegments}
              segments
            </span>
            <span class="segment-percentage">{segmentPercentage}%</span>
          </div>
          {#if chapterSegmentProgress.generatedIndices.size > 0}
            <button
              class="action-btn small preview-btn"
              onclick={() => onRead(chapter)}
              title="Preview generated segments"
            >
              🎧 Preview Available
            </button>
          {/if}
        </div>
      {:else if progress?.total}
        <div class="progress-bar-bg">
          <div
            class="progress-fill"
            style="width: {(progress.current / progress.total) * 100}%"
          ></div>
        </div>
        <div class="progress-text">
          <span>Generating chunk {progress.current} of {progress.total}</span>
          {#if progress.message}
            <span class="progress-sub">{progress.message}</span>
          {/if}
        </div>
      {:else}
        <div class="progress-text">
          {progress?.message || 'Preparing generation...'}
        </div>
      {/if}
    </div>
  {/if}

  {#if isPartiallyGenerated && status !== 'processing'}
    <div class="partial-progress-indicator">
      <div class="partial-progress-bar">
        <div class="partial-progress-fill" style="width: {segmentPercentage}%"></div>
      </div>
      <span class="partial-progress-text">
        {segmentPercentage}% generated ({chapterSegmentProgress?.generatedIndices.size ?? 0} segments)
      </span>
      <button
        class="action-btn small"
        onclick={() => onRead(chapter)}
        title="Listen to generated segments"
      >
        🎧 Listen
      </button>
    </div>
  {/if}

  {#if status === 'error' && error}
    <div class="error-container">
      <details class="error-details">
        <summary class="error-summary">
          <span class="error-icon">❌</span>
          <span class="error-title">Generation Failed</span>
        </summary>
        <div class="error-content">
          <pre class="error-text">{error}</pre>
        </div>
      </details>
      <div class="error-actions">
        <button
          class="copy-stack-btn"
          onclick={() => {
            navigator.clipboard
              .writeText(error)
              .then(() => toastStore.success('Error copied to clipboard'))
              .catch(() => toastStore.error('Failed to copy error'))
          }}
          title="Copy stack trace to clipboard"
        >
          📋 Copy Stack Trace
        </button>
        <button class="retry-btn" onclick={() => onRetry?.(chapter.id)}> 🔄 Retry </button>
      </div>
    </div>
  {/if}

  {#if audioData}
    <div class="audio-controls">
      <audio
        bind:this={audioElement}
        controls
        src={audioData.url}
        aria-label={`Audio for ${chapter.title}`}
      ></audio>
      <div class="download-actions">
        <select
          class="download-select"
          onchange={(e) => {
            const format = (e.target as HTMLSelectElement).value as 'wav' | 'mp3' | 'm4b' | 'mp4'
            if (format) {
              onDownload(chapter.id, format)
            }
          }}
          aria-label={`Download format for ${chapter.title}`}
        >
          <option value="">📥 Download...</option>
          <option value="wav">WAV (Uncompressed)</option>
          <option value="mp3">MP3 (Standard)</option>
          <option value="m4b">M4B (Audiobook)</option>
          <option value="mp4">MP4 (Audio)</option>
        </select>
      </div>
    </div>
  {/if}

  <!-- Advanced Settings for this chapter -->
  <div class="chapter-advanced-section">
    <button
      class="advanced-toggle-btn"
      class:has-overrides={hasOverrides}
      onclick={() => (showAdvanced = !showAdvanced)}
      title={hasOverrides ? 'Chapter has custom settings' : 'Configure chapter settings'}
    >
      <span class="toggle-icon">{showAdvanced ? '▼' : '▶'}</span>
      <span class="toggle-text">Chapter Settings</span>
      {#if hasOverrides}
        <span class="override-indicator" title="Custom settings applied">●</span>
      {/if}
    </button>

    {#if showAdvanced}
      <div class="advanced-panel">
        <div class="advanced-content">
          <div class="setting-row">
            <label for={`model-${chapter.id}`} class="setting-label">
              <span>TTS Model</span>
              <span class="setting-help">
                {#if chapterModel}
                  Override
                {:else if isModelFallback}
                  Auto-switched to Piper (language not supported by Kokoro)
                {:else}
                  Using global default
                {/if}
              </span>
            </label>
            <select
              id={`model-${chapter.id}`}
              class="setting-select"
              value={chapterModel ?? 'default'}
              onchange={handleModelChange}
            >
              <option value="default"
                >📖 Use Global ({TTS_MODELS.find((m) => m.id === $selectedModel)?.name ||
                  $selectedModel}){isModelFallback ? ' → Piper (fallback)' : ''}</option
              >
              {#each TTS_MODELS as model}
                <option value={model.id}>{model.name}</option>
              {/each}
            </select>
          </div>

          <div class="setting-row">
            <label for={`language-${chapter.id}`} class="setting-label">
              <span>Language</span>
              <span class="setting-help">
                {#if chapterLanguage}
                  Override
                {:else if chapter.detectedLanguage && chapter.detectedLanguage !== 'und'}
                  Auto-detected: {chapter.detectedLanguage.toUpperCase()} ({Math.round(
                    (chapter.languageConfidence || 0) * 100
                  )}%)
                {:else if book?.language}
                  Using book default
                {:else}
                  Using app default
                {/if}
              </span>
            </label>
            <select
              id={`language-${chapter.id}`}
              class="setting-select"
              value={chapterLanguage ?? 'default'}
              onchange={handleLanguageChange}
            >
              <option value="default">
                🌐 Auto-detect
                {#if chapter.detectedLanguage && chapter.detectedLanguage !== 'und'}
                  ({chapter.detectedLanguage.toUpperCase()})
                {:else if book?.language}
                  (Book: {book.language.toUpperCase()})
                {:else}
                  (EN)
                {/if}
              </option>
              {#each LANGUAGE_OPTIONS as lang}
                <option value={lang.code}>{getLanguageLabel(lang.code)}</option>
              {/each}
            </select>
          </div>

          <div class="setting-row">
            <label for={`voice-${chapter.id}`} class="setting-label">
              <span>Voice</span>
              <span class="setting-help">
                {#if chapterVoice}
                  Override
                {:else}
                  Auto-selected for {effectiveLanguage.toUpperCase()}
                {/if}
              </span>
            </label>
            <select
              id={`voice-${chapter.id}`}
              class="setting-select"
              value={chapterVoice ?? 'default'}
              onchange={handleVoiceChange}
            >
              <option value="default"
                >🌐 Auto-select ({chapterAvailableVoices.find((v) => v.id === effectiveVoice)
                  ?.label || effectiveVoice})</option
              >
              {#each chapterAvailableVoices as voice}
                <option value={voice.id}>{voice.label}</option>
              {/each}
            </select>
          </div>

          {#if hasOverrides}
            <div class="setting-row">
              <button class="reset-btn" onclick={resetToDefault}>
                <span>↩️</span>
                <span>Reset to Global Defaults</span>
              </button>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .chapter-card {
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    transition: all 0.2s ease;
  }

  .chapter-card:hover {
    border-color: var(--secondary-text);
    box-shadow: 0 2px 8px var(--shadow-color);
  }

  .chapter-card.selected {
    background: var(--selected-bg);
    border-color: var(--selected-border);
  }

  .card-main {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    width: 100%;
  }

  .card-content {
    flex: 1;
    min-width: 0;
  }

  .chapter-header {
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    margin-bottom: 6px;
  }

  .chapter-checkbox {
    width: 18px;
    height: 18px;
    cursor: pointer;
  }

  .chapter-title {
    font-weight: 600;
    font-size: 1.05rem;
    color: var(--text-color);
    line-height: 1.4;
  }

  .chapter-preview {
    margin: 0;
    font-size: 0.9rem;
    color: var(--secondary-text);
    line-height: 1.5;
    padding-left: 30px;
  }

  .chapter-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--secondary-text);
    font-size: 0.85rem;
    padding-left: 30px;
    margin: 4px 0;
  }

  .dot {
    color: var(--border-color);
  }

  .language-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    background: var(--bg-color);
    border: 1px solid var(--input-border);
    border-radius: 12px;
    font-size: 0.8rem;
    font-weight: 500;
  }

  .language-badge .confidence {
    opacity: 0.7;
    font-size: 0.75rem;
  }

  .card-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border: 1px solid var(--input-border);
    background: var(--surface-color);
    border-radius: 6px;
    font-size: 0.9rem;
    color: var(--secondary-text);
    cursor: pointer;
    transition: all 0.2s;
  }

  .action-btn:hover {
    background: var(--bg-color);
    border-color: var(--text-color);
    color: var(--text-color);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background: var(--surface-color);
    border-color: var(--border-color);
    color: var(--secondary-text);
  }

  .action-btn:disabled:hover {
    background: var(--surface-color);
    border-color: var(--border-color);
    color: var(--secondary-text);
  }

  .action-btn.icon-only {
    padding: 8px;
  }

  .action-btn.small {
    font-size: 0.8rem;
    padding: 4px 8px;
  }

  .audio-controls {
    margin-top: 4px;
    padding-top: 12px;
    border-top: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    gap: 16px;
    width: 100%;
    animation: slideDown 0.3s ease-out;
  }

  .download-actions {
    display: flex;
    gap: 8px;
  }

  .download-select {
    padding: 6px 12px;
    border: 1px solid var(--input-border);
    background: var(--surface-color);
    border-radius: 6px;
    font-size: 0.85rem;
    color: var(--text-color);
    cursor: pointer;
    transition: all 0.2s;
    min-width: 160px;
  }

  .download-select:hover {
    background: var(--bg-color);
    border-color: var(--text-color);
  }

  .download-select:focus {
    outline: none;
    border-color: var(--primary-color, #3b82f6);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  audio {
    flex: 1;
    height: 36px;
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

  /* Mobile Responsive */
  @media (max-width: 640px) {
    .card-main {
      flex-direction: column;
      gap: 12px;
    }

    .chapter-preview {
      padding-left: 0;
      margin-top: 8px;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .card-actions {
      width: 100%;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .action-btn {
      justify-content: center;
    }

    .audio-controls {
      flex-direction: column;
      align-items: stretch;
    }

    .download-actions {
      justify-content: flex-end;
    }
  }

  .retry-btn {
    background-color: var(--error-color, #ff3b30);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
  }

  .retry-btn:hover {
    opacity: 0.9;
  }

  .error-container {
    margin-top: 8px;
    padding: 8px;
    background: #fee2e2;
    border: 1px solid #fecaca;
    border-radius: 6px;
    color: #ef4444;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .error-details {
    width: 100%;
  }

  .error-summary {
    cursor: pointer;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .error-content {
    margin-top: 8px;
    background: #fff;
    padding: 8px;
    border-radius: 4px;
    border: 1px solid #fca5a5;
  }

  .error-text {
    font-family: monospace;
    font-size: 0.8rem;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 150px;
    overflow-y: auto;
    margin: 0;
    color: #b91c1c;
  }

  .error-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .copy-stack-btn {
    flex: 1;
    font-size: 0.85rem;
    padding: 6px 12px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 4px;
    cursor: pointer;
    color: #b91c1c;
    font-weight: 500;
    transition: all 0.2s;
  }

  .copy-stack-btn:hover {
    background: #fee2e2;
    border-color: #fca5a5;
  }
  .spinner-container {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 8px;
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--border-color);
    border-top-color: var(--primary-color, #3b82f6);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .progress-details {
    margin-top: 8px;
    padding: 12px;
    background: var(--bg-color);
    border-radius: 8px;
    border: 1px solid var(--border-color);
  }

  .progress-bar-bg {
    height: 6px;
    background: var(--border-color);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 8px;
  }

  .progress-fill {
    height: 100%;
    background: var(--primary-color, #3b82f6);
    transition: width 0.3s ease;
  }

  .progress-text {
    font-size: 0.85rem;
    color: var(--secondary-text);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .progress-sub {
    font-size: 0.8rem;
    opacity: 0.8;
  }

  /* Segment Progress Styles */
  .segment-progress-container {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .segment-progress-bar {
    height: 8px;
    background: var(--border-color);
    border-radius: 4px;
    overflow: hidden;
  }

  .segment-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #22c55e, #4ade80);
    transition: width 0.3s ease;
    border-radius: 4px;
  }

  .segment-progress-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.85rem;
  }

  .segment-count {
    color: var(--secondary-text);
  }

  .segment-percentage {
    font-weight: 600;
    color: #22c55e;
  }

  .preview-btn {
    align-self: flex-start;
    background: linear-gradient(135deg, #22c55e, #16a34a);
    color: white;
    border: none;
    animation: pulseGlow 2s infinite;
  }

  .preview-btn:hover {
    background: linear-gradient(135deg, #16a34a, #15803d);
    color: white;
    border: none;
  }

  @keyframes pulseGlow {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4);
    }
    50% {
      box-shadow: 0 0 0 8px rgba(34, 197, 94, 0);
    }
  }

  /* Partial Progress Indicator (for non-processing state) */
  .partial-progress-indicator {
    margin-top: 8px;
    padding: 10px 12px;
    background: linear-gradient(135deg, rgba(34, 197, 94, 0.1), rgba(74, 222, 128, 0.05));
    border: 1px solid rgba(34, 197, 94, 0.3);
    border-radius: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .partial-progress-bar {
    flex: 1;
    min-width: 100px;
    height: 6px;
    background: var(--border-color);
    border-radius: 3px;
    overflow: hidden;
  }

  .partial-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #22c55e, #4ade80);
    transition: width 0.3s ease;
  }

  .partial-progress-text {
    font-size: 0.85rem;
    color: #16a34a;
    font-weight: 500;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Advanced Settings Section */
  .chapter-advanced-section {
    margin-top: 8px;
    border-top: 1px solid var(--border-color);
    padding-top: 8px;
  }

  .advanced-toggle-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    font-size: 0.85rem;
    color: var(--secondary-text);
    cursor: pointer;
    transition: all 0.2s;
    width: 100%;
    text-align: left;
  }

  .advanced-toggle-btn:hover {
    background: var(--bg-color);
    border-color: var(--text-color);
    color: var(--text-color);
  }

  .advanced-toggle-btn.has-overrides {
    background: #eff6ff;
    border-color: #3b82f6;
    color: #1e40af;
  }

  .toggle-icon {
    font-size: 0.7rem;
    transition: transform 0.2s;
  }

  .toggle-text {
    flex: 1;
    font-weight: 500;
  }

  .override-indicator {
    color: #3b82f6;
    font-size: 0.6rem;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .advanced-panel {
    margin-top: 12px;
    padding: 16px;
    background: var(--bg-color);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    animation: slideDown 0.3s ease-out;
  }

  .advanced-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .setting-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .setting-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--text-color);
  }

  .setting-help {
    font-size: 0.75rem;
    font-weight: normal;
    color: var(--secondary-text);
    font-style: italic;
  }

  .setting-select {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--input-border);
    border-radius: 6px;
    background: var(--surface-color);
    color: var(--text-color);
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .setting-select:hover {
    border-color: var(--text-color);
  }

  .setting-select:focus {
    outline: none;
    border-color: var(--primary-color, #3b82f6);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  .reset-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 8px 16px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 6px;
    color: #b91c1c;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    width: 100%;
  }

  .reset-btn:hover {
    background: #fee2e2;
    border-color: #fca5a5;
  }

  @media (max-width: 640px) {
    .advanced-panel {
      padding: 12px;
    }

    .setting-row {
      gap: 6px;
    }
  }
</style>
