# Components

## Overview

| Component               | Purpose                                                | Key Props                                                     |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| `TextReader`            | Single-chapter reader with sentence highlighting       | `chapter`, `bookId`, `voice`, `chapters`, `onBack`            |
| `ContinuousReader`      | Multi-chapter continuous reading mode                  | `chapters`, `bookId`, `book`, `voice`, `onBack`               |
| `BookView`              | Chapter list, generation controls, export              | `onread`                                                      |
| `ChapterItem`           | Individual chapter row with status and controls        | `chapter`, `book`, `status`, `progress`, `onRead`, `onToggle` |
| `AudioPlayerBar`        | Persistent playback controls (play/pause, seek, speed) | (reads from `audioPlayerStore`)                               |
| `LibraryView`           | Library management (search, sort, delete)              | —                                                             |
| `LandingPage`           | Entry point with file upload and URL input             | —                                                             |
| `SettingsPage`          | App-wide TTS model/voice/device settings               | —                                                             |
| `UnifiedInput`          | File upload + URL paste input component                | —                                                             |
| `BookCard`              | Library card showing book metadata                     | —                                                             |
| `ModelLoadingIndicator` | Shows model download/loading progress                  | —                                                             |
| `Toast`                 | Individual toast notification                          | —                                                             |
| `ToastContainer`        | Toast notification stack                               | —                                                             |
| `VirtualList`           | Virtualized list for long content                      | —                                                             |
| `ReloadPrompt`          | PWA update prompt                                      | —                                                             |

## Major Components

### TextReader

The primary reading interface. Displays segmented HTML with sentence-level highlighting and click-to-play.

**Props:**

- `chapter: Chapter` — current chapter to display
- `bookId: number | null` — database ID for persistence
- `bookTitle: string` — displayed in header
- `voice: string` — TTS voice ID
- `quantization` — model precision (`q8`, `q4`, etc.)
- `device` — inference device (`auto`, `wasm`, `webgpu`)
- `selectedModel` — TTS engine (`kokoro`, `piper`, `web_speech`)
- `chapters: Chapter[]` — all chapters (for navigation)
- `onBack: () => void` — return to book view
- `onChapterChange?: (chapter) => void` — chapter navigation callback

**Internal State Machine:**

```
idle → loading (loadChapter)
loading → ready (segments parsed, progress restored)
ready → playing (user clicks segment or play button)
playing → paused (user pauses)
playing → generating (clicked ungenerated segment)
generating → playing (segment audio ready)
playing → ready (chapter ends)
ready → loading (chapter navigation)
```

**Key behaviors:**

- Segments HTML on mount via `segmentHtmlContent()`
- Restores reading progress from `progressStore`
- Loads pre-generated segments from IndexedDB via `loadChapterSegmentProgress()`
- Click on any segment triggers generation from that point via `generationService.generateSingleChapterFromSegment()`
- Auto-scrolls to keep current segment visible
- Keyboard shortcuts: Space (play/pause), arrows (navigate), F (fullscreen)
- Persists playback speed, model, and voice preferences to localStorage

### BookView

The chapter management view. Lists all chapters with generation status, controls batch generation, and handles export.

**Key responsibilities:**

- Renders `ChapterItem` for each chapter
- Manages chapter selection (select all / none)
- Triggers `generationService.generateChapters()` for selected chapters
- Handles export via `generationService.exportAudio()` / `exportEpub()`
- Shows TTS model/voice/quantization selectors
- Displays overall generation progress

### ChapterItem

Individual chapter row showing status, progress, and per-chapter controls.

**Props:**

- `chapter: Chapter` — chapter data
- `book?: Book` — parent book (for language detection)
- `selected: boolean` — selection state
- `status: 'pending' | 'processing' | 'done' | 'error'`
- `progress: { current, total, message? }` — generation progress
- `onRead`, `onToggle`, `onDownload`, `onRetry`, `onCancel`, `onResume` — action callbacks
- `onModelChange`, `onVoiceChange`, `onLanguageChange` — per-chapter override callbacks

**Key behaviors:**

- Shows word count and estimated duration
- Displays segment-level progress bar during generation
- Allows per-chapter model/voice/language overrides
- Shows download button with format selection when done

### ContinuousReader

Multi-chapter continuous reading mode. Loads chapters progressively as the user scrolls or playback advances.

**Props:**

- `chapters: Chapter[]` — all book chapters
- `bookId: number | null` — database ID
- `book: Book` — full book object (for language detection)
- `voice`, `quantization`, `device`, `selectedModel` — TTS settings
- `initialChapterId?: string` — chapter to start from
- `onBack: () => void` — return to book view

**Key behaviors:**

- Lazy-loads and segments chapters as they come into view
- Tracks active chapter via scroll position (IntersectionObserver)
- Shares playback state with `AudioPlayerBar`
- Supports theme switching (light/dark/sepia) and font size adjustment

## Event Flow

```
User clicks segment in TextReader
  → generationService.generateSingleChapterFromSegment()
  → segmentProgressStore updated (segment generating)
  → TTS worker produces audio blob
  → segmentBatchHandler persists to IndexedDB
  → segmentProgressStore updated (segment done)
  → audioPlaybackService.playSingleSegment()
  → AudioPlayerBar reflects playback state
  → TextReader highlights active segment
```

```
User clicks "Generate" in BookView
  → generationService.generateChapters(selectedChapters)
  → bookStore.chapterStatus → 'processing'
  → ChapterItem shows progress bar
  → Segments generated progressively
  → bookStore.chapterStatus → 'done'
  → ChapterItem shows download button
```
