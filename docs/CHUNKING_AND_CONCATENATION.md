# Troubleshooting Guide: Chunking, Concatenation & Environment Requirements

## Overview

This guide explains how TTS chunking, audio concatenation, and runtime environment requirements affect audiobook generation. Understanding these concepts will help you troubleshoot issues and optimize generation quality.

## Table of Contents

- [TTS Chunking Behavior](#tts-chunking-behavior)
- [Audio Concatenation Pipeline](#audio-concatenation-pipeline)
- [Environment Requirements](#environment-requirements)
- [Debugging Tips](#debugging-tips)
- [Common Issues & Solutions](#common-issues--solutions)
- [Running Tests Locally](#running-tests-locally)

---

## TTS Chunking Behavior

### What is TTS Chunking?

TTS chunking is the process of splitting long text into smaller segments for processing by the text-to-speech engine. This is necessary because:

1. **Memory constraints**: Processing very long texts at once can exhaust browser memory
2. **Model limitations**: TTS models have maximum input token lengths
3. **Better progress tracking**: Smaller chunks allow for more granular progress updates
4. **Error isolation**: If generation fails, only one chunk needs to be retried

### How Kokoro Handles Chunking

The Kokoro TTS engine (`src/lib/kokoro/kokoroClient.ts`) implements intelligent chunking:

```typescript
/**
 * Default chunk size: 500 characters
 * Chunking strategy: Sentence-boundary aware
 * Fallback: Word boundaries, then character splitting
 */
```

#### Chunking Strategy

1. **Sentence boundaries** (preferred):
   - Splits at periods (`.`), question marks (`?`), exclamation points (`!`)
   - Preserves natural pauses and intonation
   - Example: `"Hello world. How are you?"` → `["Hello world.", "How are you?"]`

2. **Word boundaries** (fallback):
   - Used when no sentence-ending punctuation is found
   - Splits at commas, semicolons, newlines
   - Prevents words from being cut mid-character

3. **Character splitting** (last resort):
   - Only used when a single sentence exceeds maximum chunk size
   - May result in slightly unnatural pauses

### Recommended Chunk Sizes by Engine

| Engine             | Default Size | Min Size  | Max Size   | Notes                              |
| ------------------ | ------------ | --------- | ---------- | ---------------------------------- |
| **Kokoro-82M**     | 500 chars    | 100 chars | 1000 chars | Sentence-aware splitting           |
| **Edge TTS**       | 1000 chars   | 200 chars | 3000 chars | Cloud-based, handles longer inputs |
| **Web Speech API** | 200 chars    | 50 chars  | 500 chars  | Browser-native, more restrictive   |

### Adjusting Chunk Size

To modify chunk size in `kokoroClient.ts`:

```typescript
// In src/lib/kokoro/kokoroClient.ts
function chunkText(text: string, maxChunkSize: number = 500): string[] {
  // Change default value from 500 to your desired size
  // Recommended range: 300-1000 characters
}
```

**Trade-offs:**

- **Smaller chunks** (200-300 chars): Better memory usage, more overhead, may cause stuttering
- **Larger chunks** (800-1000 chars): Fewer API calls, higher memory usage, less granular progress
- **Optimal** (500 chars): Balances memory, performance, and natural pauses

---

## Audio Concatenation Pipeline

### Why Raw Concatenation Fails

You **cannot** simply concatenate audio files byte-by-byte because:

1. **File headers**: Each WAV/MP3 file has its own header that conflicts when merged
2. **Sample rate mismatches**: Different sample rates create timing issues
3. **Channel count differences**: Mono + Stereo = garbled audio
4. **Format differences**: WAV + WebM = incompatible binary data

### Correct Concatenation Pipeline

The audiobook generator uses a multi-step process (`src/lib/audioConcat.ts`):

#### Step 1: Decode to AudioBuffer

```typescript
// Each audio blob is decoded to raw PCM samples
for (const chapter of chapters) {
  const arrayBuffer = await chapter.blob.arrayBuffer()
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
  audioBuffers.push(audioBuffer)
}
```

**What happens:**

- Removes file format headers (WAV, MP3, WebM, etc.)
- Extracts raw PCM audio samples (Float32Array)
- Normalizes sample rate and channel count

#### Step 2: Normalize Audio Properties

```typescript
// Ensure all buffers have same properties
const normalized = resampleAndNormalizeAudioBuffers(audioContext, audioBuffers)
```

**Normalization includes:**

- **Sample rate**: All buffers resampled to 44.1kHz (or target rate)
- **Channel count**: Converted to stereo (2 channels)
- **Bit depth**: Standardized to Float32 for processing

#### Step 3: Concatenate Samples

```typescript
// Calculate total length
const totalLength = normalized.reduce((sum, buf) => sum + buf.length, 0)

// Create output buffer
const outputBuffer = audioContext.createBuffer(2, totalLength, sampleRate)

// Copy all samples sequentially
let offset = 0
for (const buffer of normalized) {
  for (let channel = 0; channel < 2; channel++) {
    const channelData = buffer.getChannelData(channel)
    outputBuffer.copyToChannel(channelData, channel, offset)
  }
  offset += buffer.length
}
```

#### Step 4: Encode to Target Format

The final buffer is encoded to your chosen format:

**WAV Encoding:**

```typescript
// Lossless PCM encoding
const wavBlob = audioBufferToWav(outputBuffer, sampleRate)
// Result: ~10MB per minute, no quality loss
```

**MP3 Encoding (via FFmpeg):**

```typescript
// Write buffer to FFmpeg virtual filesystem
await ffmpeg.writeFile('input.wav', wavData)

// Encode with specified bitrate
await ffmpeg.exec(['-i', 'input.wav', '-b:a', '192k', 'output.mp3'])

// Read result
const mp3Data = await ffmpeg.readFile('output.mp3')
// Result: ~1.5MB per minute at 192kbps
```

**M4B Encoding (Audiobook format):**

```typescript
// Similar to MP3 but with audiobook metadata
await ffmpeg.exec([
  '-i',
  'input.wav',
  '-f',
  'mp4', // MP4 container
  '-b:a',
  '192k', // Bitrate
  '-metadata',
  `title=${bookTitle}`,
  '-metadata',
  `artist=${bookAuthor}`,
  'output.m4b',
])
```

### Why This Pipeline Works

1. **Format agnostic**: Decoding handles WAV, MP3, WebM, OGG, etc.
2. **Sample rate consistency**: Resampling prevents timing issues
3. **Channel alignment**: Ensures stereo compatibility
4. **Clean headers**: Final encoding creates valid file headers
5. **Quality preservation**: No double-compression artifacts

---

## Environment Requirements

### Required Browser APIs

The audiobook generator requires these browser features:

#### 1. AudioContext / OfflineAudioContext

**Purpose:** Audio decoding, resampling, and processing

**Availability:**

- ✅ Chrome 35+
- ✅ Firefox 25+
- ✅ Safari 14.1+
- ✅ Edge 79+

**Fallback:** `webkitOfflineAudioContext` for older Safari versions

**Check availability:**

```typescript
const hasAudioContext =
  typeof AudioContext !== 'undefined' || typeof OfflineAudioContext !== 'undefined'
```

**What it does:**

- Decodes audio from any browser-supported format
- Resamples audio to target sample rate
- Provides precise audio sample manipulation

#### 2. MediaRecorder (for real-time encoding)

**Purpose:** Recording generated audio in real-time

**Availability:**

- ✅ Chrome 49+
- ✅ Firefox 25+
- ⚠️ Safari 14.1+ (limited codec support)
- ✅ Edge 79+

**Check availability:**

```typescript
const hasMediaRecorder =
  typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm')
```

#### 3. Web Speech API (optional fallback)

**Purpose:** Browser-native TTS (fallback when Kokoro unavailable)

**Availability:**

- ✅ Chrome 33+
- ⚠️ Firefox (behind flag)
- ✅ Safari 7+
- ✅ Edge 14+

**Check availability:**

```typescript
const hasSpeechSynthesis = 'speechSynthesis' in window
```

#### 4. WASM / WebGPU (for Kokoro)

**WASM (required):**

- ✅ All modern browsers (2017+)
- Used for Kokoro TTS model inference

**WebGPU (optional, performance boost):**

- ✅ Chrome 113+
- ✅ Edge 113+
- ⚠️ Firefox (behind flag)
- ❌ Safari (not yet)

**Check availability:**

```typescript
// WASM
const hasWASM = typeof WebAssembly !== 'undefined'

// WebGPU (async check)
async function checkWebGPU() {
  if (!navigator.gpu) return false
  const adapter = await navigator.gpu.requestAdapter()
  return !!adapter
}
```

### Memory Requirements

| Operation                | Minimum RAM | Recommended |
| ------------------------ | ----------- | ----------- |
| Load Kokoro Model        | 200 MB      | 400 MB      |
| Generate single chapter  | 50 MB       | 100 MB      |
| Concatenate 10 chapters  | 100 MB      | 200 MB      |
| Encode to MP3/M4B        | 150 MB      | 300 MB      |
| **Total for large book** | **500 MB**  | **1 GB**    |

### Storage Requirements (IndexedDB)

- **Model cache**: ~82 MB (Kokoro q8 model)
- **Library books**: ~5-50 MB per book (depends on size)
- **Typical limit**: 50 MB - 1 GB (browser-dependent)

### Checking Environment Compatibility

Run this diagnostic in browser console:

```javascript
console.log('AudioContext:', typeof AudioContext !== 'undefined')
console.log('OfflineAudioContext:', typeof OfflineAudioContext !== 'undefined')
console.log('MediaRecorder:', typeof MediaRecorder !== 'undefined')
console.log('WebAssembly:', typeof WebAssembly !== 'undefined')
console.log('IndexedDB:', typeof indexedDB !== 'undefined')
console.log('WebGPU:', 'gpu' in navigator)

// Check available memory (Chrome only)
if (performance.memory) {
  const { usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit } = performance.memory
  console.log('Memory used:', (usedJSHeapSize / 1048576).toFixed(2), 'MB')
  console.log('Memory limit:', (jsHeapSizeLimit / 1048576).toFixed(2), 'MB')
}
```

---

## Debugging Tips

### 1. Enable Verbose Logging

The app uses a centralized logger (`src/lib/utils/logger.ts`):

```typescript
import logger from './lib/utils/logger'

// In browser console:
localStorage.setItem('LOG_LEVEL', 'debug')

// Reload the page to see detailed logs
```

**Log levels:**

- `debug`: All logs (verbose)
- `info`: General information (default)
- `warn`: Warnings only
- `error`: Errors only

### 2. Capture Chunk Sizes

Monitor chunk processing in real-time:

```typescript
// Add to src/lib/kokoro/kokoroClient.ts
function chunkText(text: string, maxChunkSize: number = 500): string[] {
  const chunks =
    /* ... chunking logic ... */

    // Log chunk statistics
    console.log('[Chunking]', {
      totalChunks: chunks.length,
      avgSize: chunks.reduce((sum, c) => sum + c.length, 0) / chunks.length,
      maxSize: Math.max(...chunks.map((c) => c.length)),
      minSize: Math.min(...chunks.map((c) => c.length)),
    })

  return chunks
}
```

### 3. Save Intermediate Blobs

Download intermediate audio for debugging:

```typescript
// After generating each chapter
function downloadDebugAudio(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Usage:
const chapterBlob = await generateVoice({ text: chapterText })
downloadDebugAudio(chapterBlob, `chapter-${index}-raw.wav`)
```

### 4. Monitor Memory Usage

Track memory consumption:

```typescript
// Chrome only
function logMemory() {
  if (!performance.memory) {
    console.log('Memory API not available')
    return
  }

  const mb = (bytes: number) => (bytes / 1048576).toFixed(2)
  console.log('[Memory]', {
    used: mb(performance.memory.usedJSHeapSize) + ' MB',
    total: mb(performance.memory.totalJSHeapSize) + ' MB',
    limit: mb(performance.memory.jsHeapSizeLimit) + ' MB',
  })
}

// Call periodically
setInterval(logMemory, 5000)
```

### 5. Inspect FFmpeg Operations

Enable FFmpeg logging:

```typescript
// In src/lib/audioConcat.ts
ffmpeg.on('log', ({ message }) => {
  console.log('[FFmpeg]', message)
})

ffmpeg.on('progress', ({ progress, time }) => {
  console.log('[FFmpeg Progress]', {
    progress: (progress * 100).toFixed(2) + '%',
    time: time.toFixed(2) + 's',
  })
})
```

### 6. Validate Audio Buffer Properties

Check audio properties before concatenation:

```typescript
function inspectAudioBuffer(buffer: AudioBuffer, label: string) {
  console.log(`[Audio Buffer: ${label}]`, {
    sampleRate: buffer.sampleRate,
    length: buffer.length,
    duration: buffer.duration.toFixed(2) + 's',
    channels: buffer.numberOfChannels,
    samples: buffer.length * buffer.numberOfChannels,
  })
}
```

---

## Common Issues & Solutions

### Issue 1: "Out of Memory" During Generation

**Symptoms:**

- Browser tab crashes
- "Aw, snap!" error (Chrome)
- Page becomes unresponsive

**Causes:**

- Loading too many chapters at once
- Using fp32 model (328 MB vs 82 MB for q8)
- Insufficient browser memory limit

**Solutions:**

1. **Use smaller model:**

   ```typescript
   // In src/lib/kokoro/kokoroClient.ts
   // Change from:
   const model = await getKokoroInstance('model', 'fp32')
   // To:
   const model = await getKokoroInstance('model', 'q8') // Recommended
   ```

2. **Generate fewer chapters at once:**
   - Select 3-5 chapters instead of entire book
   - Generate in batches, download, then continue

3. **Clear browser cache:**

   ```javascript
   // In browser console
   indexedDB.deleteDatabase('kokoro-models')
   localStorage.clear()
   ```

4. **Increase browser memory (Chrome):**
   ```bash
   # Start Chrome with more memory
   chrome --js-flags="--max-old-space-size=4096"
   ```

### Issue 2: Audio Concatenation Produces Clicks/Pops

**Symptoms:**

- Audible clicks between chapters
- Popping sounds at chapter boundaries
- Brief silence gaps

**Causes:**

- Sample rate mismatch between chapters
- DC offset in audio samples
- Missing crossfading

**Solutions:**

1. **Ensure consistent generation:**

   ```typescript
   // Use same voice and settings for all chapters
   const settings = { voice: 'af_heart', speed: 1.0 }
   for (const chapter of chapters) {
     await generateVoice({ ...settings, text: chapter.content })
   }
   ```

2. **Apply crossfade (future enhancement):**

   ```typescript
   // Add to audioConcat.ts (not yet implemented)
   function crossfadeBuffers(buf1: AudioBuffer, buf2: AudioBuffer, fadeMs: number = 50) {
     // Fade out end of buf1, fade in start of buf2
   }
   ```

3. **Normalize DC offset:**
   ```typescript
   // Remove DC bias from audio
   function removeDCOffset(samples: Float32Array): Float32Array {
     const mean = samples.reduce((sum, val) => sum + val, 0) / samples.length
     return samples.map((val) => val - mean)
   }
   ```

### Issue 3: MP3 Encoding Fails

**Symptoms:**

- "Failed to load FFmpeg" error
- MP3 download never starts
- Encoding progress stuck at 0%

**Causes:**

- FFmpeg WASM failed to load
- CORS/CDN issues
- Insufficient memory for encoding

**Solutions:**

1. **Check FFmpeg loading:**

   ```typescript
   // In browser console
   const ffmpeg = new FFmpeg()
   await ffmpeg.load()
   console.log('FFmpeg loaded successfully')
   ```

2. **Retry with different CDN:**

   ```typescript
   // In src/lib/audioConcat.ts
   const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm'
   // Try alternative:
   const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm'
   ```

3. **Use WAV format instead:**
   - WAV doesn't require FFmpeg
   - Larger file size but guaranteed to work

4. **Check browser console for errors:**
   - Look for CORS errors
   - Check network tab for failed CDN requests

### Issue 4: Generation is Too Slow

**Symptoms:**

- 5+ seconds per sentence
- Total generation time over 30 minutes
- Browser becomes sluggish

**Causes:**

- Using WASM instead of WebGPU
- fp32 model instead of quantized
- CPU throttling (battery saver mode)

**Solutions:**

1. **Enable WebGPU (Chrome 113+):**

   ```typescript
   // In src/lib/kokoro/kokoroClient.ts
   const model = await getKokoroInstance('model', 'q8', 'webgpu')
   // 2-3x faster than WASM
   ```

2. **Use quantized model:**

   ```typescript
   // q8: 82MB, ~0.5-1.0s per sentence (recommended)
   // q4: 41MB, ~0.3-0.7s per sentence (lower quality)
   // fp32: 328MB, ~1.5-3.0s per sentence (slowest)
   ```

3. **Check CPU usage:**
   - Close other tabs
   - Disable browser extensions
   - Plug in laptop (avoid battery saver)

4. **Verify model caching:**
   ```javascript
   // In browser console
   indexedDB.databases().then((dbs) => console.log('Cached databases:', dbs))
   // Should show 'kokoro-models' database
   ```

### Issue 5: Chapter Order is Incorrect

**Symptoms:**

- Chapters concatenated in wrong order
- Chapter 2 plays before Chapter 1
- Random chapter sequence

**Causes:**

- Async generation completing out of order
- Missing sort by chapter index
- EPUB spine order not respected

**Solutions:**

1. **Ensure sequential processing:**

   ```typescript
   // Generate chapters in order
   for (const chapter of chapters) {
     const audio = await generateVoice({ text: chapter.content })
     chapter.audioBlob = audio
   }
   // Avoid: Promise.all(chapters.map(generateAsync))
   ```

2. **Sort before concatenation:**

   ```typescript
   // In src/lib/audioConcat.ts
   const sortedChapters = [...chapters].sort((a, b) => a.index - b.index)
   const audiobook = await concatenateAudioChapters(sortedChapters)
   ```

3. **Verify EPUB spine order:**
   ```typescript
   // Check chapter order in browser console
   console.log(
     'Chapters:',
     book.chapters.map((ch) => ({
       index: ch.index,
       title: ch.title,
     }))
   )
   ```

### Issue 6: "AudioContext not allowed" Error

**Symptoms:**

- "The AudioContext was not allowed to start"
- No audio playback
- Silent generation

**Causes:**

- Browser autoplay policy
- AudioContext requires user gesture
- No user interaction before generation

**Solutions:**

1. **Resume AudioContext on user click:**

   ```typescript
   document.addEventListener(
     'click',
     async () => {
       const audioContext = new AudioContext()
       if (audioContext.state === 'suspended') {
         await audioContext.resume()
         console.log('AudioContext resumed')
       }
     },
     { once: true }
   )
   ```

2. **Use OfflineAudioContext:**

   ```typescript
   // Doesn't require user gesture
   const offline = new OfflineAudioContext(2, sampleRate * duration, sampleRate)
   ```

3. **Show "Click to start" button:**
   ```html
   <button onclick="initAudio()">Start Generation</button>
   <script>
     async function initAudio() {
       const ctx = new AudioContext()
       await ctx.resume()
       // Now safe to generate audio
     }
   </script>
   ```

---

## Running Tests Locally

### Prerequisites

```bash
# Install dependencies
pnpm install

# Install Playwright browsers (first time only)
npx playwright install chromium
```

### Unit Tests

Test core functionality without browser:

```bash
# Run all unit tests
pnpm test

# Run specific test file
pnpm test audioConcat.test.ts

# Run with UI
pnpm test:ui

# Run with coverage
pnpm test -- --coverage
```

**Unit test coverage:**

- ✅ Audio concatenation (14 tests)
- ✅ Kokoro TTS client (25 tests)
- ✅ EPUB parsing (10 tests)
- ✅ Format detection (20 tests)
- ✅ Library storage (16 tests)

### E2E Tests

Test complete workflows in real browser:

```bash
# Run all E2E tests (headless)
pnpm test:e2e

# Run with visible browser
pnpm test:e2e:headed

# Run with Playwright UI
pnpm test:e2e:ui

# Run specific test
npx playwright test -g "should generate single chapter"
```

**E2E test coverage:**

- ✅ EPUB upload and parsing
- ✅ Single chapter generation (MP3, M4B)
- ✅ Multiple chapter generation
- ✅ Format selection (WAV, MP3, M4B)
- ✅ Bitrate selection (128-320 kbps)
- ✅ Progress tracking
- ✅ Download verification

### Debugging Failed Tests

#### 1. View Test Report

```bash
npx playwright show-report
```

Opens HTML report with:

- Test results
- Screenshots of failures
- Console logs
- Network activity

#### 2. Debug Specific Test

```bash
# Run single test in debug mode
npx playwright test -g "MP3 generation" --debug
```

Opens Playwright Inspector:

- Step through test
- Inspect page state
- View network requests
- Execute commands manually

#### 3. Enable Verbose Logging

```bash
# Show browser console logs
DEBUG=pw:browser pnpm test:e2e
```

#### 4. Keep Browser Open on Failure

```typescript
// In playwright.config.ts
use: {
  launchOptions: {
    devtools: true // Opens DevTools
  }
}
```

### Test Timeouts

| Test Type       | Default Timeout | Reason              |
| --------------- | --------------- | ------------------- |
| Unit tests      | 5s              | Fast, no I/O        |
| E2E: Upload     | 10s             | File reading        |
| E2E: Generation | 120s            | Model loading + TTS |
| E2E: Encoding   | 180s            | FFmpeg processing   |

Adjust timeouts in test files:

```typescript
test('slow operation', async ({ page }) => {
  test.setTimeout(300000) // 5 minutes
  // ... test code
})
```

---

## Additional Resources

### Code References

- **Chunking logic**: `src/lib/kokoro/kokoroClient.ts` (line 220-280)
- **Concatenation pipeline**: `src/lib/audioConcat.ts` (line 400-600)
- **Audio buffer processing**: `src/lib/audioConcat.ts` (line 217-250)
- **FFmpeg integration**: `src/lib/audioConcat.ts` (line 1-200)
- **Text preprocessing**: `src/lib/kokoro/textProcessor.ts`

### Documentation

- [Audio Concatenation](./AUDIO_CONCATENATION.md) - API reference, usage examples
- [Kokoro Integration](./KOKORO_INTEGRATION.md) - TTS model details, voice catalog
- [Audio Formats](./AUDIO_FORMATS.md) - Format comparison, quality settings
- [E2E Testing](./E2E_TESTING.md) - Test coverage, running tests locally
- [Implementation Summary](./IMPLEMENTATION_SUMMARY.md) - Technical overview

### External Links

- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [AudioContext](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext)
- [FFmpeg.wasm](https://ffmpegwasm.netlify.app/)
- [Kokoro TTS](https://github.com/hexgrad/kokoro)
- [Playwright Testing](https://playwright.dev/)

---

## Contributing

Found an issue not covered here? Please:

1. [Open an issue](https://github.com/Cabeda/audiobook-generator/issues) with details
2. Include browser version, OS, and error messages
3. Provide steps to reproduce

Pull requests to improve this documentation are welcome!
