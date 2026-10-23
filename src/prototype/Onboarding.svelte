<script lang="ts">
  // PROTOTYPE: first-run onboarding — what the app does, pick a model + voice,
  // add the first book. The sound step IS the voice sandbox, so the same screen
  // is reusable outside the tour.
  import VoiceSandbox from './VoiceSandbox.svelte'

  let {
    onImport,
    onDemo,
    onClose,
  }: { onImport: () => void; onDemo: () => void; onClose: () => void } = $props()

  let step = $state(0)

  function next() {
    step = Math.min(2, step + 1)
  }

  function back() {
    step = Math.max(0, step - 1)
  }
</script>

<div class="backdrop"></div>
<div class="panel" role="dialog" aria-label="Welcome">
  <div class="dots">
    {#each [0, 1, 2] as s (s)}
      <span class="dot" class:on={s === step}></span>
    {/each}
  </div>

  {#if step === 0}
    <h2>Read anything. Listen to anything.</h2>
    <p class="lead">
      Add an EPUB, PDF or text file and read it — or have it read to you, sentence by sentence. Your
      books stay on this device.
    </p>
    <ul class="bullets">
      <li><strong>Read</strong> — one clean scroll, no clutter.</li>
      <li><strong>Listen</strong> — tap play, generation happens quietly in the background.</li>
      <li><strong>Follow along</strong> — the spoken sentence is highlighted as it goes.</li>
    </ul>
    <button class="go" onclick={next}>Get started</button>
    <button class="skip" onclick={onClose}>Skip for now</button>
  {:else if step === 1}
    <h2>Choose how it should sound</h2>
    <p class="lead">
      Pick a language, compare the models that speak it, and hear them read any text. This sandbox
      is always available from settings — no book needed.
    </p>

    <VoiceSandbox />

    <div class="nav">
      <button class="skip" onclick={back}>Back</button>
      <button class="go" onclick={next}>Continue</button>
    </div>
  {:else}
    <h2>Add your first book</h2>
    <p class="lead">
      Drag a file in, pick one from your device, or start with a demo book to see how listening
      works.
    </p>
    <button class="go" onclick={onImport}>＋ Add a book</button>
    <button class="ghost" onclick={onDemo}>Load demo books</button>
    <div class="nav">
      <button class="skip" onclick={back}>Back</button>
      <button class="skip" onclick={onClose}>I'll do this later</button>
    </div>
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 70;
  }

  .panel {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 71;
    width: min(520px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    background: var(--surface-color, #fff);
    color: var(--text-color, #1c1917);
    border-radius: 18px;
    padding: 26px;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.35);
    text-align: center;
  }

  .dots {
    display: flex;
    gap: 6px;
    justify-content: center;
    margin-bottom: 18px;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--border-color, #e7e5e4);
  }

  .dot.on {
    background: var(--text-color, #1c1917);
  }

  h2 {
    margin: 0 0 10px;
    font-size: 1.35rem;
    letter-spacing: -0.01em;
  }

  h3 {
    margin: 18px 0 8px;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--secondary-text, #78716c);
    text-align: left;
  }

  .lead {
    margin: 0 0 18px;
    color: var(--secondary-text, #78716c);
    font-size: 0.92rem;
    line-height: 1.6;
  }

  .bullets {
    list-style: none;
    margin: 0 0 22px;
    padding: 0;
    text-align: left;
  }

  .bullets li {
    padding: 8px 0;
    font-size: 0.9rem;
    border-bottom: 1px solid var(--border-color, #e7e5e4);
  }

  .go {
    width: 100%;
    background: var(--text-color, #1c1917);
    color: var(--bg-color, #faf9f7);
    border: none;
    border-radius: 12px;
    padding: 12px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 46px;
    margin-top: 6px;
  }

  .ghost {
    width: 100%;
    background: none;
    border: 1px solid var(--border-color, #e7e5e4);
    color: inherit;
    border-radius: 12px;
    padding: 12px;
    font-size: 0.9rem;
    cursor: pointer;
    min-height: 46px;
    margin-top: 10px;
  }

  .skip {
    background: none;
    border: none;
    color: var(--secondary-text, #78716c);
    cursor: pointer;
    font-size: 0.85rem;
    padding: 12px;
    min-height: 44px;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .nav {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 12px;
  }

  .nav .go {
    width: auto;
    padding: 12px 26px;
    margin: 0;
  }

  @media (max-width: 640px) {
    .panel {
      width: calc(100vw - 16px);
      padding: 20px 16px;
    }
  }
</style>
