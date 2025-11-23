<script lang="ts">
  import { toastStore } from '../stores/toastStore'

  function getIcon(type: string) {
    switch (type) {
      case 'success':
        return '✅'
      case 'error':
        return '❌'
      case 'warning':
        return '⚠️'
      case 'info':
        return 'ℹ️'
      default:
        return ''
    }
  }
</script>

<div class="toast-container">
  {#each $toastStore as toast (toast.id)}
    <div class="toast toast-{toast.type}" role="alert">
      <span class="toast-icon">{getIcon(toast.type)}</span>
      <span class="toast-message">{toast.message}</span>
      <button
        class="toast-close"
        onclick={() => toastStore.dismiss(toast.id)}
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  {/each}
</div>

<style>
  .toast-container {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 400px;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-radius: 8px;
    background: white;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    animation: slideIn 0.3s ease-out;
    border-left: 4px solid;
  }

  @keyframes slideIn {
    from {
      transform: translateX(400px);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  .toast-success {
    border-left-color: #10b981;
    background: #f0fdf4;
  }

  .toast-error {
    border-left-color: #ef4444;
    background: #fef2f2;
  }

  .toast-warning {
    border-left-color: #f59e0b;
    background: #fffbeb;
  }

  .toast-info {
    border-left-color: #3b82f6;
    background: #eff6ff;
  }

  .toast-icon {
    font-size: 1.25rem;
    flex-shrink: 0;
  }

  .toast-message {
    flex: 1;
    font-size: 0.875rem;
    font-weight: 500;
    color: #1f2937;
  }

  .toast-close {
    background: none;
    border: none;
    color: #6b7280;
    cursor: pointer;
    font-size: 1.125rem;
    padding: 0;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: all 0.2s;
  }

  .toast-close:hover {
    background: rgba(0, 0, 0, 0.1);
    color: #1f2937;
  }

  @media (max-width: 640px) {
    .toast-container {
      left: 20px;
      right: 20px;
      max-width: none;
    }
  }

  /* Dark mode support */
  @media (prefers-color-scheme: dark) {
    .toast-success {
      background: #064e3b;
      border-left-color: #10b981;
    }

    .toast-error {
      background: #7f1d1d;
      border-left-color: #ef4444;
    }

    .toast-warning {
      background: #78350f;
      border-left-color: #f59e0b;
    }

    .toast-info {
      background: #1e3a8a;
      border-left-color: #3b82f6;
    }

    .toast-message {
      color: #f9fafb;
    }

    .toast-close {
      color: #d1d5db;
    }

    .toast-close:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #f9fafb;
    }
  }
</style>
