# Quick Start: Implementing Matrix Tests

## Step 1: Install Dependencies (if needed)

```bash
# Already have vitest and playwright
# May need mp4box.js for M4B chapter parsing
pnpm add -D mp4box
```

## Step 2: Run Existing Tests

```bash
# Run the placeholder matrix tests
pnpm test test/matrix/audiobook-matrix.test.ts

# Run audio validation utility tests
pnpm test test/utils/audio-validation.test.ts
```

## Step 3: Implement Real Generation in Matrix Tests

Replace the TODO placeholders in `test/matrix/audiobook-matrix.test.ts`:

```typescript
import { generationService } from '../../src/lib/services/generationService'
import { book, selectedChapters } from '../../src/stores/bookStore'
import { selectedModel, selectedVoice, advancedSettings } from '../../src/stores/ttsStore'

// In each test:
it('should generate valid wav audio', async () => {
  // Set up stores
  selectedModel.set(model)
  selectedVoice.set(voice)

  // Create test chapter
  const chapter = {
    id: 'test-1',
    title: 'Test Chapter',
    content: TEST_TEXT,
  }

  // Generate audio
  await generationService.generateChapters([chapter])

  // Get generated audio from store
  const audioData = get(generatedAudio).get(chapter.id)
  expect(audioData).toBeDefined()

  // Validate format
  const metadata = await parseWavHeader(audioData.blob)
  expect(metadata.sampleRate).toBe(24000) // Kokoro default
  expect(metadata.duration).toBeGreaterThan(0)
})
```

## Step 4: Add Audio Validation Tests

Create `test/utils/audio-validation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  parseWavHeader,
  parseMp3Header,
  generateText,
  audioChecksum,
  validateSmilStructure,
} from './audio-validation'

describe('Audio Validation Utilities', () => {
  describe('parseWavHeader', () => {
    it('should parse valid WAV file', async () => {
      // Create minimal valid WAV
      const wav = createTestWav(1000) // 1 second
      const metadata = await parseWavHeader(wav)

      expect(metadata.sampleRate).toBe(24000)
      expect(metadata.channels).toBe(1)
      expect(metadata.bitDepth).toBe(16)
      expect(metadata.duration).toBeCloseTo(1.0, 1)
    })

    it('should throw on invalid WAV', async () => {
      const invalid = new Blob(['not a wav'])
      await expect(parseWavHeader(invalid)).rejects.toThrow('Invalid WAV')
    })
  })

  describe('generateText', () => {
    it('should generate text with exact word count', () => {
      const text = generateText(100)
      const words = text.split(/\s+/)
      expect(words.length).toBe(100)
    })
  })
})

// Helper to create test WAV
function createTestWav(durationMs: number): Blob {
  const sampleRate = 24000
  const samples = Math.floor((sampleRate * durationMs) / 1000)
  const dataSize = samples * 2 // 16-bit
  const bufferSize = 44 + dataSize

  const buffer = new ArrayBuffer(bufferSize)
  const view = new DataView(buffer)

  // RIFF header
  view.setUint32(0, 0x52494646, false) // 'RIFF'
  view.setUint32(4, bufferSize - 8, true)
  view.setUint32(8, 0x57415645, false) // 'WAVE'

  // fmt chunk
  view.setUint32(12, 0x666d7420, false) // 'fmt '
  view.setUint32(16, 16, true) // chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample

  // data chunk
  view.setUint32(36, 0x64617461, false) // 'data'
  view.setUint32(40, dataSize, true)

  // Fill with silence
  for (let i = 0; i < samples; i++) {
    view.setInt16(44 + i * 2, 0, true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}
```

## Step 5: Add E2E Matrix Tests

Create `e2e/matrix-validation.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'

const MODELS = ['kokoro', 'piper']
const FORMATS = ['mp3', 'm4b', 'wav']

for (const model of MODELS) {
  for (const format of FORMATS) {
    test(`should generate ${format} with ${model}`, async ({ page }) => {
      await page.goto('/')

      // Upload test file
      await page.setInputFiles('input[type="file"]', 'books/test-short.epub')
      await page.waitForSelector('text=Short Test Book')

      // Select model
      await page.selectOption('select[name="model"]', model)

      // Select format
      await page.selectOption('select[name="format"]', format)

      // Generate
      await page.click('button:has-text("Generate")')

      // Wait for completion
      await page.waitForSelector('text=Done', { timeout: 60000 })

      // Verify download
      const download = await page.waitForEvent('download')
      expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`))
    })
  }
}
```

## Step 6: Run Full Test Suite

```bash
# Unit tests
pnpm test

# Matrix tests specifically
pnpm test test/matrix/

# E2E tests
pnpm test:e2e e2e/matrix-validation.spec.ts

# All tests
pnpm test && pnpm test:e2e
```

## Step 7: Add to CI

Update `.github/workflows/test.yml`:

```yaml
jobs:
  matrix-tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        model: [kokoro, piper]
        format: [wav, mp3, m4b]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm test test/matrix/ -- --model=${{ matrix.model }} --format=${{ matrix.format }}
```

## Expected Timeline

- **Day 1**: Implement audio validation utilities + tests
- **Day 2**: Implement basic matrix tests (model × format)
- **Day 3**: Add advanced settings tests
- **Day 4**: Add E2E matrix tests
- **Day 5**: Add performance benchmarks + CI integration

## Success Criteria

✅ All model × format combinations tested
✅ Audio quality validated (sample rate, duration, format)
✅ Advanced settings impact verified
✅ Error scenarios covered
✅ Tests run in CI on every commit
✅ < 5% flaky test rate
