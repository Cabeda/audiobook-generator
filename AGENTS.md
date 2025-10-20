# AI Agents Guide for Audiobook Generator

This document provides guidance for AI coding agents working on this repository to optimize their workflow and understanding of the project.

## Project Overview

**Audiobook Generator** is a web-based application that converts EPUB books into audiobooks using TTS (Text-to-Speech) technology. It features:

- Web UI built with Svelte + TypeScript + Vite
- TTS powered by Kokoro-82M ONNX model via Web Workers
- Audio processing with FFmpeg.wasm for format conversion (MP3, M4B)
- E2E testing with Playwright
- Unit testing with Vitest

## Project Structure

```
audiobook-generator/
├── src/
│   ├── components/          # Svelte UI components
│   │   ├── BookInspector.svelte    # EPUB book viewer and chapter selector
│   │   ├── GeneratePanel.svelte    # Audio generation controls
│   │   └── UploadArea.svelte       # File upload interface
│   ├── lib/
│   │   ├── epubParser.ts           # EPUB file parsing
│   │   ├── audioConcat.ts          # Audio concatenation & FFmpeg.wasm
│   │   ├── ttsWorkerManager.ts     # Web Worker management
│   │   ├── ttsRunner.ts            # TTS execution logic
│   │   ├── kokoro/                 # Kokoro TTS client and utilities
│   │   └── onnx/                   # ONNX runtime and model loading
│   ├── App.svelte                  # Main application component
│   └── main.ts                     # Application entry point
├── e2e/                     # Playwright E2E tests
├── docs/                    # Documentation
└── .github/workflows/       # CI/CD workflows
```

## Key Technologies

### Frontend Stack

- **Svelte 4**: Component framework
- **TypeScript**: Type safety
- **Vite**: Build tool and dev server

### Audio Processing

- **Kokoro-82M**: High-quality TTS model (ONNX format)
- **ONNX Runtime Web**: Browser-based ML inference
- **FFmpeg.wasm**: Audio format conversion (WAV → MP3/M4B)
- **Web Workers**: Non-blocking TTS generation

### Testing & Quality

- **Vitest**: Unit testing
- **Playwright**: E2E testing
- **ESLint**: Code linting
- **Prettier**: Code formatting
- **Husky**: Git hooks
- **TypeScript**: Static type checking

## Development Workflow

### Available Commands

```bash
# Development
npm run dev              # Start dev server (Vite)
npm run build            # Build for production
npm run preview          # Preview production build

# Testing
npm test                 # Run unit tests (Vitest)
npm run test:ui          # Run tests with UI
npm run test:e2e         # Run E2E tests (Playwright)
npm run test:e2e:ui      # Run E2E tests with UI

# Code Quality
npm run lint             # Run ESLint + Prettier check
npm run lint:fix         # Fix ESLint + Prettier issues
npm run format           # Format code with Prettier
npm run type-check       # TypeScript type checking
```

### Pre-commit Hooks

The repository uses **Husky** and **lint-staged** to automatically:

- Run ESLint with auto-fix on staged `.ts`, `.tsx`, `.svelte` files
- Format staged files with Prettier
- Ensure code quality before commits

## Code Style Guidelines

### TypeScript/JavaScript

- Use ES2022+ features
- Prefer `const` over `let`, avoid `var`
- Use async/await over promises
- Prefix unused variables with underscore: `_variable`
- Use descriptive variable names

### Svelte Components

- Keep components focused and single-purpose
- Use TypeScript in `<script lang="ts">` blocks
- Export props with explicit types
- Use reactive statements (`$:`) for derived state
- Emit custom events for parent communication

### File Naming

- Components: PascalCase (e.g., `BookInspector.svelte`)
- Utilities: camelCase (e.g., `epubParser.ts`)
- Tests: `*.test.ts` or `*.spec.ts`
- Types: Define in same file or `*.d.ts`

## Common Patterns

### Web Worker Usage

```typescript
// Get singleton worker instance
const worker = getTTSWorker()

// Generate audio with progress tracking
const blob = await worker.generateVoice({
  text: content,
  voice: 'af_heart',
  onProgress: (msg) => console.log(msg),
  onChunkProgress: (current, total) => {
    // Update UI
  },
})
```

### FFmpeg.wasm Audio Conversion

```typescript
// Convert WAV to MP3
const mp3Blob = await convertWavToMp3(wavBlob, 192)

// Concatenate chapters with metadata
const audiobook = await concatenateAudioChapters(
  chapters,
  { format: 'm4b', bitrate: 192, bookTitle, bookAuthor },
  (progress) => console.log(progress.message)
)
```

### EPUB Parsing

```typescript
// Parse EPUB file
const book = await parseEpubFile(file)
// Returns: { title, author, cover, chapters[] }
```

## Testing Guidelines

### Unit Tests (Vitest)

- Test files: `*.test.ts` alongside source files
- Mock external dependencies (ONNX, FFmpeg)
- Test edge cases and error handling
- Use descriptive test names

### E2E Tests (Playwright)

- Test files: `e2e/*.spec.ts`
- Test user workflows end-to-end
- Use page object pattern for reusability
- Test across different browsers (Chromium, Firefox, WebKit)

## Common Tasks for Agents

### Adding a New Feature

1. Create/modify components in `src/components/`
2. Add business logic in `src/lib/`
3. Update types in relevant files
4. Add unit tests (`*.test.ts`)
5. Add E2E tests if user-facing (`e2e/*.spec.ts`)
6. Run `npm run lint:fix` and `npm run type-check`
7. Update documentation if needed

### Fixing Bugs

1. Reproduce the issue
2. Add a failing test if possible
3. Fix the issue
4. Verify tests pass
5. Run full quality checks: `npm run lint && npm run type-check && npm test`

### Refactoring

1. Ensure tests exist and pass
2. Make incremental changes
3. Run tests after each change
4. Use `npm run lint:fix` to maintain code style
5. Update documentation if APIs change

## Important Constraints

### Browser Compatibility

- Target modern browsers (ES2022+)
- Use Web Workers for heavy computation
- Handle ONNX runtime initialization asynchronously
- FFmpeg.wasm requires SharedArrayBuffer support

### Performance Considerations

- TTS generation is CPU-intensive (use Web Workers)
- Large EPUB files need streaming/chunking
- Audio concatenation can be memory-intensive
- Use progress callbacks for long operations

### Type Safety

- All new code must be TypeScript
- Avoid `any` type (use `unknown` if needed)
- Define interfaces for complex objects
- Use strict TypeScript settings

## CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/test.yml`):

1. **Lint**: Run ESLint + Prettier checks
2. **Type Check**: Run TypeScript compiler
3. **Test**: Run Vitest unit tests
4. **E2E**: Run Playwright tests (optional, commented out for speed)

All checks must pass before merging to `main`.

## Debugging Tips

### Dev Server Issues

- Check port conflicts (default: 5173)
- Clear Vite cache: `rm -rf node_modules/.vite`
- Restart dev server

### TTS/ONNX Issues

- Check browser console for Web Worker errors
- Verify ONNX model loading in Network tab
- Ensure sufficient memory for model inference

### Audio Processing Issues

- Check FFmpeg.wasm initialization
- Verify audio format compatibility
- Monitor memory usage for large files

### Test Failures

- Run tests in isolation: `npm test -- <test-file>`
- Use `test.only()` to focus on specific tests
- Check Playwright traces in `test-results/`

## Documentation

Key documentation files:

- `README.md`: Project overview and setup
- `LINTING_SETUP.md`: Linting and formatting guide
- `docs/KOKORO_INTEGRATION.md`: TTS integration details
- `docs/AUDIO_FORMATS.md`: Audio format handling
- `docs/E2E_TESTING.md`: E2E testing guide

## Quick Reference

### File Extensions

- `.ts` - TypeScript
- `.svelte` - Svelte component
- `.test.ts` - Unit test
- `.spec.ts` - E2E test
- `.d.ts` - Type definitions

### Import Paths

- Use relative imports: `./lib/epubParser`
- Include `.ts` extension in imports (for TypeScript)
- Vite handles resolution at build time

### Git Workflow

1. Create feature branch from `webui`
2. Make changes with descriptive commits
3. Pre-commit hooks run automatically
4. Push and create PR
5. CI checks run automatically
6. Merge after approval and passing checks

## Getting Help

When stuck:

1. Check existing tests for usage examples
2. Review documentation in `docs/`
3. Look at similar implementations in codebase
4. Check browser console and network tab
5. Run `npm run type-check` for type errors

## Agent Best Practices

✅ **DO:**

- Read existing code before making changes
- Follow established patterns in the codebase
- Write tests for new features
- Update documentation when changing APIs
- Use descriptive commit messages
- Run quality checks before committing
- Ask for clarification when requirements are unclear

❌ **DON'T:**

- Skip running tests
- Ignore TypeScript errors
- Use `any` type unnecessarily
- Make large, unrelated changes in one commit
- Bypass pre-commit hooks
- Modify generated files (in `dist/`, `node_modules/`)
- Change dependencies without good reason

## Performance Optimization Tips

1. **TTS Generation**: Use Web Workers to prevent UI blocking
2. **Audio Processing**: Process chapters in batches
3. **EPUB Parsing**: Stream large files instead of loading all at once
4. **Memory**: Clean up AudioBuffers and Blobs after use
5. **Caching**: Cache ONNX models and parsed EPUBs when possible

---

**Last Updated**: October 20, 2025
**Maintained By**: Project contributors
**For Questions**: Check documentation or open an issue
