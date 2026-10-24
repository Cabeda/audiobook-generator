<script lang="ts">
  import { useRegisterSW } from 'virtual:pwa-register/svelte'
  import { toastStore } from '../stores/toastStore'
  import { onMount } from 'svelte'

  // Updates apply on their own now (see vite.config.ts): this only registers
  // the service worker and reloads once a new one has taken over. The old
  // "New content available" banner is gone with it — its click could never
  // guarantee the update completed, and the banner came back on every launch.
  const { offlineReady, needRefresh } = useRegisterSW({
    // The controllerchange reload below is the single reload path.
    onNeedReload: () => {},
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
  onMount(() => {
    let refreshing = false
    // Listen for new service worker taking over
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return
        refreshing = true
        window.location.reload()
      })
    }
  })
</script>
