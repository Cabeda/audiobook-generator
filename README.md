# Audiobook Generator

A browser-based audiobook generator that converts EPUB, PDF, HTML, and TXT files into audio using AI-powered text-to-speech — running 100% in your browser, no server required. It also exports **read-along EPUB3** books: the original text and its narration in one file, highlighted sentence by sentence as it plays.

> **Note**: Works with DRM-free files only. Files purchased from Apple Books, Google Play Books, or Amazon Kindle with DRM enabled are not supported.

[![Tests](https://github.com/Cabeda/audiobook-generator/actions/workflows/test.yml/badge.svg)](https://github.com/Cabeda/audiobook-generator/actions/workflows/test.yml)

## Features

### TTS Models

- **Kokoro-82M** — 27 high-quality English voices, runs via ONNX (WASM or WebGPU)
- **Piper TTS** — multilingual support, auto-selects voice based on detected language
- **Pocket TTS** — 18M parameter model, small enough to run on a phone
- **KittenTTS** — 15M parameter ONNX model, the smallest download here (25 MB), 8 English voices
- **Web Speech API** — browser built-in, no model download required

### Reading & Playback

- **Text Reader** — read and listen simultaneously with sentence-level highlighting
- **Progressive playback** — audio starts playing as segments are generated, no waiting for the full chapter
- **Click-to-play** — click any sentence to start generation and playback from that point
- **Resume progress** — saves your position per book across sessions
- **Keyboard shortcuts** — Space, arrow keys, F for fullscreen, ? for help
- **Themes** — light, dark, and sepia reader themes
- **Playback speed** — 0.75×–2.0×

### Export

- **EPUB3 (read-along)** — the book and its narration in one file, kept in sync sentence by sentence. The headline format — see [Read-along EPUB3](#read-along-epub3-media-overlays) below
- **M4B** — audiobook format with chapter markers
- **MP3** — universal compatibility, recommended for plain audio
- **WAV** — lossless, for archival or further processing

### Library

- Books saved automatically to IndexedDB, persist across sessions
- Search, sort, and manage your library
- Storage usage indicator

### Input

- Upload EPUB, PDF, HTML, or TXT files
- Paste a URL to fetch and convert any article

## Read-along EPUB3 (Media Overlays)

An audiobook throws the page away. The EPUB3 export keeps it: the book ships with its own narration
and a [SMIL](https://www.w3.org/TR/epub/#sec-media-overlays) overlay that maps **every generated
sentence** to a time range in the chapter audio, per the EPUB 3.3 Media Overlays spec.

Open the file in a reader that supports Media Overlays and the book reads itself:

- **Sentence-level sync, not chapter-level** — the line being spoken is highlighted as it plays, so the page tracks the voice instead of jumping chapter to chapter.
- **One file** — text, images, cover and audio travel together. Nothing to pair up, host or sideload separately.
- **The reader's own controls still apply** — navigation, bookmarks, font size and themes keep working; narration is just another property of the page.
- **Graceful fallback** — readers without Media Overlay support still open it as a normal EPUB.

Works well in [Thorium Reader](https://www.edrlab.org/software/thorium-reader/) on desktop and in
Readium-based apps; most EPUB3-compliant reading systems will at least open the file.

Why it is still rare: most tools export audio and lose the text, or offer "read aloud" that only
follows the chapter. Sentence granularity is what makes the highlight track the voice instead of
approximating it.

Under the hood: each chapter becomes one MP3 plus a SMIL document whose `<par>` entries point at
`chapter.xhtml#seg-N` IDs with `clipBegin`/`clipEnd` offsets. Clip times are rescaled to the encoded
MP3 duration so highlights do not drift from the audio.

## Quick Start

**Prerequisites**: Node.js 20+, pnpm

```bash
git clone https://github.com/Cabeda/audiobook-generator.git
cd audiobook-generator
pnpm install
pnpm dev
```

Open http://localhost:5173.

## Usage

1. **Import** — upload a file or paste a URL
2. **Select chapters** — choose which to convert
3. **Pick a model and voice** — Kokoro, Piper, Pocket, KittenTTS, or Web Speech
4. **Generate** — click a chapter to start; audio plays as it generates
5. **Export** — M4B, MP3, MP4 or WAV for listening, or EPUB3 to keep the text and the narration together as a read-along book

## Development

```bash
pnpm dev           # dev server
pnpm build         # production build
pnpm preview       # preview build

pnpm test          # unit tests (vitest)
pnpm test:e2e      # E2E tests (Playwright)
pnpm lint          # ESLint + Prettier
pnpm type-check    # TypeScript check
```

## Project Structure

```
src/
├── components/
│   ├── TextReader.svelte        # Reader with sentence highlighting & playback
│   ├── AudioPlayerBar.svelte    # Persistent playback controls
│   ├── BookView.svelte          # Chapter list and generation controls
│   ├── LibraryView.svelte       # Library management
│   ├── LandingPage.svelte       # Entry point
│   ├── SettingsPage.svelte      # App-wide TTS settings
│   └── UnifiedInput.svelte      # File/URL input
├── lib/
│   ├── audioPlaybackService.svelte.ts  # Playback engine (Svelte 5 runes)
│   ├── audioConcat.ts                  # WAV/MP3/M4B concatenation
│   ├── services/
│   │   └── generationService.ts        # TTS orchestration, segment batching
│   ├── kokoro/                         # Kokoro TTS client
│   ├── kitten/                         # KittenTTS client
│   ├── piper/                          # Piper TTS client
│   ├── pocket/                         # Pocket TTS client
│   ├── parsers/                        # EPUB, PDF, HTML, TXT parsers
│   ├── epub/                           # EPUB3 + Media Overlay export
│   └── utils/                          # Voice selection, language detection
├── stores/
│   ├── segmentProgressStore.ts  # Per-segment generation state
│   ├── audioPlayerStore.ts      # Playback state
│   ├── bookStore.ts             # Book and chapter state
│   └── ttsStore.ts              # TTS settings
e2e/                             # Playwright E2E tests
```

## Architecture

**Stack**: Svelte 5 (runes) + TypeScript, Vite, ONNX Runtime Web, Web Audio API, IndexedDB

**Generation flow**:

```
Content (EPUB/PDF/HTML/TXT)
  → parse into chapters
  → segment HTML into sentences (DOM-based, preserves inline markup)
  → generate audio per segment (Kokoro / Piper / Web Speech)
  → stream segments to playback as they complete
  → batch-save to IndexedDB
  → concatenate into final audio file on export
```

**Playback modes**:

- _Merged audio_ — single file with time-based segment tracking (smooth seeking)
- _Progressive_ — per-segment blobs chained as generation completes
- _On-demand_ — generate segment on click, buffer ahead

## Performance

| Mode          | Generation speed         |
| ------------- | ------------------------ |
| Kokoro WASM   | ~0.5–1.0s per sentence   |
| Kokoro WebGPU | ~0.2–0.5s per sentence   |
| Piper         | ~0.3–0.8s per sentence   |
| Web Speech    | instant (browser native) |

Model first load: ~5–10s (downloads ~82MB, cached in IndexedDB after).

## Troubleshooting

- **Out of memory** — use `q8` quantization instead of `fp32`, generate fewer chapters at once
- **Slow generation** — enable WebGPU in Chrome 113+, close other tabs
- **Wrong language voice** — Piper auto-selects by detected language; override in Settings
- **MP3 encoding fails** — try WAV format; check browser console for FFmpeg errors

## Roadmap

- [x] Sentence-level highlighting in Text Reader
- [x] Progressive playback (listen while generating)
- [x] Piper TTS multilingual support
- [x] EPUB3 Media Overlay export
- [x] Local library with persistent storage
- [x] Resume reading progress
- [ ] Adaptive quality (mobile vs desktop)
- [ ] Export/import library backup
- [ ] Batch processing multiple files

## License

MIT — see [LICENSE](LICENSE).

**Third-party licenses**: Kokoro-82M (Apache 2.0), Piper (MIT), KittenTTS 0.8 (Apache 2.0), lamejs (LGPL), Svelte (MIT), ONNX Runtime (MIT).

## Acknowledgments

- [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) by hexgrad
- [kokoro-js](https://www.npmjs.com/package/kokoro-js)
- [Piper TTS](https://github.com/rhasspy/piper)
- [KittenTTS](https://github.com/KittenML/KittenTTS) by KittenML
- [espeak-ng](https://github.com/espeak-ng/espeak-ng)
- [lamejs](https://github.com/zhuker/lamejs)

---

**Author**: José Cabeda · [GitHub Issues](https://github.com/Cabeda/audiobook-generator/issues)
