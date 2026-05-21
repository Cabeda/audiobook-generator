<script lang="ts">
  import { fade } from 'svelte/transition'
  import { audioService } from '../lib/audioPlaybackService.svelte'

  type Theme = 'light' | 'dark' | 'sepia'

  let {
    showSettings = $bindable(false),
    localModel = $bindable('kokoro'),
    localVoice = $bindable('af_heart'),
    autoScrollEnabled = $bindable(true),
    fontSize = $bindable(18),
    currentTheme = $bindable('dark' as Theme),
    voice,
    piperVoices = [],
    sortedWebSpeechVoices,
    onSpeedChange,
    onFontSizeChange,
    onThemeChange,
    onModelChange,
    onVoiceChange,
  }: {
    showSettings: boolean
    localModel: 'kokoro' | 'piper' | 'web_speech'
    localVoice: string
    autoScrollEnabled: boolean
    fontSize: number
    currentTheme: Theme
    voice: string
    piperVoices: Array<{ key: string; name: string; language: string; quality: string }>
    sortedWebSpeechVoices: () => SpeechSynthesisVoice[]
    onSpeedChange: (speed: number) => void
    onFontSizeChange: (delta: number) => void
    onThemeChange: (theme: Theme) => void
    onModelChange: () => void
    onVoiceChange: () => void
  } = $props()
</script>

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
          onclick={() => onSpeedChange(0.75)}>0.75x</button
        >
        <button
          class="speed-btn"
          class:active={audioService.playbackSpeed === 1.0}
          onclick={() => onSpeedChange(1.0)}>1.0x</button
        >
        <button
          class="speed-btn"
          class:active={audioService.playbackSpeed === 1.25}
          onclick={() => onSpeedChange(1.25)}>1.25x</button
        >
        <button
          class="speed-btn"
          class:active={audioService.playbackSpeed === 1.5}
          onclick={() => onSpeedChange(1.5)}>1.5x</button
        >
        <button
          class="speed-btn"
          class:active={audioService.playbackSpeed === 2.0}
          onclick={() => onSpeedChange(2.0)}>2.0x</button
        >
      </div>
    </div>

    <div class="setting-item">
      <span class="setting-label">Font Size</span>
      <div class="font-size-selector">
        <button
          class="font-size-btn"
          onclick={() => onFontSizeChange(-2)}
          aria-label="Decrease font size">A−</button
        >
        <span class="font-size-value">{fontSize}px</span>
        <button
          class="font-size-btn"
          onclick={() => onFontSizeChange(2)}
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
          onclick={() => onThemeChange('light')}>☀️ Light</button
        >
        <button
          class="theme-btn"
          class:active={currentTheme === 'dark'}
          onclick={() => onThemeChange('dark')}>🌙 Dark</button
        >
        <button
          class="theme-btn"
          class:active={currentTheme === 'sepia'}
          onclick={() => onThemeChange('sepia')}>📖 Sepia</button
        >
      </div>
    </div>

    <div class="setting-item">
      <label for="model-select">Model</label>
      <select
        id="model-select"
        bind:value={localModel}
        onchange={onModelChange}
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
        onchange={onVoiceChange}
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

<style>
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

  .speed-btn.active {
    background: var(--text-color);
    color: var(--bg-color);
    border-color: var(--text-color);
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

  .hint {
    font-size: 11px;
    color: var(--secondary-text);
    font-style: italic;
    margin-left: 8px;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
    margin-bottom: 4px;
    color: var(--text-color);
    opacity: 0.8;
  }

  .info-row .value {
    font-weight: 500;
  }

  .setting-label {
    display: block;
    margin-bottom: 8px;
    font-size: 14px;
    font-weight: 500;
  }

  @media (max-width: 640px) {
    .settings-menu {
      right: 16px;
      left: 16px;
      width: auto;
      bottom: 80px;
    }
  }
</style>
