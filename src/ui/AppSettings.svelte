<script lang="ts">
  // App settings — global preferences and storage. Book-specific actions
  // (generate/export for one book) stay in the reader's Aa panel.
  import { getStorageUsage } from '../lib/libraryDB'
  import { deleteBookAudio, getBookAudioUsage, type LibraryBook } from '../lib/libraryDB'
  import {
    deleteCachedModel,
    formatBytes,
    getStorageInfo,
    type CachedModel,
  } from '../lib/storageManager'
  import { MODEL_OPTIONS, voiceOptionsFor, type SelectedModel } from '../lib/tts/ttsModels'
  import { piperVoices } from '../stores/piperVoicesStore'
  import {
    selectedDevice,
    selectedModel,
    selectedQuantization,
    selectedVoice,
  } from '../stores/ttsStore'
  import { reader } from './readerModel.svelte'

  let {
    books,
    onTour,
    onSandbox,
    onClose,
  }: {
    books: LibraryBook[]
    onTour: () => void
    onSandbox: () => void
    onClose: () => void
  } = $props()

  let bookCount = $derived(books.length)

  // per-language default voices — stub rows, per-book overrides win
  const LANGUAGE_DEFAULTS = [
    { language: 'English', voice: 'af_heart' },
    { language: 'Portuguese', voice: 'pt_BR-faber-medium' },
    { language: 'German', voice: 'de_DE-thorsten-medium' },
  ]

  /** App settings as the bridge holds them, read live from the prefs stores. */
  function prefs() {
    // The bridge reads its stores with get(); read them here so the controls
    // follow the selection as it changes.
    void [$selectedModel, $selectedVoice, $selectedQuantization, $selectedDevice]
    return reader.prefs
  }

  /** Voices on offer for a model, fitted to the current book's language. */
  function voicesForModel(model: string) {
    return voiceOptionsFor(model as SelectedModel, reader.book?.language ?? 'en', $piperVoices)
  }

  let storage = $state<{ usage: number; quota: number } | null>(null)
  $effect(() => {
    getStorageUsage().then((s) => (storage = s))
  })
  let usageLine = $derived(
    storage ? `${fmtMb(storage.usage)} used of ${fmtMb(storage.quota)}` : 'calculating…'
  )
  function fmtMb(bytes: number) {
    return `${Math.round(bytes / 1024 / 1024)} MB`
  }

  /** Audio kept per book, so the list can say what a removal would free. */
  let bookAudio = $state<Record<number, number>>({})
  async function measureBooks() {
    const measured = await Promise.all(
      books
        .filter((b) => b.id != null)
        .map(async (b) => [b.id!, await getBookAudioUsage(b.id!)] as const)
    )
    bookAudio = Object.fromEntries(measured)
  }

  async function removeAudio(book: LibraryBook) {
    if (book.id == null) return
    await deleteBookAudio(book.id)
    reader.forgetAudio(book)
    await Promise.all([measureBooks(), refreshStorage()])
  }

  async function refreshStorage() {
    const s = await getStorageUsage()
    storage = s
  }

  /** Models downloaded for on-device speech (Kokoro weights, Piper voices). */
  let models = $state<CachedModel[]>([])
  async function measureModels() {
    models = (await getStorageInfo()).models
  }

  async function removeModel(model: CachedModel) {
    try {
      await deleteCachedModel(model.cacheName, model.cacheKey, model.storageType)
      await Promise.all([measureModels(), refreshStorage()])
    } catch (error) {
      console.warn('Could not remove the model', error)
    }
  }

  $effect(() => {
    void measureBooks()
    void measureModels()
  })
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
      <select bind:value={reader.prefs.rate}>
        <option value={1}>1×</option>
        <option value={1.25}>1.25×</option>
        <option value={1.5}>1.5×</option>
        <option value={2}>2×</option>
      </select>
    </label>
    <label class="field">
      Continue into next chapter
      <input type="checkbox" bind:checked={reader.prefs.autoContinue} />
    </label>

    <h3>Voice & speech</h3>
    <button class="action" onclick={onSandbox}>Test voices & models…</button>
    <label class="field">
      Model
      <select
        bind:value={reader.prefs.model}
        onchange={(e) => (reader.prefs.voice = voicesForModel(e.currentTarget.value)[0]?.id ?? '')}
      >
        {#each MODEL_OPTIONS as m (m.id)}
          <option value={m.id}>{m.name}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      Voice
      <select bind:value={reader.prefs.voice}>
        {#each voicesForModel(prefs().model) as v (v.id)}
          <option value={v.id}>{v.label}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      Quantization
      <select bind:value={reader.prefs.quantization}>
        <option value="fp32">fp32</option>
        <option value="fp16">fp16</option>
        <option value="q8">q8</option>
        <option value="q4">q4</option>
        <option value="q4f16">q4f16</option>
      </select>
    </label>
    <label class="field">
      Device
      <select bind:value={reader.prefs.device}>
        <option value="auto">auto</option>
        <option value="webgpu">webgpu</option>
        <option value="wasm">wasm</option>
        <option value="cpu">cpu</option>
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
      {bookCount} book{bookCount === 1 ? '' : 's'} in library · {usageLine}
    </p>
    {#each books as b (b.id)}
      {#if (bookAudio[b.id ?? 0] ?? 0) > 0}
        <div class="field">
          <span>{b.title}</span>
          <span class="note">{fmtMb(bookAudio[b.id ?? 0])}</span>
          <button class="action" onclick={() => void removeAudio(b)}>Delete audio</button>
        </div>
      {/if}
    {/each}
    {#each models as model (model.cacheKey)}
      <div class="field">
        <span>{model.name}</span>
        <span class="note">{formatBytes(model.size)}</span>
        <button class="action" onclick={() => void removeModel(model)}>Remove download</button>
      </div>
    {/each}
    {#if models.length === 0}
      <p class="note">No speech models downloaded yet.</p>
    {/if}
    <p class="note">
      Generated audio is stored with its book — removing a book frees the space again.
    </p>

    <h3>About</h3>
    <p class="note">Audiobook Generator — books, audio and settings stay on this device.</p>
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
