# Quick Implementation Guide - Top 4 Critical Features

## 1. Auto-Scroll During Playback ⭐⭐⭐

### Implementation

**File**: `src/components/TextReader.svelte`

```typescript
// Add state
let autoScrollEnabled = $state(true)

// Watch current segment and scroll
$effect(() => {
  if (!autoScrollEnabled || !audioService.isPlaying) return

  const currentIndex = audioService.currentSegmentIndex
  if (currentIndex < 0) return

  const segmentEl = document.getElementById(`seg-${currentIndex}`)
  if (!segmentEl) return

  const container = textContentEl
  if (!container) return

  const containerRect = container.getBoundingClientRect()
  const elementRect = segmentEl.getBoundingClientRect()

  // Check if element is outside viewport
  const isAbove = elementRect.top < containerRect.top + 100
  const isBelow = elementRect.bottom > containerRect.bottom - 100

  if (isAbove || isBelow) {
    segmentEl.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest'
    })
  }
})

// Add toggle in settings
<div class="setting-item">
  <label>
    <input type="checkbox" bind:checked={autoScrollEnabled} />
    Auto-scroll during playback
  </label>
</div>
```

**Estimated Time**: 2-3 hours  
**Testing**: Verify smooth scrolling, no jank, respects user scroll

---

## 2. Keyboard Shortcuts ⭐⭐⭐

### Implementation

**File**: `src/components/TextReader.svelte`

```typescript
onMount(() => {
  const handleKeyPress = (e: KeyboardEvent) => {
    // Ignore if typing in input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return
    }

    switch(e.key) {
      case ' ':
        e.preventDefault()
        audioService.togglePlayPause()
        break
      case 'ArrowLeft':
        e.preventDefault()
        if (e.shiftKey) {
          // Skip 10s back
          audioService.skip(-10)
        } else {
          // Previous segment
          audioService.skipPrevious()
        }
        break
      case 'ArrowRight':
        e.preventDefault()
        if (e.shiftKey) {
          // Skip 10s forward
          audioService.skip(10)
        } else {
          // Next segment
          audioService.skipNext()
        }
        break
      case 'ArrowUp':
        e.preventDefault()
        // Speed up
        const newSpeed = Math.min(audioService.playbackSpeed + 0.1, 3.0)
        audioService.setSpeed(newSpeed)
        break
      case 'ArrowDown':
        e.preventDefault()
        // Speed down
        const newSpeed = Math.min(audioService.playbackSpeed - 0.1, 0.5)
        audioService.setSpeed(newSpeed)
        break
      case 'f':
      case 'F':
        e.preventDefault()
        // Toggle fullscreen
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen()
        } else {
          document.exitFullscreen()
        }
        break
    }
  }

  window.addEventListener('keydown', handleKeyPress)

  return () => {
    window.removeEventListener('keydown', handleKeyPress)
  }
})

// Add keyboard shortcuts help
<div class="keyboard-shortcuts-help">
  <h4>Keyboard Shortcuts</h4>
  <ul>
    <li><kbd>Space</kbd> - Play/Pause</li>
    <li><kbd>←/→</kbd> - Previous/Next segment</li>
    <li><kbd>Shift + ←/→</kbd> - Skip 10s</li>
    <li><kbd>↑/↓</kbd> - Speed up/down</li>
    <li><kbd>F</kbd> - Fullscreen</li>
  </ul>
</div>
```

**Add to audioPlaybackService.svelte.ts**:

```typescript
skip(seconds: number) {
  if (!this.audio) return
  this.audio.currentTime = Math.max(0, this.audio.currentTime + seconds)
}
```

**Estimated Time**: 3-4 hours  
**Testing**: All shortcuts work, no conflicts, visual feedback

---

## 3. Progress Persistence ⭐⭐⭐

### Implementation

**File**: `src/lib/progressStore.ts` (new)

```typescript
interface ReadingProgress {
  bookId: number
  chapterId: string
  segmentIndex: number
  timestamp: number
}

const PROGRESS_KEY = 'reading_progress'

export function saveProgress(bookId: number, chapterId: string, segmentIndex: number) {
  try {
    const progress: ReadingProgress = {
      bookId,
      chapterId,
      segmentIndex,
      timestamp: Date.now(),
    }
    localStorage.setItem(`${PROGRESS_KEY}_${bookId}`, JSON.stringify(progress))
  } catch (e) {
    console.error('Failed to save progress:', e)
  }
}

export function loadProgress(bookId: number): ReadingProgress | null {
  try {
    const saved = localStorage.getItem(`${PROGRESS_KEY}_${bookId}`)
    return saved ? JSON.parse(saved) : null
  } catch (e) {
    return null
  }
}

export function clearProgress(bookId: number) {
  localStorage.removeItem(`${PROGRESS_KEY}_${bookId}`)
}
```

**File**: `src/components/TextReader.svelte`

```typescript
import { saveProgress, loadProgress } from '../lib/progressStore'

// Save progress on segment change
$effect(() => {
  if (audioService.currentSegmentIndex >= 0 && bookId && chapter) {
    saveProgress(bookId, chapter.id, audioService.currentSegmentIndex)
  }
})

// Load progress on mount
onMount(() => {
  if (bookId) {
    const progress = loadProgress(bookId)
    if (progress && progress.chapterId === chapter.id) {
      // Show resume prompt
      showResumePrompt = true
      savedSegmentIndex = progress.segmentIndex
    }
  }
})

// Resume prompt UI
{#if showResumePrompt}
  <div class="resume-prompt">
    <p>Resume from where you left off?</p>
    <button onclick={() => {
      audioService.playFromSegment(savedSegmentIndex, false)
      showResumePrompt = false
    }}>Resume</button>
    <button onclick={() => {
      showResumePrompt = false
    }}>Start from beginning</button>
  </div>
{/if}
```

**Estimated Time**: 2-3 hours  
**Testing**: Progress saves/loads correctly, handles edge cases

---

## 4. Skip Forward/Backward Controls ⭐⭐

### Implementation

**File**: `src/components/AudioPlayerBar.svelte`

```svelte
<div class="skip-controls">
  <button class="skip-btn" onclick={() => audioService.skip(-10)} aria-label="Skip back 10 seconds">
    <svg><!-- 10s back icon --></svg>
    -10s
  </button>

  <button
    class="skip-btn"
    onclick={() => audioService.skip(10)}
    aria-label="Skip forward 10 seconds"
  >
    <svg><!-- 10s forward icon --></svg>
    +10s
  </button>
</div>

<style>
  .skip-controls {
    display: flex;
    gap: 8px;
  }

  .skip-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 12px;
    background: var(--button-bg);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }

  .skip-btn:hover {
    background: var(--button-hover-bg);
  }

  .skip-btn svg {
    width: 16px;
    height: 16px;
  }
</style>
```

**File**: `src/lib/audioPlaybackService.svelte.ts`

```typescript
skip(seconds: number) {
  // For Web Speech, skip segments
  if (this.selectedModel === 'web_speech') {
    const direction = seconds > 0 ? 1 : -1
    const segmentsToSkip = Math.ceil(Math.abs(seconds) / 5) // ~5s per segment
    const newIndex = Math.max(0, Math.min(
      this.segments.length - 1,
      this.currentSegmentIndex + (direction * segmentsToSkip)
    ))
    this.playFromSegment(newIndex)
    return
  }

  // For audio files, skip time
  if (this.audio) {
    const newTime = Math.max(0, Math.min(
      this.audio.duration || 0,
      this.audio.currentTime + seconds
    ))
    this.audio.currentTime = newTime
  }
}
```

**Estimated Time**: 2 hours  
**Testing**: Skip works for all models, visual feedback, edge cases

---

## Total Estimated Time: 9-12 hours

### Implementation Order

1. **Day 1**: Skip controls (2h) + Keyboard shortcuts (4h)
2. **Day 2**: Progress persistence (3h) + Auto-scroll (3h)

### Testing Checklist

- [ ] Auto-scroll works smoothly
- [ ] Auto-scroll respects user manual scrolling
- [ ] All keyboard shortcuts work
- [ ] Shortcuts don't conflict with browser defaults
- [ ] Progress saves on every segment change
- [ ] Progress loads correctly on app start
- [ ] Resume prompt shows when applicable
- [ ] Skip controls work for all models
- [ ] Skip controls show visual feedback
- [ ] All features work on mobile
- [ ] All features work across browsers

### Documentation Needed

- Update README with keyboard shortcuts
- Add user guide for new features
- Update E2E tests
- Add feature flags for gradual rollout

---

## Quick Wins (< 1 hour each)

1. **Loading spinner during generation** (30 min)
2. **Toast notifications for errors** (45 min)
3. **Segment count in UI** (15 min)
4. **Estimated time remaining** (30 min)
5. **Keyboard shortcuts help button** (30 min)
6. **Better mobile touch targets** (45 min)
7. **Fullscreen button** (20 min)
8. **Volume control** (30 min)

---

## Next Steps

1. Create GitHub issues for each feature
2. Set up feature flags in code
3. Write E2E tests for new features
4. Create mockups for UI changes
5. Get user feedback on priorities
6. Start with skip controls (easiest, high impact)
