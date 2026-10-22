<script lang="ts">
  // PROTOTYPE: app settings — global preferences and storage. Book-specific
  // actions (generate/export for one book) stay in the reader's Aa panel.
  import { audio, MODELS, voicesFor, EXPORT_FORMATS } from './audioSim.svelte'

  let {
    bookCount,
    onTour,
    onSandbox,
    onClose,
  }: {
    bookCount: number
    onTour: () => void
    onSandbox: () => void
    onClose: () => void
  } = $props()

  let cleared = $state(false)

  // per-language default voices — stub rows, per-book overrides win
  const LANGUAGE_DEFAULTS = [
    { language: 'English', voice: 'af_heart' },
    { language: 'Portuguese', voice: 'pt_BR-faber-medium' },
    { language: 'German', voice: 'de_DE-thorsten-medium' },
  ]
</script>

<div class="backdrop" onclick={onClose} role="presentation"></div>
<section class="page" role="dialog" aria-label="App settings">
  <header>
    <h2>App settings</h2>
    <button class="icon" onclick={onClose} aria-label="Close">✕</button>
  </header>

  <div class="body">
    <h3>Playback</h3>
    <label class="field">
      Default speed
      <select bind:value={audio.prefs.rate}>
        <option value={1}>1×</option>
        <option value={1.25}>1.25×</option>
        <option value={1.5}>1.5×</option>
        <option value={2}>2×</option>
      </select>
    </label>
    <label class="field">
      Continue into next chapter
      <input type="checkbox" bind:checked={audio.prefs.autoContinue} />
    </label>

    <h3>Voice & speech</h3>
    <button class="action" onclick={onSandbox}>Test voices & models…</button>
    <label class="field">
      Model
      <select
        bind:value={audio.prefs.model}
        onchange={() => (audio.prefs.voice = voicesFor(audio.prefs.model, audio.prefs.language)[0])}
      >
        {#each MODELS as m (m)}
          <option value={m}>{m}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      Voice
      <select bind:value={audio.prefs.voice}>
        {#each voicesFor(audio.prefs.model, audio.prefs.language) as v (v)}
          <option value={v}>{v}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      Quantization
      <select bind:value={audio.prefs.quantization}>
        <option value="f32">f32</option>
        <option value="f16">f16</option>
        <option value="q8">q8</option>
      </select>
    </label>
    <label class="field">
      Device
      <select bind:value={audio.prefs.device}>
        <option value="webgpu">webgpu</option>
        <option value="wasm">wasm</option>
      </select>
    </label>

    <h3>Language defaults</h3>
    <p class="note">Used when a book or chapter has no voice override.</p>
    {#each LANGUAGE_DEFAULTS as row (row.language)}
      <label class="field">
        {row.language}
        <select value={row.voice}>
          <option value={row.voice}>{row.voice}</option>
        </select>
      </label>
    {/each}

    <h3>Storage</h3>
    <p class="note">
      {bookCount} book{bookCount === 1 ? '' : 's'} in library · audio generated for{' '}
      {audio.readyCount()} chapter(s)
    </p>
    <button
      class="action"
      onclick={() => {
        audio.clearGenerated()
        cleared = true
      }}
    >
      {cleared ? 'Generated audio cleared' : 'Clear generated audio'}
    </button>

    <h3>Simulate failures</h3>
    <p class="note">Prototype controls — inject errors to test how the UI copes.</p>
    <label class="field">
      Generation fails
      <input type="checkbox" bind:checked={audio.failures.generation} />
    </label>
    <label class="field">
      Storage full
      <input type="checkbox" bind:checked={audio.failures.storage} />
    </label>
    <label class="field">
      Model fails to load
      <input type="checkbox" bind:checked={audio.failures.model} />
    </label>
    <label class="field">
      Offline
      <input type="checkbox" bind:checked={audio.failures.offline} />
    </label>

    <h3>About</h3>
    <p class="note">Audiobook Generator — UI prototype build. Nothing here is persisted.</p>
    <button class="action" onclick={onTour}>Replay the welcome tour</button>
  </div>
</section>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 60;
  }

  .page {
    position: fixed;
    inset: 24px;
    z-index: 61;
    max-width: 620px;
    margin: 0 auto;
    background: var(--bg-color, #faf9f7);
    color: var(--text-color, #1c1917);
    border: 1px solid var(--border-color, #e7e5e4);
    border-radius: 18px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.25);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-color, #e7e5e4);
  }

  h2 {
    margin: 0;
    font-size: 1.15rem;
  }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 8px 20px 3rem;
  }

  h3 {
    margin: 22px 0 8px;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--secondary-text, #78716c);
  }

  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 0.88rem;
    margin-bottom: 10px;
    min-height: 38px;
  }

  .field select {
    width: 200px;
    background: var(--input-bg, #fff);
    border: 1px solid var(--border-color, #e7e5e4);
    color: inherit;
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 0.82rem;
    min-height: 36px;
  }

  .field input[type='checkbox'] {
    width: 18px;
    height: 18px;
  }

  .note {
    margin: 0 0 10px;
    font-size: 0.82rem;
    color: var(--secondary-text, #78716c);
  }

  .action {
    width: 100%;
    background: none;
    border: 1px solid var(--border-color, #e7e5e4);
    color: inherit;
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 0.85rem;
    cursor: pointer;
    min-height: 40px;
  }

  .action:hover {
    background: var(--hover-bg, rgba(120, 113, 108, 0.1));
  }

  .icon {
    background: none;
    border: none;
    color: var(--secondary-text, #78716c);
    cursor: pointer;
    padding: 8px;
    min-height: 36px;
    border-radius: 8px;
    font-size: 0.9rem;
  }

  .icon:hover {
    background: var(--hover-bg, rgba(120, 113, 108, 0.12));
    color: var(--text-color, #1c1917);
  }

  @media (max-width: 640px) {
    .page {
      inset: 8px;
    }

    .field select {
      width: 150px;
    }
  }
</style>
