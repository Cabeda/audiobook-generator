# 🎙️ Audiobook Generator

A modern, browser-based audiobook generator that converts EPUB books into high-quality audio files using AI-powered text-to-speech. Powered by [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) TTS model running 100% in your browser.

> ⚠️ **Important**: This tool works with **DRM-free files only**. It cannot process files with digital rights management (DRM) protections, such as those purchased from Apple Books, Google Play Books, or Amazon Kindle with DRM enabled.

[![Tests](https://github.com/Cabeda/audiobook-generator/actions/workflows/test.yml/badge.svg)](https://github.com/Cabeda/audiobook-generator/actions/workflows/test.yml)

## ✨ Features

### 🎯 Core Functionality

- 📚 **Multi-Format Support** - Upload EPUB, PDF, HTML, or TXT files
- 🔗 **URL to Audiobook** - Paste any article URL to convert it to audio
- 📖 **EPUB3 Export** - Generate EPUBs with Media Overlays (synchronized text highlighting)
- 🎤 **High-Quality TTS** - 27 voices (Kokoro-82M) + Edge TTS integration
- 🎵 **Multiple Formats** - Export as MP3, M4B, WAV, or EPUB3
- 🎚️ **Quality Control** - Choose bitrate (128-320 kbps) for compressed formats
- 🔄 **Audio Concatenation** - Automatically combine chapters into single file
- 💾 **Smart Caching** - Model loads once, instant generation after
- 🌐 **100% Browser-Based** - No server required, works offline after first load
- 📖 **Local Library** - Books automatically saved and accessible across sessions

### 🎨 User Experience

- ⚡ **Fast Generation** - ~0.5-1.0s per sentence
- 📊 **Real-Time Progress** - Track generation and encoding status
- 🎯 **Chapter Preview** - See content before generating
- 🎭 **Voice Selection** - Choose from 27 high-quality voices
- 📱 **Responsive Design** - Works on desktop and mobile
- 🚫 **Cancellation** - Stop generation at any time
- 🗂️ **Library Management** - Search, sort, and organize your saved books
- 💾 **Storage Tracking** - Monitor browser storage usage

### 🧪 Quality Assurance

- ✅ **27 Tests** - Comprehensive unit and E2E test coverage
- 🎭 **Playwright E2E** - Real browser testing with actual TTS
- 🔄 **CI/CD** - Automated testing on every commit
- 📊 **Type Safety** - Full TypeScript support
- ⚡ **Performance Benchmarks** - TTS latency and concatenation throughput tracking

## 🚀 Quick Start

### Prerequisites

- Node.js 20.x or higher
- pnpm (install globally: `npm install -g pnpm`)

### Installation

```bash
# Clone the repository
git clone https://github.com/Cabeda/audiobook-generator.git
cd audiobook-generator

# Install dependencies
pnpm install

# Start development server
pnpm run dev
```

Open http://localhost:5173 to use the app.

## 📖 Usage

### Basic Workflow

1. **Import Content**:
   - **Upload**: Drag & drop EPUB, PDF, HTML, or TXT files
   - **URL**: Paste an article URL to fetch content automatically
   - **Library**: Access previously uploaded books from "My Library" tab
2. **Select Chapters**: Choose which chapters to convert (or select all)
3. **Choose Format**: Select output format (MP3, M4B, WAV, or EPUB3)
4. **Select Quality**: Pick bitrate for MP3/M4B (128-320 kbps)
5. **Generate**: Click "Generate & Download"
6. **Download**: Your file downloads automatically

### Library Management

All uploaded books are automatically saved to your local library using IndexedDB:

- **Access Library**: Click the "📚 My Library" tab on the landing page
- **Search Books**: Use the search bar to filter by title or author
- **Sort Options**: Recently accessed, title A-Z, or author A-Z
- **Delete Books**: Hover over a book card and click the 🗑️ icon
- **Storage Info**: Check usage indicator in the top-right of library view
- **Reload Books**: Click any book card to instantly load it

**Storage:**

- Books persist across browser sessions
- Typical storage limit: 50MB-1GB (browser-dependent)
- Clear browser data to reset library

### Format Comparison

| Format    | File Size (1hr)  | Quality     | Best For                                       |
| --------- | ---------------- | ----------- | ---------------------------------------------- |
| **MP3**   | ~90 MB @ 192kbps | Very Good   | ⭐ **Recommended** - Universal compatibility   |
| **M4B**   | ~90 MB @ 192kbps | Very Good   | Audiobook apps, chapter markers                |
| **EPUB3** | ~90 MB + Text    | Interactive | **Read Aloud** - Syncs text & audio in readers |
| **WAV**   | ~600 MB          | Lossless    | Archival, further processing                   |

### Voice Selection

**Top Voices:**

- `af_heart` ⭐ - Female American (Grade A)
- `af_bella` 🔥 - Female American (Grade A-)
- `bf_emma` ⭐ - Female British (Grade A)

See [docs/KOKORO_INTEGRATION.md](docs/KOKORO_INTEGRATION.md) for all 27 voices.

## 🛠️ Development

### Available Scripts

```bash
# Development
pnpm run dev          # Start dev server
pnpm run build        # Build for production
pnpm run preview      # Preview production build

# Testing
pnpm test             # Run unit tests
pnpm run test:ui      # Run tests with UI
pnpm run test:e2e     # Run E2E tests
pnpm run test:e2e:ui  # Run E2E tests with UI
pnpm run test:e2e:headed  # Run E2E with visible browser

# Benchmarks
pnpm run bench        # Run performance benchmarks
pnpm run bench:quick  # Run benchmarks with verbose output
```

### Project Structure

```
audiobook-generator/
├── src/
│   ├── components/          # Svelte components
│   │   ├── LandingPage.svelte
│   │   ├── LibraryView.svelte
│   │   ├── BookCard.svelte
│   │   ├── BookInspector.svelte
│   │   └── GeneratePanel.svelte
│   ├── lib/
│   │   ├── libraryDB.ts     # IndexedDB storage
│   │   ├── epubParser.ts    # EPUB parsing logic
│   │   ├── audioConcat.ts   # Audio concatenation
│   │   ├── kokoro/          # TTS integration
│   │   │   └── kokoroClient.ts
│   │   └── onnx/            # ONNX runtime
│   ├── stores/              # Svelte stores
│   │   ├── libraryStore.ts  # Library state
│   │   ├── bookStore.ts     # Book state
│   │   └── ttsStore.ts      # TTS settings
│   └── App.svelte           # Main app
├── e2e/                     # E2E tests
├── docs/                    # Documentation
├── example/                 # Sample EPUB file
└── playwright.config.ts     # E2E test config
```

## 📚 Documentation

- **[Kokoro Integration](docs/KOKORO_INTEGRATION.md)** - TTS model details, API reference, voice catalog
- **[Audio Formats](docs/AUDIO_FORMATS.md)** - Format comparison, quality settings, use cases
- **[Audio Concatenation](docs/AUDIO_CONCATENATION.md)** - Concatenation API, chapter markers, usage
- **[E2E Testing](docs/E2E_TESTING.md)** - Test coverage, running tests, debugging
- **[Performance Benchmarks](docs/BENCHMARKS.md)** - Benchmark details, interpreting results, performance goals
- **[Implementation Summary](docs/IMPLEMENTATION_SUMMARY.md)** - Technical overview, architecture
- **[Troubleshooting Guide](docs/CHUNKING_AND_CONCATENATION.md)** - Chunking behavior, environment requirements, debugging tips

## 🧪 Testing

### Unit Tests (27 tests)

```bash
pnpm test
```

**Coverage:**

- ✅ EPUB parsing (8 tests)
- ✅ Kokoro TTS client (9 tests)
- ✅ Audio concatenation (10 tests)

### E2E Tests (9 tests)

```bash
pnpm run test:e2e
```

**Coverage:**

- ✅ Application loading and EPUB upload
- ✅ Single chapter generation (MP3, M4B)
- ✅ Multiple chapter generation
- ✅ Format and bitrate selection
- ✅ Progress tracking
- ✅ Cancellation support

## 🏗️ Architecture

### Technology Stack

- **Frontend**: Svelte 4 + TypeScript
- **Build Tool**: Vite 5
- **TTS Models**: Kokoro-82M (ONNX)
- **Runtime**: ONNX Runtime Web (WASM/WebGPU)
- **Audio Processing**: Web Audio API + ffmpeg.wasm
- **Document Parsing**: pdfjs-dist (PDF), readability (HTML), jszip (EPUB)
- **Storage**: IndexedDB (local library)
- **Testing**: Vitest + Playwright

### Data Flow

```
EPUB File
  ↓ JSZip extraction
  ↓ XML parsing (DOMParser)
  ↓ Chapter extraction
Chapters
  ↓ Text normalization
  ↓ Kokoro TTS (espeak-ng → IPA phonemes)
  ↓ StyleTTS2 inference (ONNX)
  ↓ 24kHz audio output
Audio Buffers
  ↓ Web Audio API concatenation
  ↓ Format encoding (WAV/MP3/M4B)
Audiobook File
```

## 🎯 Performance

### Model Loading

- **First load**: 5-10 seconds (downloads ~82MB model)
- **Subsequent loads**: Instant (cached in IndexedDB)

### Generation Speed

- **WASM**: 0.5-1.0s per sentence
- **WebGPU**: 0.2-0.5s per sentence (if available)

### Memory Usage

- **Model**: ~200-400MB RAM
- **Per chapter**: ~10-20MB

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Setup

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`pnpm test && pnpm run test:e2e`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

### Third-Party Licenses

- **Kokoro-82M**: Apache 2.0 (commercial use allowed)
- **lamejs**: LGPL
- **Svelte**: MIT
- **ONNX Runtime**: MIT

## 🙏 Acknowledgments

- [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) by hexgrad - Excellent open-source TTS model
- [kokoro-js](https://www.npmjs.com/package/kokoro-js) - JavaScript/TypeScript implementation
- [espeak-ng](https://github.com/espeak-ng/espeak-ng) - Phonemization engine
- [lamejs](https://github.com/zhuker/lamejs) - JavaScript MP3 encoder

## 🔧 Troubleshooting

### Common Issues

Having problems? Check our comprehensive troubleshooting guide:

👉 **[Troubleshooting Guide](docs/CHUNKING_AND_CONCATENATION.md)**

**Quick fixes:**

- **Out of memory**: Use q8 model instead of fp32, generate fewer chapters at once
- **Slow generation**: Enable WebGPU (Chrome 113+), close other tabs
- **Audio clicks/pops**: Ensure consistent voice settings across all chapters
- **MP3 encoding fails**: Try WAV format, check browser console for FFmpeg errors
- **Wrong chapter order**: Generate sequentially, not in parallel

For detailed solutions and debugging tips, see the [full troubleshooting guide](docs/CHUNKING_AND_CONCATENATION.md).

## 🐛 Known Issues

- MP3/M4B encoding tests skipped in CI (work in browser only)
- Large EPUBs (100+ chapters) may require chunking
- WebGPU support varies by browser

## 🗺️ Roadmap

- [x] Voice selection UI dropdown
- [x] Chapter markers in M4B files
- [x] Cover art embedding (via EPUB export)
- [x] PDF, HTML, and TXT support
- [x] URL to Audiobook conversion
- [x] Local library with persistent storage
- [ ] Export/import library backup
- [ ] Reading progress tracking
- [ ] Batch processing multiple files
- [ ] Cloud storage integration
- [ ] Mobile app (React Native)

## 📧 Contact

- **Author**: José Cabeda
- **GitHub**: [@Cabeda](https://github.com/Cabeda)
- **Issues**: [GitHub Issues](https://github.com/Cabeda/audiobook-generator/issues)

---

Made with ❤️ using Svelte, TypeScript, and Kokoro-82M
