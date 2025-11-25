<script lang="ts">
  import AudioPlayerBar from './AudioPlayerBar.svelte'
  import { audioPlayerStore } from '../stores/audioPlayerStore'
  import { audioService } from '../lib/audioPlaybackService.svelte'

  let { onMaximize } = $props<{
    onMaximize: () => void
  }>()

  function handleClose() {
    // Stop playback and clear the player state so the persistent player hides
    audioService.stop()
    audioPlayerStore.stop()
  }
</script>

<AudioPlayerBar mode="persistent" {onMaximize} onClose={handleClose} />
