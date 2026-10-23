<script lang="ts">
  // PROTOTYPE: voice sandbox — pick a language, see only the models that speak
  // it, type any text and listen to it. Embedded in onboarding, and available
  // on its own (App settings → Test voices) so models can be compared without
  // loading a book.
  import {
    audio,
    MODELS,
    LANGUAGES,
    SAMPLE_TEXT,
    modelInfo,
    voicesFor,
    supportsLanguage,
  } from './audioSim.svelte'

  let { onClose }: { onClose?: () => void } = $props()

  let text = $state(SAMPLE_TEXT['en'])
  let words = $derived(text.trim().split(/\s+/).filter(Boolean))
  let spoken = $state(-1) // index of the word being spoken
  let playing = $state(false)
  let timer: ReturnType<typeof setInterval> | undefined

  let activeModels = $derived(MODELS.filter((m) => supportsLanguage(m, audio.prefs.language)))
  let hiddenModels = $derived(MODELS.filter((m) => !supportsLanguage(m, audio.prefs.language)))
  let langLabel = $derived(LANGUAGES.find((l) => l.code === audio.prefs.language)?.label ?? '')

  function setLanguage(code: string) {
    stop()
    if (text === SAMPLE_TEXT[audio.prefs.language] || !text.trim())
      text = SAMPLE_TEXT[code] ?? SAMPLE_TEXT['en']
    audio.prefs.language = code
    const vs = voicesFor(audio.prefs.model, code)
    if (!vs.includes(audio.prefs.voice)) audio.prefs.voice = vs[0]
  }

  function setModel(m: string) {
    stop()
    audio.prefs.model = m as typeof audio.prefs.model
    const vs = voicesFor(m, audio.prefs.language)
    if (!vs.includes(audio.prefs.voice)) audio.prefs.voice = vs[0]
  }

  function toggle() {
    if (playing) {
      stop()
      return
    }
    playing = true
    spoken = 0
    // karaoke: one word at a time, roughly 200 wpm at 1×
    timer = setInterval(
      () => {
        spoken++
        if (spoken >= words.length) stop()
      },
      Math.max(120, 60000 / (200 * audio.prefs.rate))
    )
  }

  function stop() {
    clearInterval(timer)
    timer = undefined
    playing = false
  }
</script>

{#snippet body()}
  <h3>Language</h3>
  <div class="langs">
    {#each LANGUAGES as l (l.code)}
      <button
        class="chip"
        class:on={audio.prefs.language === l.code}
        onclick={() => setLanguage(l.code)}
      >
        {l.label}
      </button>
    {/each}
  </div>

  <h3>Models that speak {langLabel}</h3>
  <div class="models">
    {#each activeModels as m (m)}
      <button class="model" class:on={audio.prefs.model === m} onclick={() => setModel(m)}>
        <span class="m-name">{m}</span>
        <span class="m-blurb">{modelInfo(m).blurb}</span>
        <span class="m-size">{modelInfo(m).size}</span>
      </button>
    {/each}
  </div>
  {#if hiddenModels.length > 0}
    <p class="hidden-note">
      Not available for {langLabel}: {hiddenModels.join(', ')}
    </p>
  {/if}

  <h3>Voice</h3>
  <div class="voices">
    {#each voicesFor(audio.prefs.model, audio.prefs.language) as v (v)}
      <button
        class="chip"
        class:on={audio.prefs.voice === v}
        onclick={() => {
          stop()
          audio.prefs.voice = v
        }}
      >
        {v}
      </button>
    {/each}
  </div>

  <h3>Try it</h3>
  <textarea bind:value={text} rows="3" aria-label="Preview text"></textarea>
  <div class="preview">
    <button class="play" onclick={toggle}>{playing ? '❚❚ Stop' : '▶ Listen'}</button>
    {#if playing}
      <span class="speaking">speaking… {Math.min(spoken + 1, words.length)}/{words.length}</span>
    {/if}
  </div>
  <p class="karaoke">
    {#each words as w, i (i)}
      <span class="w" class:read={i < spoken} class:now={i === spoken}>{w} </span>
    {/each}
  </p>
{/snippet}

{#if onClose}
  <div class="backdrop" onclick={onClose} role="presentation"></div>
  <div class="dialog" role="dialog" aria-label="Voice sandbox">
    <header>
      <h2>Voice sandbox</h2>
      <button class="icon" onclick={onClose} aria-label="Close">✕</button>
    </header>
    <div class="body">
      {@render body()}
    </div>
  </div>
{:else}
  {@render body()}
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 70;
  }

  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 71;
    width: min(560px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    background: var(--surface-color, #fff);
    color: var(--text-color, #1c1917);
    border-radius: 18px;
    padding: 22px;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.35);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  h2 {
    margin: 0;
    font-size: 1.15rem;
  }

  h3 {
    margin: 18px 0 8px;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--secondary-text, #78716c);
    text-align: left;
  }

  .langs,
  .voices {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }

  .chip {
    border: 1px solid var(--border-color, #e7e5e4);
    background: none;
    color: inherit;
    border-radius: 999px;
    padding: 7px 13px;
    font-size: 0.8rem;
    cursor: pointer;
    min-height: 36px;
  }

  .chip.on {
    background: var(--text-color, #1c1917);
    color: var(--bg-color, #faf9f7);
    border-color: var(--text-color, #1c1917);
  }

  .models {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .model {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 11px 12px;
    border: 1px solid var(--border-color, #e7e5e4);
    border-radius: 12px;
    background: none;
    cursor: pointer;
    text-align: left;
    color: inherit;
    min-height: 44px;
  }

  .model.on {
    border-color: var(--text-color, #1c1917);
    background: var(--selected-bg, #f5f5f4);
  }

  .m-name {
    font-weight: 700;
    font-size: 0.9rem;
  }

  .m-blurb {
    font-size: 0.76rem;
    color: var(--secondary-text, #78716c);
  }

  .m-size {
    font-size: 0.68rem;
    color: var(--secondary-text, #78716c);
  }

  .hidden-note {
    margin: 8px 0 0;
    font-size: 0.74rem;
    color: var(--secondary-text, #78716c);
  }

  textarea {
    width: 100%;
    border: 1px solid var(--border-color, #e7e5e4);
    background: var(--input-bg, #fff);
    color: inherit;
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 0.92rem;
    line-height: 1.6;
    resize: vertical;
    font-family: inherit;
  }

  .preview {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 10px 0 6px;
  }

  .play {
    background: var(--text-color, #1c1917);
    color: var(--bg-color, #faf9f7);
    border: none;
    border-radius: 999px;
    padding: 10px 20px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 42px;
  }

  .speaking {
    font-size: 0.78rem;
    color: var(--secondary-text, #78716c);
    font-variant-numeric: tabular-nums;
  }

  .karaoke {
    margin: 4px 0 0;
    font-size: 0.92rem;
    line-height: 1.7;
    text-align: left;
    min-height: 3.4em;
  }

  .karaoke .w {
    border-radius: 4px;
    opacity: 0.45;
    transition:
      background 0.15s ease,
      opacity 0.15s ease;
  }

  .karaoke .w.read {
    opacity: 1;
  }

  .karaoke .w.now {
    opacity: 1;
    background: rgba(245, 158, 11, 0.3);
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
    background: var(--selected-bg, #f5f5f4);
    color: var(--text-color, #1c1917);
  }

  @media (max-width: 640px) {
    .dialog {
      width: calc(100vw - 16px);
      padding: 16px;
    }

    .models {
      grid-template-columns: 1fr;
    }
  }
</style>
