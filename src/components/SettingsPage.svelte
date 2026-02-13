<script lang="ts">
  import { appSettings, type LanguageDefault } from '../stores/appSettingsStore'
  import { LANGUAGE_OPTIONS, getLanguageLabel } from '../lib/utils/languageResolver'
  import { TTS_MODELS } from '../lib/tts/ttsModels'
  import { voiceLabels } from '../stores/ttsStore'
  import { listVoices as listKokoroVoices } from '../lib/kokoro/kokoroClient'
  import {
    getKokoroVoicesForLanguage,
    getPiperVoicesForLanguage,
    isKokoroLanguageSupported,
  } from '../lib/utils/voiceSelector'
  import { onMount } from 'svelte'

  interface Props {
    onBack: () => void
  }

  let { onBack }: Props = $props()

  let settings = $derived($appSettings)
  let addingLanguage = $state(false)
  let newLangCode = $state('')

  // Piper voices (loaded async)
  let piperVoices = $state<Array<{ key: string; name: string; language: string; quality: string }>>(
    []
  )

  onMount(async () => {
    try {
      const { PiperClient } = await import('../lib/piper/piperClient')
      piperVoices = await PiperClient.getInstance().getVoices()
    } catch (e) {
      console.error('Failed to load Piper voices:', e)
    }
  })

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
    } else if (model === 'piper' && piperVoices.length > 0) {
      return getPiperVoicesForLanguage(langCode, piperVoices).map((v) => ({
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
</div>

<style>
  .settings-page {
    width: 100%;
    max-width: 640px;
    margin: 0 auto;
    padding: 24px;
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

  @media (max-width: 480px) {
    .settings-page {
      padding: 16px;
    }

    .language-fields {
      flex-direction: column;
    }
  }
</style>
