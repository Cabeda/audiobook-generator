<script lang="ts">
  import type { EPubBook, Chapter } from '../lib/epubParser'
  import { generateVoice } from '../lib/kokoro/kokoroClient'
  import { createEventDispatcher } from 'svelte'

  export let book: EPubBook
  export let selectedMap: Map<string, boolean>

  const dispatch = createEventDispatcher()
  let running = false
  let progressText = ''
  let canceled = false

  function getSelectedChapters(): Chapter[] {
    return book.chapters.filter(ch => selectedMap.get(ch.id))
  }

  async function generate() {
    const chapters = getSelectedChapters()
    if (chapters.length === 0) { alert('No chapters selected'); return }
    running = true
    canceled = false

    for (let i = 0; i < chapters.length; i++) {
      if (canceled) break
      const ch = chapters[i]
      progressText = `Generating ${i+1}/${chapters.length}: ${ch.title}`
      try {
        const blob = await generateVoice({ text: ch.content })
        dispatch('generated', { id: ch.id, blob })
      } catch (err) {
        console.error('Synth error', err)
        alert('Synthesis failed for chapter: ' + ch.title)
      }
    }

    running = false
    progressText = ''
    if (canceled) dispatch('canceled')
    else dispatch('done')
  }

  function cancel() {
    canceled = true
  }
</script>

<style>
  .panel { border: 1px solid #eee; padding: 12px; border-radius: 8px; margin-top:12px }
</style>

<div class="panel">
  <h3>Generate Audio</h3>
  <div>Selected chapters: {getSelectedChapters().length}</div>
  <div style="margin-top:8px">
    <button on:click={generate} disabled={running}>Generate</button>
    <button on:click={cancel} disabled={!running}>Cancel</button>
    <span style="margin-left:12px">{progressText}</span>
  </div>
</div>