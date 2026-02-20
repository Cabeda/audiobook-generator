<script lang="ts">
  import { onMount } from 'svelte'
  import { appSettings, type LanguageDefault } from '../stores/appSettingsStore'
  import { LANGUAGE_OPTIONS, getLanguageLabel } from '../lib/utils/languageResolver'
  import { TTS_MODELS } from '../lib/tts/ttsModels'
  import { voiceLabels } from '../stores/ttsStore'
  import { listVoices as listKokoroVoices } from '../lib/kokoro/kokoroVoices'
  import {
    getKokoroVoicesForLanguage,
    getPiperVoicesForLanguage,
    isKokoroLanguageSupported,
  } from '../lib/utils/voiceSelector'
  import { piperVoices, loadPiperVoices } from '../stores/piperVoicesStore'
  import {
    getStorageInfo,
    clearLibraryData,
    clearModelCache,
    clearAllData,
    formatBytes,
    type StorageInfo,
  } from '../lib/storageManager'
  import { toastStore } from '../stores/toastStore'

  interface Props {
    onBack: () => void
  }

  let { onBack }: Props = $props()

  let settings = $derived($appSettings)
  let addingLanguage = $state(false)
  let newLangCode = $state('')
  let storageInfo = $state<StorageInfo | null>(null)
  let loadingStorage = $state(false)

  // Load piper voices via shared store (once across app)
  loadPiperVoices()

  onMount(() => {
    loadStorageInfo()
  })

  async function loadStorageInfo() {
    loadingStorage = true
    try {
      storageInfo = await getStorageInfo()
    } catch (e) {
      console.error('Failed to load storage info:', e)
    } finally {
      loadingStorage = false
    }
  }

  let configuredLanguages = $derived(Object.keys(settings.languageDefaults))

  // Languages not yet configured
  let availableLanguages = $derived(
    LANGUAGE_OPTIONS.filter((l) => !configuredLanguages.includes(l.code))
  )

  function getVoicesForLanguage(langCode: string, model: string) {
    if (model === 'kokoro') {
      const kokoroVoices = listKokoroVoices()
      const langVoices = getKokoroVoicesForLanguage(langCode)
      return kokoroVoices
        .filter((v) => langVoices.includes(v))
        .map((v) => ({ id: v, label: voiceLabels[v] || v }))
    } else if (model === 'piper' && $piperVoices.length > 0) {
      return getPiperVoicesForLanguage(langCode, $piperVoices).map((v) => ({
        id: v.key,
        label: v.name,
      }))
    }
    return []
  }

  function addLanguage() {
    if (!newLangCode) return
    appSettings.setLanguageDefault(newLangCode, {})
    newLangCode = ''
    addingLanguage = false
  }

  function removeLanguage(code: string) {
    appSettings.removeLanguageDefault(code)
  }

  function handleModelChange(langCode: string, event: Event) {
    const value = (event.target as HTMLSelectElement).value || undefined
    appSettings.setLanguageDefault(langCode, { model: value, voice: undefined })
  }

  function handleVoiceChange(langCode: string, event: Event) {
    const value = (event.target as HTMLSelectElement).value || undefined
    appSettings.setLanguageDefault(langCode, { voice: value })
  }

  async function handleClearLibrary() {
    if (!confirm('Delete all books, audio, and segments? This cannot be undone.')) return
    try {
      await clearLibraryData()
      toastStore.show('Library data cleared', 'success')
      await loadStorageInfo()
    } catch (e) {
      toastStore.show('Failed to clear library data', 'error')
    }
  }

  async function handleClearModels() {
    if (!confirm('Delete all cached TTS models? They will be re-downloaded when needed.')) return
    try {
      await clearModelCache()
      toastStore.show('Model cache cleared', 'success')
      await loadStorageInfo()
    } catch (e) {
      toastStore.show('Failed to clear model cache', 'error')
    }
  }

  async function handleClearAll() {
    if (
      !confirm(
        'Delete EVERYTHING (books, audio, models, settings)? This cannot be undone and will reload the page.'
      )
    )
      return
    try {
      await clearAllData()
      toastStore.show('All data cleared', 'success')
      setTimeout(() => window.location.reload(), 1000)
    } catch (e) {
      toastStore.show('Failed to clear all data', 'error')
    }
  }
</script>

<div class="settings-page">
  <div class="settings-header">
    <button class="back-btn" onclick={onBack}>← Back</button>
    <h2>Settings</h2>
  </div>

  <p class="settings-hint">
    Configure app-wide defaults. These can be overridden per book or per chapter.
  </p>

  <section class="settings-section">
    <h3>Language Defaults</h3>
    <p class="section-desc">
      Set preferred model and voice for each language. When a chapter's language is detected, these
      defaults apply automatically.
    </p>

    {#if configuredLanguages.length === 0}
      <p class="empty-hint">No language defaults configured yet.</p>
    {/if}

    {#each configuredLanguages as langCode (langCode)}
      {@const langDefaults = settings.languageDefaults[langCode] ?? {}}
      {@const effectiveModel = langDefaults.model || ''}
      {@const voices = effectiveModel ? getVoicesForLanguage(langCode, effectiveModel) : []}
      <div class="language-row">
        <div class="language-label">
          <span>{getLanguageLabel(langCode)}</span>
          <button
            class="remove-btn"
            onclick={() => removeLanguage(langCode)}
            title="Remove language defaults"
            aria-label={`Remove ${getLanguageLabel(langCode)} defaults`}
          >
            ✕
          </button>
        </div>

        <div class="language-fields">
          <div class="field">
            <label for={`model-${langCode}`}>Model</label>
            <select
              id={`model-${langCode}`}
              value={langDefaults.model ?? ''}
              onchange={(e) => handleModelChange(langCode, e)}
            >
              <option value="">Use global default</option>
              {#each TTS_MODELS as model}
                {#if model.id !== 'kokoro' || isKokoroLanguageSupported(langCode)}
                  <option value={model.id}>{model.name}</option>
                {/if}
              {/each}
            </select>
          </div>

          <div class="field">
            <label for={`voice-${langCode}`}>Voice</label>
            <select
              id={`voice-${langCode}`}
              value={langDefaults.voice ?? ''}
              onchange={(e) => handleVoiceChange(langCode, e)}
              disabled={!effectiveModel}
            >
              <option value="">Auto-select</option>
              {#each voices as voice}
                <option value={voice.id}>{voice.label}</option>
              {/each}
            </select>
          </div>
        </div>
      </div>
    {/each}

    {#if addingLanguage}
      <div class="add-language-row">
        <select bind:value={newLangCode}>
          <option value="">Select language...</option>
          {#each availableLanguages as lang}
            <option value={lang.code}>{lang.flag} {lang.label}</option>
          {/each}
        </select>
        <button class="confirm-btn" onclick={addLanguage} disabled={!newLangCode}>Add</button>
        <button class="cancel-btn" onclick={() => (addingLanguage = false)}>Cancel</button>
      </div>
    {:else}
      <button class="add-btn" onclick={() => (addingLanguage = true)}>
        + Add language default
      </button>
    {/if}
  </section>

  <section class="settings-section">
    <h3>Adaptive Quality</h3>
    <p class="section-desc">
      On weaker devices, audio starts immediately at a lower quality tier and is silently upgraded
      in the background while you listen.
    </p>

    <div class="toggle-row">
      <label for="aq-enabled">Enable adaptive quality</label>
      <input
        id="aq-enabled"
        type="checkbox"
        checked={settings.adaptiveQuality.enabled}
        onchange={(e) =>
          appSettings.update((s) => ({
            ...s,
            adaptiveQuality: {
              ...s.adaptiveQuality,
              enabled: (e.target as HTMLInputElement).checked,
            },
          }))}
      />
    </div>

    <div class="toggle-row" class:disabled={!settings.adaptiveQuality.enabled}>
      <label for="aq-skip-web-speech">Skip Web Speech (start at Tier 1)</label>
      <input
        id="aq-skip-web-speech"
        type="checkbox"
        disabled={!settings.adaptiveQuality.enabled}
        checked={settings.adaptiveQuality.skipWebSpeech}
        onchange={(e) =>
          appSettings.update((s) => ({
            ...s,
            adaptiveQuality: {
              ...s.adaptiveQuality,
              skipWebSpeech: (e.target as HTMLInputElement).checked,
            },
          }))}
      />
    </div>

    <div class="toggle-row" class:disabled={!settings.adaptiveQuality.enabled}>
      <label for="aq-upgrade-played">Upgrade already-played segments</label>
      <input
        id="aq-upgrade-played"
        type="checkbox"
        disabled={!settings.adaptiveQuality.enabled}
        checked={settings.adaptiveQuality.upgradePlayedSegments}
        onchange={(e) =>
          appSettings.update((s) => ({
            ...s,
            adaptiveQuality: {
              ...s.adaptiveQuality,
              upgradePlayedSegments: (e.target as HTMLInputElement).checked,
            },
          }))}
      />
    </div>
  </section>

  <section class="settings-section">
    <h3>Storage Management</h3>
    <p class="section-desc">
      Manage cached data, models, and library storage. Free up space by deleting unused items.
    </p>

    {#if loadingStorage}
      <p class="empty-hint">Loading storage info...</p>
    {:else if storageInfo}
      <div class="storage-info">
        <div class="storage-stat">
          <span class="stat-label">Total Storage Used:</span>
          <span class="stat-value">{formatBytes(storageInfo.totalSize)}</span>
        </div>
        <div class="storage-stat">
          <span class="stat-label">Books:</span>
          <span class="stat-value">{storageInfo.books}</span>
        </div>
        <div class="storage-stat">
          <span class="stat-label">Audio Chapters:</span>
          <span class="stat-value">{storageInfo.audio}</span>
        </div>
        <div class="storage-stat">
          <span class="stat-label">Segments:</span>
          <span class="stat-value">{storageInfo.segments}</span>
        </div>
      </div>

      {#if storageInfo.models.length > 0}
        <div class="models-list">
          <h4>Cached Models</h4>
          {#each storageInfo.models as model}
            <div class="model-item">
              <span>{model.name}</span>
            </div>
          {/each}
        </div>
      {/if}

      <div class="storage-actions">
        <button class="danger-btn" onclick={handleClearLibrary}> Clear Library Data </button>
        <button class="danger-btn" onclick={handleClearModels}>Clear Model Cache</button>
        <button class="danger-btn critical" onclick={handleClearAll}> Clear Everything </button>
      </div>

      <button class="refresh-btn" onclick={loadStorageInfo}>↻ Refresh</button>
    {/if}
  </section>
</div>

<style>
  .settings-page {
    width: 100%;
    max-width: 640px;
    margin: 0 auto;
    padding: 24px;
    flex-shrink: 0; /* Don't compress in flex parent — let wrapper scroll */
  }

  .settings-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 8px;
  }

  .settings-header h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-color);
  }

  .back-btn {
    background: none;
    border: none;
    color: var(--secondary-text);
    cursor: pointer;
    font-size: 0.9rem;
    padding: 8px 0;
    min-height: 44px;
  }

  .back-btn:hover {
    color: var(--text-color);
  }

  .settings-hint {
    color: var(--secondary-text);
    font-size: 0.85rem;
    margin: 0 0 24px;
  }

  .settings-section {
    margin-bottom: 32px;
  }

  .settings-section h3 {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text-color);
    margin: 0 0 4px;
  }

  .section-desc {
    color: var(--secondary-text);
    font-size: 0.8rem;
    margin: 0 0 16px;
    line-height: 1.4;
  }

  .empty-hint {
    color: var(--secondary-text);
    font-size: 0.85rem;
    font-style: italic;
    margin: 0 0 12px;
  }

  .language-row {
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 12px 16px;
    margin-bottom: 10px;
  }

  .language-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--text-color);
    margin-bottom: 10px;
  }

  .remove-btn {
    background: none;
    border: none;
    color: var(--secondary-text);
    cursor: pointer;
    font-size: 0.85rem;
    padding: 4px 8px;
    border-radius: 4px;
  }

  .remove-btn:hover {
    color: var(--error-color, #dc2626);
    background: rgba(220, 38, 38, 0.1);
  }

  .language-fields {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .field {
    flex: 1;
    min-width: 140px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field label {
    font-size: 0.75rem;
    color: var(--secondary-text);
    font-weight: 500;
  }

  .field select {
    padding: 8px 10px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-color);
    color: var(--text-color);
    font-size: 0.85rem;
    cursor: pointer;
  }

  .field select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .add-language-row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  .add-language-row select {
    flex: 1;
    min-width: 160px;
    padding: 8px 10px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-color);
    color: var(--text-color);
    font-size: 0.85rem;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0;
    border-bottom: 1px solid var(--border-color);
    gap: 12px;
  }

  .toggle-row label {
    font-size: 0.9rem;
    color: var(--primary-text);
    flex: 1;
  }

  .toggle-row.disabled label {
    opacity: 0.5;
  }

  .add-btn {
    background: none;
    border: 1px dashed var(--border-color);
    border-radius: 8px;
    padding: 10px 16px;
    color: var(--secondary-text);
    cursor: pointer;
    font-size: 0.85rem;
    width: 100%;
    transition:
      border-color 0.2s,
      color 0.2s;
  }

  .add-btn:hover {
    border-color: var(--text-color);
    color: var(--text-color);
  }

  .confirm-btn {
    padding: 8px 16px;
    background: var(--primary-color, #3b82f6);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 500;
  }

  .confirm-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .cancel-btn {
    padding: 8px 12px;
    background: none;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    color: var(--secondary-text);
    cursor: pointer;
    font-size: 0.85rem;
  }

  .storage-info {
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 16px;
  }

  .storage-stat {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid var(--border-color);
  }

  .storage-stat:last-child {
    border-bottom: none;
  }

  .stat-label {
    color: var(--secondary-text);
    font-size: 0.9rem;
  }

  .stat-value {
    color: var(--text-color);
    font-weight: 600;
    font-size: 0.9rem;
  }

  .models-list {
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 16px;
  }

  .models-list h4 {
    margin: 0 0 12px 0;
    font-size: 0.95rem;
    color: var(--text-color);
  }

  .model-item {
    padding: 8px 0;
    color: var(--secondary-text);
    font-size: 0.85rem;
    border-bottom: 1px solid var(--border-color);
  }

  .model-item:last-child {
    border-bottom: none;
  }

  .storage-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
  }

  .danger-btn {
    padding: 10px 16px;
    background: #dc2626;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 500;
    transition: background 0.2s;
  }

  .danger-btn:hover {
    background: #b91c1c;
  }

  .danger-btn.critical {
    background: #991b1b;
  }

  .danger-btn.critical:hover {
    background: #7f1d1d;
  }

  .refresh-btn {
    padding: 8px 16px;
    background: none;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    color: var(--secondary-text);
    cursor: pointer;
    font-size: 0.85rem;
    width: fit-content;
  }

  .refresh-btn:hover {
    border-color: var(--text-color);
    color: var(--text-color);
  }

  @media (max-width: 480px) {
    .settings-page {
      padding: 16px;
    }

    .language-fields {
      flex-direction: column;
    }
  }
</style>
