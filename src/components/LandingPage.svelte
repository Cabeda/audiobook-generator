<script lang="ts">
  import UnifiedInput from './UnifiedInput.svelte'
  import LibraryView from './LibraryView.svelte'
  import { createEventDispatcher, onMount } from 'svelte'
  import { getBook, updateLastAccessed } from '../lib/libraryDB'
  import { libraryBooks } from '../stores/libraryStore'
  import { book } from '../stores/bookStore'
  import { appTheme, toggleTheme } from '../stores/themeStore'
  import { toastStore } from '../stores/toastStore'

  const dispatch = createEventDispatcher()

  let currentView = $state<'upload' | 'library'>('upload')

  // Sync currentView with URL hash, defaulting to library if user has books
  function syncViewFromHash() {
    const hash = location.hash.replace(/^#/, '') || '/'
    if (hash === '/library') {
      currentView = 'library'
    } else if (hash === '/' || hash === '') {
      // For root hash, show library if user has books (returning user)
      currentView = $libraryBooks.length > 0 ? 'library' : 'upload'
    } else {
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
      toastStore.error('Failed to load book from library')
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
        Turn any eBook or web article into a high-quality audiobook. Private, local, and free.
      </p>

      <!-- Tab Navigation -->
      <div class="tabs" role="tablist" aria-label="Main navigation">
        <button
          id="upload-tab"
          class="tab"
          class:active={currentView === 'upload'}
          onclick={switchToUpload}
          role="tab"
          aria-selected={currentView === 'upload'}
          aria-controls="upload-panel"
        >
          Upload New
        </button>
        <button
          id="library-tab"
          class="tab"
          class:active={currentView === 'library'}
          onclick={switchToLibrary}
          role="tab"
          aria-selected={currentView === 'library'}
          aria-controls="library-panel"
        >
          My Library
          {#if $libraryBooks.length > 0}
            <span class="library-count" aria-label="{$libraryBooks.length} books"
              >{$libraryBooks.length}</span
            >
          {/if}
        </button>
      </div>

      <!-- Content based on selected tab -->
      {#if currentView === 'upload'}
        <div class="input-wrapper" role="tabpanel" id="upload-panel" aria-labelledby="upload-tab">
          <UnifiedInput on:bookloaded={onBookLoaded} />
          <p class="drm-note">DRM-free files only</p>
        </div>
      {:else}
        <div
          class="library-wrapper"
          role="tabpanel"
          id="library-panel"
          aria-labelledby="library-tab"
        >
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
      aria-label="View on GitHub"
    >
      <svg height="20" width="20" viewBox="0 0 16 16" version="1.1" aria-hidden="true">
        <path
          fill="currentColor"
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
        ></path>
      </svg>
    </a>

    <button class="theme-toggle" onclick={toggleTheme} aria-label="Toggle dark mode">
      {#if $appTheme === 'light'}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
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
          width="18"
          height="18"
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

    <button class="settings-btn" onclick={() => dispatch('opensettings')} aria-label="Settings">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="3"></circle>
        <path
          d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
        ></path>
      </svg>
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
    transition: background-color 0.3s;
  }

  .hero {
    width: 100%;
    max-width: 720px;
    text-align: center;
    background: var(--hero-bg);
    border-radius: 20px;
    padding: 32px 24px;
    box-shadow: 0 8px 24px var(--shadow-color);
    border: 1px solid var(--border-color);
    transition: background-color 0.3s;
  }

  .title {
    font-size: 2rem;
    font-weight: 700;
    margin: 0 0 8px;
    color: var(--text-color);
    letter-spacing: -0.02em;
  }

  .subtitle {
    font-size: 1rem;
    color: var(--secondary-text);
    line-height: 1.5;
    margin-bottom: 24px;
    font-weight: 400;
  }

  .tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 24px;
    justify-content: center;
  }

  .tab {
    padding: 10px 20px;
    border: 1px solid var(--border-color);
    background: var(--feature-bg);
    color: var(--secondary-text);
    border-radius: 10px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      background-color 0.2s,
      color 0.2s;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .tab:hover {
    background: var(--surface-color);
    color: var(--text-color);
  }

  .tab.active {
    background: var(--primary-color);
    color: var(--bg-color);
    border-color: transparent;
  }

  .library-count {
    background: rgba(255, 255, 255, 0.25);
    color: inherit;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 0.8rem;
    font-weight: 700;
  }

  .library-wrapper {
    margin-top: 16px;
    overflow-y: auto;
    border-radius: 12px;
  }

  .input-wrapper {
    margin-bottom: 16px;
  }

  .drm-note {
    color: var(--secondary-text);
    font-size: 0.75rem;
    margin-top: 8px;
    opacity: 0.7;
  }

  @media (max-width: 600px) {
    .title {
      font-size: 1.6rem;
    }
    .hero {
      padding: 24px 16px;
    }
  }

  .footer {
    margin-top: 24px;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 12px;
  }

  .github-link {
    display: flex;
    align-items: center;
    color: var(--secondary-text);
    text-decoration: none;
    padding: 8px;
    border-radius: 50%;
    transition: color 0.2s;
  }

  .github-link:hover {
    color: var(--text-color);
  }

  .theme-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: none;
    background: transparent;
    color: var(--secondary-text);
    cursor: pointer;
    transition: color 0.2s;
    padding: 0;
  }

  .theme-toggle:hover {
    color: var(--text-color);
  }

  .settings-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: none;
    background: transparent;
    color: var(--secondary-text);
    cursor: pointer;
    transition: color 0.2s;
    padding: 0;
  }

  .settings-btn:hover {
    color: var(--text-color);
  }
</style>
