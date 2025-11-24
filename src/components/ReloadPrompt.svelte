<script lang="ts">
  import { useRegisterSW } from 'virtual:pwa-register/svelte'
  import { toastStore } from '../stores/toastStore'
  import { onMount } from 'svelte'

  const { offlineReady, needRefresh, updateServiceWorker } = useRegisterSW({
    onRegistered(r: any) {
      console.log('SW Registered:', r)
    },
    onRegisterError(error: any) {
      console.log('SW registration error', error)
    },
  })

  function close() {
    offlineReady.set(false)
    needRefresh.set(false)
  }

  // Watch for offline ready and show a toast
  $effect(() => {
    if ($offlineReady) {
      toastStore.success('App ready to work offline')
      close()
    }
  })
</script>

{#if $needRefresh}
  <div class="pwa-toast" role="alert">
    <div class="message">
      <span>New content available, click on reload button to update.</span>
    </div>
    <div class="buttons">
      <button onclick={() => updateServiceWorker(true)}>Reload</button>
      <button onclick={close}>Close</button>
    </div>
  </div>
{/if}

<style>
  .pwa-toast {
    position: fixed;
    right: 0;
    bottom: 0;
    margin: 16px;
    padding: 12px;
    border: 1px solid #8885;
    border-radius: 4px;
    z-index: 10000;
    text-align: left;
    box-shadow: 3px 4px 5px 0 #8885;
    background-color: white;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .message {
    margin-bottom: 8px;
  }

  .buttons {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  button {
    border: 1px solid #8885;
    outline: none;
    margin-right: 5px;
    border-radius: 2px;
    padding: 3px 10px;
    cursor: pointer;
    background-color: white;
  }

  button:hover {
    background-color: #f0f0f0;
  }

  @media (prefers-color-scheme: dark) {
    .pwa-toast {
      background-color: #333;
      color: white;
      border-color: #555;
    }

    button {
      background-color: #444;
      color: white;
      border-color: #666;
    }

    button:hover {
      background-color: #555;
    }
  }
</style>
