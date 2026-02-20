<script lang="ts">
  import { toastStore } from '../stores/toastStore'
  import { fade, fly } from 'svelte/transition'

  const toasts = $derived($toastStore)
</script>

<div class="toast-container">
  {#each toasts as toast (toast.id)}
    <div
      class="toast toast-{toast.type}"
      transition:fly={{ y: -20, duration: 200 }}
      onclick={() => toastStore.dismiss(toast.id)}
    >
      <span class="toast-icon">
        {#if toast.type === 'success'}✓
        {:else if toast.type === 'error'}✕
        {:else if toast.type === 'warning'}⚠
        {:else}ℹ{/if}
      </span>
      <span class="toast-message">{toast.message}</span>
    </div>
  {/each}
</div>

<style>
  .toast-container {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-radius: 8px;
    background: #2a2a2a;
    color: white;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    min-width: 250px;
    max-width: 400px;
    pointer-events: auto;
    cursor: pointer;
  }

  .toast-icon {
    font-size: 18px;
    flex-shrink: 0;
  }

  .toast-message {
    flex: 1;
    font-size: 14px;
  }

  .toast-info {
    background: #3b82f6;
  }

  .toast-success {
    background: #10b981;
  }

  .toast-warning {
    background: #f59e0b;
  }

  .toast-error {
    background: #ef4444;
  }
</style>
