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

  <footer class="footer">
    <a
      href="https://github.com/Cabeda/audiobook-generator"
      target="_blank"
      rel="noopener noreferrer"
      class="github-link"
    >
      <svg
        height="24"
        width="24"
        viewBox="0 0 16 16"
        version="1.1"
        class="github-icon"
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
        ></path>
      </svg>
      <span>View on GitHub</span>
    </a>
  </footer>
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

  .footer {
    margin-top: 48px;
    padding: 20px;
    text-align: center;
  }

  .github-link {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #666;
    text-decoration: none;
    font-weight: 500;
    font-size: 0.95rem;
    padding: 10px 20px;
    background: rgba(255, 255, 255, 0.5);
    border-radius: 100px;
    transition: all 0.2s ease;
    border: 1px solid rgba(0, 0, 0, 0.05);
  }

  .github-link:hover {
    background: white;
    color: #333;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  }

  .github-icon {
    opacity: 0.8;
  }
</style>
