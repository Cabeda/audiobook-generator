<script lang="ts">
  let dismissed = $state(true)

  try {
    dismissed = localStorage.getItem('onboarding-dismissed') === 'true'
  } catch {
    // localStorage unavailable
  }

  function dismiss() {
    dismissed = true
    try {
      localStorage.setItem('onboarding-dismissed', 'true')
    } catch {
      // localStorage unavailable
    }
  }
</script>

{#if !dismissed}
  <div class="onboarding-banner" role="banner">
    <div class="banner-content">
      <strong>Welcome!</strong> Upload an EPUB, PDF, or paste a URL to generate an audiobook —
      entirely in your browser.
      <a
        href="https://github.com/Cabeda/audiobook-generator#usage"
        target="_blank"
        rel="noopener noreferrer">Learn more</a
      >
    </div>
    <button class="dismiss-btn" onclick={dismiss} aria-label="Dismiss banner">✕</button>
  </div>
{/if}

<style>
  .onboarding-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--surface-color, #1e293b);
    border: 1px solid var(--border-color, rgba(59, 130, 246, 0.3));
    border-radius: 8px;
    margin-bottom: 12px;
  }

  .banner-content {
    flex: 1;
    font-size: 0.9rem;
    color: var(--text-color);
    line-height: 1.4;
  }

  .banner-content a {
    color: var(--primary-color, #3b82f6);
    text-decoration: none;
  }

  .banner-content a:hover {
    text-decoration: underline;
  }

  .dismiss-btn {
    background: none;
    border: none;
    color: var(--secondary-text, #888);
    cursor: pointer;
    font-size: 1.1rem;
    padding: 4px 8px;
    border-radius: 4px;
    min-width: 32px;
    min-height: 32px;
  }

  .dismiss-btn:hover {
    background: var(--hover-bg, rgba(255, 255, 255, 0.05));
  }
</style>
