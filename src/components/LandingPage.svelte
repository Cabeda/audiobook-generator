<script lang="ts">
  import UnifiedInput from './UnifiedInput.svelte'
  import { createEventDispatcher } from 'svelte'

  const dispatch = createEventDispatcher()

  function onBookLoaded(event: CustomEvent) {
    dispatch('bookloaded', event.detail)
  }
</script>

<div class="landing-container">
  <div class="hero">
    <div class="hero-content">
      <h1 class="title">Audiobook Generator</h1>
      <p class="subtitle">
        Turn any eBook or web article into a high-quality audiobook in seconds.
        <br />
        Private, local, and free.
      </p>

      <div class="input-wrapper">
        <UnifiedInput on:bookloaded={onBookLoaded} />
      </div>

      <div class="features">
        <div class="feature-item">
          <span class="icon">🔒</span>
          <span>100% Local Processing</span>
        </div>
        <div class="feature-item">
          <span class="icon">⚡</span>
          <span>Instant Generation</span>
        </div>
        <div class="feature-item">
          <span class="icon">🎙️</span>
          <span>Powered by Kokoro AI</span>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .landing-container {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
    padding: 20px;
    font-family:
      'Inter',
      system-ui,
      -apple-system,
      sans-serif;
  }

  .hero {
    width: 100%;
    max-width: 800px;
    text-align: center;
    background: rgba(255, 255, 255, 0.8);
    backdrop-filter: blur(10px);
    border-radius: 24px;
    padding: 60px 40px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.5);
  }

  .title {
    font-size: 3.5rem;
    font-weight: 800;
    margin: 0 0 16px;
    background: linear-gradient(135deg, #2196f3 0%, #9c27b0 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    letter-spacing: -0.02em;
  }

  .subtitle {
    font-size: 1.25rem;
    color: #555;
    line-height: 1.6;
    margin-bottom: 48px;
    font-weight: 400;
  }

  .input-wrapper {
    margin-bottom: 48px;
    transform: scale(1.05);
    transition: transform 0.3s ease;
  }

  .input-wrapper:hover {
    transform: scale(1.06);
  }

  .features {
    display: flex;
    justify-content: center;
    gap: 32px;
    flex-wrap: wrap;
  }

  .feature-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.95rem;
    color: #666;
    font-weight: 500;
    background: rgba(255, 255, 255, 0.5);
    padding: 8px 16px;
    border-radius: 100px;
    border: 1px solid rgba(0, 0, 0, 0.05);
  }

  .icon {
    font-size: 1.2em;
  }

  @media (max-width: 600px) {
    .title {
      font-size: 2.5rem;
    }
    .hero {
      padding: 40px 20px;
    }
    .features {
      gap: 16px;
    }
  }
</style>
