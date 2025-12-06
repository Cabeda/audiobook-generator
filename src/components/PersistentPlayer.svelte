<script lang="ts">
  import AudioPlayerBar from './AudioPlayerBar.svelte'
  import { audioPlayerStore, isPlayerActive } from '../stores/audioPlayerStore'
  import { audioService } from '../lib/audioPlaybackService.svelte'
  import { fade } from 'svelte/transition'

  let { onMaximize } = $props<{
    onMaximize: () => void
  }>()

  function handleClose() {
    // Stop playback and clear the player state so the persistent player hides
    audioService.stop()
    audioPlayerStore.stop()
  }
</script>

{#if $isPlayerActive}
  <div in:fade={{ duration: 200 }}>
    <AudioPlayerBar mode="persistent" {onMaximize} onClose={handleClose} />
  </div>
{/if}
