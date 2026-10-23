<script lang="ts">
  // PROTOTYPE (throwaway): three radically different variants of the revamped
  // reading experience, switchable via ?variant= on prototype.html.
  // A (Vanish) — whole-book scroll, chrome that disappears.
  // B (Shelf)  — home shelf + horizontally paged reader with audio dock.
  // C (Split)  — persistent chapter rail + reading pane, no navigation at all.
  // Read-only against the real library; falls back to demo books when empty.
  import { onMount } from 'svelte'
  import type { Book } from '../lib/types/book'
  import { getAllBooksMetadata, getBook } from '../lib/libraryDB'
  import { makeDemoBooks } from './demoBook'
  import { audio } from './audioSim.svelte'
  import PrototypeSwitcher from './PrototypeSwitcher.svelte'
  import VariantA from './VariantA.svelte'
  import VariantB from './VariantB.svelte'
  import VariantC from './VariantC.svelte'

  const VARIANTS = [
    { key: 'A', name: '(Vanish)' },
    { key: 'B', name: '(Shelf)' },
    { key: 'C', name: '(Split)' },
  ]

  let variant = $state('A')
  let books = $state<Book[]>([])
  let loaded = $state(false)
  let usingDemo = $state(false)
  let ui = $state({ bookIndex: 0, chapterIndex: 0, progress: 0 })

  let currentBook = $derived(books[ui.bookIndex] ?? books[0])

  let stateSummary = $derived(
    currentBook
      ? `"${currentBook.title}" · ch ${ui.chapterIndex + 1}/${currentBook.chapters.length} · ${Math.round(ui.progress * 100)}% · ♪ ${audio.chapterId ? (audio.playing ? 'playing' : 'paused') : `${audio.readyCount(currentBook.chapters.map((c) => c.id))} ready`}`
      : loaded
        ? 'no books'
        : 'loading…'
  )

  // Fake audiobook pipeline: seed per-book state (so every book shows honest
  // generation progress) and continue into the next chapter when playback ends.
  $effect(() => {
    const list = books
    if (list.length === 0) return
    list.forEach((b) => audio.seed(b.chapters))
    const b = currentBook
    if (!b) return
    audio.onNext = (finishedId: string) => {
      if (!audio.prefs.autoContinue) return
      const i = b.chapters.findIndex((c) => c.id === finishedId)
      const next = b.chapters[i + 1]
      if (next) audio.play(next.id)
    }
  })

  onMount(async () => {
    variant = new URLSearchParams(location.search).get('variant') ?? 'A'

    try {
      const meta = await getAllBooksMetadata()
      const recent = [...meta].sort((a, b) => b.lastAccessed - a.lastAccessed).slice(0, 8)
      const loaded = (await Promise.all(recent.map((m) => getBook(m.id)))).filter(
        (b): b is NonNullable<typeof b> => !!b
      )
      if (loaded.length > 0) books = loaded
      else if (!new URLSearchParams(location.search).has('empty')) {
        // ?empty skips the demo fallback so the first-run empty page can be tested
        books = makeDemoBooks()
        usingDemo = true
      }
    } catch {
      if (!new URLSearchParams(location.search).has('empty')) {
        books = makeDemoBooks()
        usingDemo = true
      }
    }
    loaded = true
  })

  function setVariant(key: string) {
    variant = key
    const url = new URL(location.href)
    url.searchParams.set('variant', key)
    history.replaceState(null, '', url)
  }
</script>

{#if !loaded}
  <div class="loading">Loading books…</div>
{:else}
  {#if variant === 'A'}
    <VariantA {books} {ui} />
  {:else if variant === 'B'}
    <VariantB {books} {ui} />
  {:else}
    <VariantC {books} {ui} />
  {/if}
{/if}

{#if usingDemo}
  <div class="demo-note">Library empty — showing built-in demo books</div>
{/if}

<PrototypeSwitcher variants={VARIANTS} current={variant} {stateSummary} onChange={setVariant} />

<style>
  .loading {
    display: grid;
    place-items: center;
    height: 100vh;
    color: var(--secondary-text);
  }

  .demo-note {
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9998;
    background: #f59e0b;
    color: #111;
    font-size: 11px;
    font-family: system-ui, sans-serif;
    padding: 3px 10px;
    border-radius: 999px;
  }
</style>
