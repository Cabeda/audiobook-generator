<script lang="ts">
  import { fade, fly } from 'svelte/transition'
  import { modelLoadingStore } from '../stores/modelLoadingStore'

  let state = $derived($modelLoadingStore)
  let visible = $derived(state.loading || state.message === 'Model ready')
</script>

{#if visible}
  <div
    class="model-pill"
    class:ready={!state.loading}
    role="status"
    aria-live="polite"
    aria-label={state.message}
    in:fly={{ y: 16, duration: 200 }}
    out:fade={{ duration: 300 }}
  >
    {#if state.loading}
      <span class="spinner" aria-hidden="true"></span>
    {:else}
      <span class="check" aria-hidden="true">✓</span>
    {/if}

    <span class="label">{state.message}</span>

    {#if state.loading && state.progress !== undefined}
      <span class="pct">{state.progress}%</span>
      <div class="bar-track" aria-hidden="true">
        <div class="bar-fill" style="width: {state.progress}%"></div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .model-pill {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9000;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-radius: 999px;
    background: var(--surface-color, #1e293b);
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    font-size: 0.8rem;
    color: var(--secondary-text, #94a3b8);
    white-space: nowrap;
    max-width: calc(100vw - 40px);
    overflow: hidden;
    pointer-events: none;
  }

  .model-pill.ready {
    color: #4ade80;
    border-color: rgba(74, 222, 128, 0.3);
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  .check {
    font-size: 0.85rem;
    flex-shrink: 0;
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 260px;
  }

  .pct {
    font-variant-numeric: tabular-nums;
    font-size: 0.75rem;
    opacity: 0.7;
    flex-shrink: 0;
  }

  .bar-track {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 0 0 999px 999px;
  }

  .bar-fill {
    height: 100%;
    background: var(--primary-color, #3b82f6);
    border-radius: inherit;
    transition: width 0.3s ease;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
