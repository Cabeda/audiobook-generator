<script lang="ts">
  import type { Snippet } from 'svelte'

  let { children }: { children: Snippet } = $props()

  let error = $state<Error | null>(null)
  let showDetails = $state(false)

  function handleError(e: ErrorEvent | PromiseRejectionEvent) {
    const err = 'reason' in e ? e.reason : e.error
    if (err instanceof Error) {
      error = err
    } else {
      error = new Error(String(err ?? 'Unknown error'))
    }
  }

  function retry() {
    location.reload()
  }

  $effect(() => {
    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleError)
    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleError)
    }
  })
</script>

{#if error}
  <div class="error-boundary">
    <div class="error-content">
      <h2>Something went wrong</h2>
      <p>An unexpected error occurred. You can try reloading the page.</p>
      <div class="error-actions">
        <button class="btn-primary" onclick={retry}>Try again</button>
        <a
          class="btn-secondary"
          href="https://github.com/Cabeda/audiobook-generator/issues/new?title=Bug:+{encodeURIComponent(
            error.message
          )}"
          target="_blank"
          rel="noopener noreferrer"
        >
          Report bug
        </a>
      </div>
      <button class="details-toggle" onclick={() => (showDetails = !showDetails)}>
        {showDetails ? '▾ Hide details' : '▸ Show details'}
      </button>
      {#if showDetails}
        <pre class="error-details">{error.message}\n{error.stack ?? ''}</pre>
      {/if}
    </div>
  </div>
{:else}
  {@render children()}
{/if}

<style>
  .error-boundary {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
    padding: 24px;
  }

  .error-content {
    max-width: 500px;
    text-align: center;
  }

  .error-content h2 {
    color: var(--text-color);
    margin-bottom: 8px;
  }

  .error-content p {
    color: var(--secondary-text, #888);
    margin-bottom: 16px;
  }

  .error-actions {
    display: flex;
    gap: 12px;
    justify-content: center;
    margin-bottom: 16px;
  }

  .btn-primary {
    padding: 8px 20px;
    background: var(--primary-color, #3b82f6);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
  }

  .btn-secondary {
    padding: 8px 20px;
    background: var(--surface-color, #2a2a2a);
    color: var(--text-color);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    text-decoration: none;
    font-size: 0.9rem;
  }

  .details-toggle {
    background: none;
    border: none;
    color: var(--secondary-text, #888);
    cursor: pointer;
    font-size: 0.8rem;
  }

  .error-details {
    margin-top: 8px;
    padding: 12px;
    background: var(--surface-color, #1a1a1a);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    font-size: 0.75rem;
    text-align: left;
    overflow-x: auto;
    white-space: pre-wrap;
    color: var(--secondary-text, #888);
  }
</style>
