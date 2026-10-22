<script lang="ts">
  // Voice sandbox — pick a language, see only the models that speak it, type
  // any text and listen to it. Embedded in onboarding, and available on its
  // own (App settings → Test voices) so models can be compared without loading
  // a book. Previews use the browser's own speech for instant feedback; the
  // full-engine previews happen in the reader, where the model renders audio.
  import {
    MODEL_OPTIONS,
    engineSupportsLanguage,
    getModelInfo,
    isTTSModelType,
    voiceOptionsFor,
    type SelectedModel,
  } from '../lib/tts/ttsModels'
  import { piperVoices } from '../stores/piperVoicesStore'
  import {
    selectedDevice,
    selectedModel,
    selectedQuantization,
    selectedVoice,
  } from '../stores/ttsStore'
  import { reader } from './readerModel.svelte'

  let { onClose }: { onClose?: () => void } = $props()

  const LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'pt', label: 'Português' },
    { code: 'es', label: 'Español' },
    { code: 'fr', label: 'Français' },
    { code: 'de', label: 'Deutsch' },
    { code: 'it', label: 'Italiano' },
    { code: 'nl', label: 'Nederlands' },
    { code: 'pl', label: 'Polski' },
    { code: 'ru', label: 'Русский' },
    { code: 'ja', label: '日本語' },
    { code: 'hi', label: 'हिन्दी' },
  ] as const

  /** Sample sentence per language for the voice sandbox. */
  const SAMPLE_TEXT: Record<string, string> = {
    en: 'The road climbed through the pines until the town was a smudge of smoke below.',
    pt: 'A estrada subia pelos pinheiros até que a cidade fosse apenas uma nuvem de fumo.',
    es: 'La carretera subía por los pinos hasta que el pueblo era solo una mancha de humo.',
    fr: 'La route grimpait dans les pins jusqu’à ce que le village ne soit plus qu’un voile de fumée.',
    de: 'Die Straße stieg durch die Kiefern, bis das Dorf nur noch ein Rauchfleck war.',
    it: 'La strada saliva tra i pini finché il paese non fu solo una macchia di fumo.',
    nl: 'De weg klom door de dennen tot het dorp nog maar een rookvlek was.',
    pl: 'Droga wspinała się przez sosny, aż wioska stała się tylko plamą dymu.',
    ru: 'Дорога поднималась через сосны, пока город не превратился в дымное пятно.',
    ja: '松林を抜けていくと、町は煙の染みのように見えてきた。',
    hi: 'सड़क देवदारों के बीच चढ़ती गई, जब तक कि कस्बा धुएँ का धब्बा न रह जाए।',
  }

  let text = $state(SAMPLE_TEXT['en'])
  let lang = $state('en') // the sandbox explores languages; prefs carry no default
  let words = $derived(text.trim().split(/\s+/).filter(Boolean))
  let spoken = $state(-1) // index of the word being spoken
  let playing = $state(false)
  let timer: ReturnType<typeof setInterval> | undefined

  /** The selection the bridge holds, read live from its prefs stores. */
  function prefs() {
    void [$selectedModel, $selectedVoice, $selectedQuantization, $selectedDevice]
    return reader.prefs
  }

  /** Does the model speak the language? The browser speaks everything. */
  function supportsLanguage(model: SelectedModel, code: string): boolean {
    return model === 'web_speech' || (isTTSModelType(model) && engineSupportsLanguage(model, code))
  }

  /** UI metadata for a model card, from the engine registry. */
  function info(id: SelectedModel) {
    const model = isTTSModelType(id) ? getModelInfo(id) : undefined
    return {
      name: MODEL_OPTIONS.find((o) => o.id === id)?.name ?? id,
      blurb: model?.description ?? '',
      size: model?.requiresDownload ? 'needs download' : 'built into the browser',
    }
  }

  let activeModels = $derived(MODEL_OPTIONS.filter((m) => supportsLanguage(m.id, lang)))
  let hiddenModels = $derived(MODEL_OPTIONS.filter((m) => !supportsLanguage(m.id, lang)))
  let langLabel = $derived(LANGUAGES.find((l) => l.code === lang)?.label ?? '')

  /** Voices on offer for the selected model and language. */
  function voiceOptions() {
    return voiceOptionsFor(prefs().model as SelectedModel, lang, $piperVoices)
  }

  function setLanguage(code: string) {
    stop()
    if (text === SAMPLE_TEXT[lang] || !text.trim()) text = SAMPLE_TEXT[code] ?? SAMPLE_TEXT['en']
    lang = code
    const vs = voiceOptionsFor(prefs().model as SelectedModel, code, $piperVoices)
    if (!vs.some((v) => v.id === prefs().voice)) reader.prefs.voice = vs[0]?.id ?? ''
  }

  function setModel(m: SelectedModel) {
    stop()
    reader.prefs.model = m
    const vs = voiceOptionsFor(m, lang, $piperVoices)
    if (!vs.some((v) => v.id === prefs().voice)) reader.prefs.voice = vs[0]?.id ?? ''
  }

  // Karaoke needs word offsets into `text`: boundary events report charIndex.
  let wordStarts = $derived([...text.matchAll(/\S+/g)].map((m) => m.index))

  function wordAt(charIndex: number): number {
    let index = 0
    for (let i = 0; i < wordStarts.length && wordStarts[i] <= charIndex; i++) index = i
    return index
  }

  function toggle() {
    if (playing) {
      stop()
      return
    }
    playing = true
    spoken = 0
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = lang
    utterance.rate = prefs().rate
    utterance.onboundary = (e) => (spoken = wordAt(e.charIndex))
    utterance.onend = () => stop()
    speechSynthesis.speak(utterance)
    // fallback for engines that fire no boundary events: karaoke at ~200 wpm
    timer = setInterval(
      () => {
        if (spoken < words.length - 1) spoken++
      },
      Math.max(120, 60000 / (200 * prefs().rate))
    )
  }

  function stop() {
    clearInterval(timer)
    timer = undefined
    speechSynthesis.cancel()
    playing = false
  }
</script>

{#snippet body()}
  <h3>Language</h3>
  <div class="langs">
    {#each LANGUAGES as l (l.code)}
      <button class="chip" class:on={lang === l.code} onclick={() => setLanguage(l.code)}>
        {l.label}
      </button>
    {/each}
  </div>

  <h3>Models that speak {langLabel}</h3>
  <div class="models">
    {#each activeModels as m (m.id)}
      <button class="model" class:on={prefs().model === m.id} onclick={() => setModel(m.id)}>
        <span class="m-name">{info(m.id).name}</span>
        <span class="m-blurb">{info(m.id).blurb}</span>
        <span class="m-size">{info(m.id).size}</span>
      </button>
    {/each}
  </div>
  {#if hiddenModels.length > 0}
    <p class="hidden-note">
      Not available for {langLabel}: {hiddenModels.map((m) => info(m.id).name).join(', ')}
    </p>
  {/if}

  <h3>Voice</h3>
  <div class="voices">
    {#each voiceOptions() as v (v.id)}
      <button
        class="chip"
        class:on={prefs().voice === v.id}
        onclick={() => {
          stop()
          reader.prefs.voice = v.id
        }}
      >
        {v.label}
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
