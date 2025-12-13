<script lang="ts">
  import UnifiedInput from './UnifiedInput.svelte'
  import LibraryView from './LibraryView.svelte'
  import { createEventDispatcher, onMount } from 'svelte'
  import { getBook, updateLastAccessed } from '../lib/libraryDB'
  import { libraryBooks } from '../stores/libraryStore'
  import { book } from '../stores/bookStore'
  import { appTheme, toggleTheme } from '../stores/themeStore'

  const dispatch = createEventDispatcher()

  let currentView = $state<'upload' | 'library'>('upload')

  // Sync currentView with URL hash
  function syncViewFromHash() {
    const hash = location.hash.replace(/^#/, '') || '/'
    if (hash === '/library') {
      currentView = 'library'
    } else {
      // Default to upload for '/', '/upload', or any other hash on landing
      currentView = 'upload'
    }
  }

  onMount(() => {
    // Initialize view from URL on mount
    syncViewFromHash()

    // Listen for hash changes (browser back/forward)
    const handleHashChange = () => {
      syncViewFromHash()
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  })

  function onBookLoaded(event: CustomEvent) {
    dispatch('bookloaded', event.detail)
  }

  async function handleLibraryBookSelected(bookId: number) {
    try {
      // Load book from library
      const libraryBook = await getBook(bookId)
      if (libraryBook) {
        // Update last accessed time
        await updateLastAccessed(bookId)

        // Dispatch book loaded event with library book data
        dispatch('bookloaded', {
          book: {
            title: libraryBook.title,
            author: libraryBook.author,
            cover: libraryBook.cover,
            chapters: libraryBook.chapters,
            format: libraryBook.format,
            language: libraryBook.language,
          },
          fromLibrary: true,
          libraryId: bookId,
        })
      }
    } catch (err) {
      console.error('Failed to load book from library:', err)
      alert('Failed to load book from library')
    }
  }

  function switchToUpload() {
    currentView = 'upload'
    location.hash = '#/'
  }

  function switchToLibrary() {
    currentView = 'library'
    location.hash = '#/library'
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

      <!-- Tab Navigation -->
      <div class="tabs">
        <button class="tab" class:active={currentView === 'upload'} onclick={switchToUpload}>
          📤 Upload New
        </button>
        <button class="tab" class:active={currentView === 'library'} onclick={switchToLibrary}>
          📚 My Library
          {#if $libraryBooks.length > 0}
            <span class="library-count">{$libraryBooks.length}</span>
          {/if}
        </button>
      </div>

      <!-- Content based on selected tab -->
      {#if currentView === 'upload'}
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
            <span>Support Kokoro and Piper AI models</span>
          </div>
        </div>
      {:else}
        <div class="library-wrapper">
          <LibraryView onbookselected={handleLibraryBookSelected} />
        </div>
      {/if}
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

    <button class="theme-toggle" onclick={toggleTheme} aria-label="Toggle dark mode">
      {#if $appTheme === 'light'}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="5"></circle>
          <line x1="12" y1="1" x2="12" y2="3"></line>
          <line x1="12" y1="21" x2="12" y2="23"></line>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
          <line x1="1" y1="12" x2="3" y2="12"></line>
          <line x1="21" y1="12" x2="23" y2="12"></line>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
      {:else}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
      {/if}
    </button>
  </footer>
</div>

<style>
  .landing-container {
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--landing-bg);
    padding: 20px;
    font-family:
      'Inter',
      system-ui,
      -apple-system,
      sans-serif;
    transition: background 0.3s;
  }

  .hero {
    width: 100%;
    max-width: 800px;
    text-align: center;
    background: var(--hero-bg);
    backdrop-filter: blur(10px);
    border-radius: 24px;
    padding: 60px 40px;
    box-shadow: 0 20px 40px var(--shadow-color);
    border: 1px solid rgba(255, 255, 255, 0.1);
    transition:
      background-color 0.3s,
      box-shadow 0.3s;
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
    color: var(--secondary-text);
    line-height: 1.6;
    margin-bottom: 32px;
    font-weight: 400;
  }

  .tabs {
    display: flex;
    gap: 12px;
    margin-bottom: 32px;
    justify-content: center;
  }

  .tab {
    padding: 12px 24px;
    border: 2px solid var(--shadow-color);
    background: var(--feature-bg);
    color: var(--secondary-text);
    border-radius: 12px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tab:hover {
    background: var(--surface-color);
    color: var(--text-color);
    transform: translateY(-2px);
  }

  .tab.active {
    background: linear-gradient(135deg, #2196f3 0%, #9c27b0 100%);
    color: white;
    border-color: transparent;
    box-shadow: 0 4px 12px rgba(33, 150, 243, 0.3);
  }

  .library-count {
    background: rgba(255, 255, 255, 0.3);
    color: white;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 0.875rem;
    font-weight: 700;
  }

  .library-wrapper {
    margin-top: 24px;
    max-height: 600px;
    overflow-y: auto;
    border-radius: 16px;
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
    color: var(--secondary-text);
    font-weight: 500;
    background: var(--feature-bg);
    padding: 8px 16px;
    border-radius: 100px;
    border: 1px solid var(--shadow-color);
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
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }

  .github-link {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--secondary-text);
    text-decoration: none;
    font-weight: 500;
    font-size: 0.95rem;
    padding: 10px 20px;
    background: var(--feature-bg);
    border-radius: 100px;
    transition: all 0.2s ease;
    border: 1px solid var(--shadow-color);
  }

  .github-link:hover {
    background: var(--surface-color);
    color: var(--text-color);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px var(--shadow-color);
  }

  .github-icon {
    opacity: 0.8;
  }

  .theme-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 100px;
    border: 1px solid var(--shadow-color);
    background: var(--feature-bg);
    color: var(--secondary-text);
    cursor: pointer;
    transition: all 0.2s ease;
    padding: 0;
  }

  .theme-toggle:hover {
    background: var(--surface-color);
    color: var(--text-color);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px var(--shadow-color);
  }
</style>
