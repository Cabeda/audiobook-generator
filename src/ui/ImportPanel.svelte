<script lang="ts">
  // Import panel — drag & drop, file picker, or URL. Imports straight into the
  // library through the book session, which also saves the original file.
  import { importBook } from '../lib/services/bookSession'
  import type { LibraryBook } from '../lib/libraryDB'

  let { onImported, onClose }: { onImported: (b: LibraryBook) => void; onClose: () => void } =
    $props()

  let url = $state('')
  let busy = $state(false)
  let error = $state('')
  let dragging = $state(false)

  async function addFile(f: File) {
    busy = true
    error = ''
    try {
      onImported(await importBook({ file: f }))
      onClose()
    } catch (e) {
      error = `Could not read "${f.name}" — ${(e as Error).message}`
    } finally {
      busy = false
    }
  }

  function onFiles(files: FileList | null) {
    const f = files?.[0]
    if (f) addFile(f)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation() // the reader root also accepts drops — don't double-import
    dragging = false
    onFiles(e.dataTransfer?.files ?? null)
  }

  async function addUrl() {
    const u = url.trim()
    if (!u) return
    busy = true
    error = ''
    try {
      onImported(await importBook({ url: u }))
      onClose()
    } catch (e) {
      error = `Could not fetch URL — ${(e as Error).message}`
    } finally {
      busy = false
    }
  }
</script>

<div class="backdrop" onclick={onClose} role="presentation"></div>
<div class="panel" role="dialog" aria-label="Add a book">
  <header>
    <h2>Add a book</h2>
    <button class="icon" onclick={onClose} aria-label="Close">✕</button>
  </header>

  <div
    class="drop"
    class:over={dragging}
    ondragover={(e) => {
      e.preventDefault()
      dragging = true
    }}
    ondragleave={() => (dragging = false)}
    ondrop={onDrop}
    role="button"
    tabindex="0"
    aria-label="Drop a book file here"
  >
    <span class="drop-icon">⤓</span>
    <p>{dragging ? 'Drop to add' : 'Drag a book file here'}</p>
    <label class="pick">
      or choose a file
      <input
        type="file"
        hidden
        accept=".epub,.pdf,.txt,.md,.html"
        onchange={(e) => onFiles((e.currentTarget as HTMLInputElement).files)}
      />
    </label>
  </div>

  <div class="divider"><span>or import from URL</span></div>

  <div class="url-row">
    <input
      bind:value={url}
      placeholder="https://…/book.epub"
      aria-label="Book URL"
      onkeydown={(e) => e.key === 'Enter' && addUrl()}
    />
    <button class="go" onclick={addUrl} disabled={busy}>Fetch</button>
  </div>

  {#if busy}
    <p class="note">Reading…</p>
  {/if}
  {#if error}
    <p class="err">{error}</p>
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 60;
  }

  .panel {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 61;
    width: min(420px, calc(100vw - 32px));
    background: var(--surface-color, #fff);
    color: var(--text-color, #1c1917);
    border: 1px solid var(--border-color, #e7e5e4);
    border-radius: 16px;
    padding: 18px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.25);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }

  h2 {
    margin: 0;
    font-size: 1.05rem;
  }

  .icon {
    background: none;
    border: none;
    color: var(--secondary-text, #78716c);
    cursor: pointer;
    font-size: 0.95rem;
    padding: 8px;
    min-height: 36px;
    border-radius: 8px;
  }

  .icon:hover {
    background: var(--hover-bg, rgba(120, 113, 108, 0.12));
    color: var(--text-color, #1c1917);
  }

  .drop {
    border: 2px dashed var(--border-color, #e7e5e4);
    border-radius: 12px;
    padding: 26px 16px;
    text-align: center;
    transition:
      border-color 0.15s,
      background 0.15s;
  }

  .drop.over {
    border-color: var(--primary-color, #78716c);
    background: var(--hover-bg, rgba(120, 113, 108, 0.08));
  }

  .drop-icon {
    font-size: 1.6rem;
    color: var(--secondary-text, #78716c);
  }

  .drop p {
    margin: 6px 0 12px;
    color: var(--secondary-text, #78716c);
    font-size: 0.9rem;
  }

  .pick {
    display: inline-block;
    background: var(--text-color, #1c1917);
    color: var(--bg-color, #faf9f7);
    border-radius: 10px;
    padding: 9px 16px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 38px;
  }

  .divider {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--secondary-text, #78716c);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin: 16px 0 10px;
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border-color, #e7e5e4);
  }

  .url-row {
    display: flex;
    gap: 8px;
  }

  .url-row input {
    flex: 1;
    min-width: 0;
    border: 1px solid var(--border-color, #e7e5e4);
    background: var(--input-bg, #fff);
    color: var(--text-color, #1c1917);
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 0.88rem;
    min-height: 42px;
  }

  .go {
    background: var(--text-color, #1c1917);
    color: var(--bg-color, #faf9f7);
    border: none;
    border-radius: 10px;
    padding: 0 18px;
    font-weight: 600;
    cursor: pointer;
    min-height: 42px;
  }

  .go:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .note {
    margin: 10px 0 0;
    font-size: 0.82rem;
    color: var(--secondary-text, #78716c);
  }

  .err {
    margin: 10px 0 0;
    font-size: 0.82rem;
    color: var(--error-color, #c2847a);
  }
</style>
