# Test Improvement Plan: Comprehensive Audiobook Validation

## Current State Analysis

### Existing Coverage

- **Unit Tests**: 40 test files covering parsers, stores, utilities, TTS clients
- **E2E Tests**: 10 test files covering basic generation, formats, mobile, playback
- **Integration Tests**: Limited cross-model, cross-format validation

### Gaps Identified

1. **No systematic model × format matrix testing**
2. **Limited advanced settings validation**
3. **No audio quality verification** (duration, sample rate, format correctness)
4. **Incomplete error scenario coverage**
5. **No performance regression detection**

---

## Proposed Test Architecture

### 1. Matrix Testing Framework

Create a test matrix covering all combinations:

```typescript
// test/matrix/audiobook-matrix.test.ts
const TEST_MATRIX = {
  models: ['kokoro', 'piper'],
  formats: ['wav', 'mp3', 'm4b', 'epub'],
  voices: {
    kokoro: ['af_heart', 'af_bella', 'bf_emma'],
    piper: ['en_US-amy-medium', 'en_GB-alan-medium'],
  },
  settings: {
    kokoro: [
      { stitchLongSentences: true, parallelChunks: 1 },
      { stitchLongSentences: false, parallelChunks: 4 },
    ],
    piper: [
      { noiseScale: 0.667, lengthScale: 1.0 },
      { noiseScale: 0.8, lengthScale: 1.5 },
    ],
  },
  bitrates: [128, 192, 256, 320], // for mp3/m4b
}
```

**Implementation**: Parameterized tests that generate all combinations

---

### 2. Audio Quality Validation

#### Unit Tests

```typescript
// test/audio-validation.test.ts

describe('Audio Quality Validation', () => {
  it('should produce valid WAV with correct sample rate', async () => {
    const audio = await generateAudio(...)
    const metadata = await parseWavHeader(audio)
    expect(metadata.sampleRate).toBe(24000) // Kokoro
    expect(metadata.channels).toBe(1)
    expect(metadata.bitDepth).toBe(16)
  })

  it('should match expected duration within tolerance', async () => {
    const text = "This is a test sentence."
    const audio = await generateAudio(text, ...)
    const duration = await parseWavDuration(audio)
    const expectedDuration = estimateSpeechDurationSeconds(countWords(text))
    expect(duration).toBeCloseTo(expectedDuration, 1) // ±1 second
  })

  it('should produce valid MP3 with correct bitrate', async () => {
    const audio = await exportAudio(..., 'mp3', 192)
    const metadata = await parseMp3Header(audio)
    expect(metadata.bitrate).toBe(192)
  })
})
```

#### E2E Tests

```typescript
// e2e/audio-quality.spec.ts

test('generated audio should be playable in browser', async ({ page }) => {
  // Generate audio
  await generateChapter(...)

  // Verify playback
  const audioElement = await page.locator('audio')
  await audioElement.evaluate(el => el.play())
  await page.waitForTimeout(1000)
  const currentTime = await audioElement.evaluate(el => el.currentTime)
  expect(currentTime).toBeGreaterThan(0)
})
```

---

### 3. Format-Specific Validation

```typescript
// test/formats/format-validation.test.ts

describe('Format Validation', () => {
  describe('MP3', () => {
    it('should contain ID3v2 metadata', async () => {
      const audio = await exportAudio(..., 'mp3')
      const metadata = await parseId3Tags(audio)
      expect(metadata.title).toBe(expectedTitle)
      expect(metadata.artist).toBe(expectedAuthor)
    })
  })

  describe('M4B', () => {
    it('should contain chapter markers', async () => {
      const audio = await exportAudio(..., 'm4b')
      const chapters = await parseM4bChapters(audio)
      expect(chapters.length).toBe(expectedChapterCount)
      expect(chapters[0].title).toBe('Chapter 1')
    })
  })

  describe('EPUB3', () => {
    it('should contain valid Media Overlays', async () => {
      const epub = await exportEpub(...)
      const smilFiles = await extractSmilFiles(epub)
      expect(smilFiles.length).toBeGreaterThan(0)
      // Validate SMIL XML structure
      const smil = await parseSmil(smilFiles[0])
      expect(smil.body.seq).toBeDefined()
    })
  })
})
```

---

### 4. Settings Validation Tests

```typescript
// test/settings/advanced-settings.test.ts

describe('Advanced Settings Impact', () => {
  it('stitchLongSentences should affect segment count', async () => {
    const text = 'Long paragraph. ' + 'Another sentence. '.repeat(10)

    const withStitch = await generateVoiceSegments(text, { stitchLongSentences: true })
    const withoutStitch = await generateVoiceSegments(text, { stitchLongSentences: false })

    expect(withStitch.length).toBeLessThan(withoutStitch.length)
  })

  it('parallelChunks should not affect output quality', async () => {
    const text = 'Test sentence. '.repeat(20)

    const serial = await generateAudio(text, { parallelChunks: 1 })
    const parallel = await generateAudio(text, { parallelChunks: 4 })

    // Duration should be identical
    expect(await parseWavDuration(serial)).toBeCloseTo(await parseWavDuration(parallel), 0.1)
  })

  it('noiseScale should affect audio variability', async () => {
    const text = 'The same sentence repeated.'

    const low = await generateAudio(text, { noiseScale: 0.1 })
    const high = await generateAudio(text, { noiseScale: 0.9 })

    // High noise should produce different waveforms
    expect(await audioChecksum(low)).not.toBe(await audioChecksum(high))
  })
})
```

---

### 5. Error Scenario Coverage

```typescript
// test/error-handling.test.ts

describe('Error Handling', () => {
  it('should handle empty text gracefully', async () => {
    const result = await generateAudio('')
    expect(result).toBeDefined()
    expect(await parseWavDuration(result)).toBe(0)
  })

  it('should handle special characters', async () => {
    const text = 'Test with émojis 🎉 and symbols @#$%'
    const result = await generateAudio(text)
    expect(result).toBeDefined()
  })

  it('should handle very long text', async () => {
    const text = 'Word '.repeat(10000)
    const result = await generateAudio(text)
    expect(result).toBeDefined()
  })

  it('should recover from model loading failure', async () => {
    // Mock model loading failure
    const result = await generateAudio(text, { model: 'invalid' })
    expect(result).toBeInstanceOf(Error)
  })
})
```

---

### 6. Performance Regression Tests

```typescript
// test/performance/benchmarks.test.ts

describe('Performance Benchmarks', () => {
  it('should generate 1000 words in under 30 seconds', async () => {
    const text = generateText(1000) // 1000 words
    const start = performance.now()
    await generateAudio(text)
    const duration = performance.now() - start
    expect(duration).toBeLessThan(30000)
  })

  it('should not leak memory during long generation', async () => {
    const initialMemory = performance.memory?.usedJSHeapSize

    for (let i = 0; i < 10; i++) {
      await generateAudio(generateText(500))
    }

    const finalMemory = performance.memory?.usedJSHeapSize
    const growth = finalMemory - initialMemory
    expect(growth).toBeLessThan(100 * 1024 * 1024) // < 100MB growth
  })
})
```

---

### 7. Cross-Browser E2E Tests

```typescript
// playwright.config.ts - add more browsers

export default defineConfig({
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],
})
```

---

## Implementation Priority

### Phase 1: Critical (Week 1)

1. ✅ Audio quality validation helpers (`parseWavHeader`, `parseMp3Header`)
2. ✅ Matrix test framework setup
3. ✅ Basic model × format tests (kokoro/piper × wav/mp3)

### Phase 2: Important (Week 2)

4. ✅ Format-specific validation (M4B chapters, EPUB SMIL)
5. ✅ Advanced settings impact tests
6. ✅ Error scenario coverage

### Phase 3: Nice-to-Have (Week 3)

7. ✅ Performance benchmarks
8. ✅ Cross-browser E2E tests
9. ✅ Visual regression tests (UI screenshots)

---

## Test Utilities to Create

```typescript
// test/utils/audio-validation.ts

export async function parseWavHeader(blob: Blob): Promise<WavMetadata>
export async function parseMp3Header(blob: Blob): Promise<Mp3Metadata>
export async function parseM4bChapters(blob: Blob): Promise<Chapter[]>
export async function extractSmilFiles(epubBlob: Blob): Promise<string[]>
export async function audioChecksum(blob: Blob): Promise<string>
export function generateText(wordCount: number): string
```

---

## Success Metrics

- **Coverage**: 90%+ code coverage for generation pipeline
- **Matrix**: All model × format × voice combinations tested
- **Quality**: 100% of generated audio files are valid and playable
- **Performance**: No regression > 10% in generation speed
- **Reliability**: < 1% flaky test rate in CI

---

## CI/CD Integration

```yaml
# .github/workflows/test.yml

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test

  matrix-tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        model: [kokoro, piper]
        format: [wav, mp3, m4b, epub]
    steps:
      - run: pnpm test:matrix -- --model=${{ matrix.model }} --format=${{ matrix.format }}

  e2e-tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        browser: [chromium, firefox, webkit]
    steps:
      - run: pnpm test:e2e --project=${{ matrix.browser }}

  performance-tests:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test:performance
      - name: Compare with baseline
        run: node scripts/compare-benchmarks.js
```

---

## Next Steps

1. **Review this plan** with the team
2. **Create test utilities** in `test/utils/`
3. **Implement Phase 1** tests
4. **Set up CI matrix** testing
5. **Document test patterns** in `AGENTS.md`
