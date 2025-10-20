# Audio Concatenation Feature

## Overview

The audio concatenation feature allows users to combine multiple chapter audio files into a single complete audiobook file. This makes it easy to create a unified listening experience and simplifies audiobook distribution.

## Features

✅ **Automatic Concatenation** - Combines all generated chapters in correct order  
✅ **Progress Tracking** - Real-time progress updates during concatenation  
✅ **Chapter Preservation** - Maintains chapter order from EPUB spine  
✅ **Automatic Download** - Downloads complete audiobook automatically  
✅ **Smart Filename** - Uses book title for output filename  
✅ **WAV Format** - High-quality uncompressed audio output  

## Usage

### From UI

The GeneratePanel component now provides three options:

1. **Generate Chapters** - Generate audio for each chapter individually
2. **Generate & Download Audiobook** - Generate all chapters and automatically create combined audiobook
3. **Download Complete Audiobook** - Combine already-generated chapters (appears after generation)

### Programmatic Usage

```typescript
import { concatenateAudioChapters, downloadAudioFile, type AudioChapter } from './lib/audioConcat'

// Prepare chapter audio data
const audioChapters: AudioChapter[] = [
  {
    id: 'ch1',
    title: 'Chapter 1: Introduction',
    blob: chapter1AudioBlob
  },
  {
    id: 'ch2', 
    title: 'Chapter 2: The Journey Begins',
    blob: chapter2AudioBlob
  }
]

// Concatenate with progress tracking
const combinedBlob = await concatenateAudioChapters(
  audioChapters,
  (progress) => {
    console.log(progress.message)
    // Progress states: loading, decoding, concatenating, encoding, complete
  }
)

// Download the audiobook
downloadAudioFile(combinedBlob, 'my-audiobook.wav')
```

## API Reference

### `concatenateAudioChapters()`

Combines multiple audio blobs into a single audio file.

```typescript
async function concatenateAudioChapters(
  chapters: AudioChapter[],
  onProgress?: (progress: ConcatenationProgress) => void
): Promise<Blob>
```

**Parameters:**
- `chapters` - Array of audio chapters with metadata
- `onProgress` - Optional callback for progress updates

**Returns:** Combined audio blob in WAV format

**Progress States:**
- `loading` - Loading audio chapters
- `decoding` - Decoding audio data to AudioBuffers
- `concatenating` - Combining audio buffers
- `encoding` - Encoding final WAV file
- `complete` - Process finished

### `downloadAudioFile()`

Triggers browser download of audio file.

```typescript
function downloadAudioFile(blob: Blob, filename: string): void
```

**Parameters:**
- `blob` - Audio blob to download
- `filename` - Desired filename (e.g., 'audiobook.wav')

### `createChapterMarkers()`

Creates chapter marker metadata (for future M4B/MP3 support).

```typescript
function createChapterMarkers(
  chapters: AudioChapter[],
  audioBuffers: AudioBuffer[]
): string
```

**Returns:** Chapter markers in standard format with timestamps

### `getAudioDuration()`

Gets duration of audio blob without playing it.

```typescript
function getAudioDuration(blob: Blob): Promise<number>
```

**Returns:** Duration in seconds

## Technical Details

### Audio Processing Pipeline

```
Input: Multiple chapter audio blobs
  ↓
1. Decode each blob to AudioBuffer (Web Audio API)
  ↓
2. Calculate total length (sum of all buffers)
  ↓
3. Create output buffer with combined length
  ↓
4. Copy all audio data sequentially
  ↓
5. Encode to WAV format
  ↓
Output: Single combined WAV blob
```

### Format Specifications

- **Output Format**: WAV (PCM)
- **Bit Depth**: 16-bit
- **Sample Rate**: 44.1kHz (or source rate)
- **Channels**: Stereo (2 channels)
- **Encoding**: Little-endian PCM

### Performance

- **Memory Usage**: ~2x the size of all input audio combined
- **Processing Time**: ~0.5-2 seconds per minute of audio
- **File Size**: ~10MB per minute of stereo audio (WAV)

### Browser Compatibility

Requires:
- Web Audio API (AudioContext)
- Blob API
- File API
- Modern ES6+ support

Tested on:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Limitations & Future Enhancements

### Current Limitations

1. **Format**: Only WAV output (large file size)
2. **Memory**: All audio loaded into memory at once
3. **Chapters**: No embedded chapter markers in output file

### Planned Enhancements

- [ ] **MP3 Export** - Add MP3 encoding for smaller files
- [ ] **M4B Support** - Create M4B audiobooks with chapter markers
- [ ] **Streaming Processing** - Process audio in chunks to reduce memory
- [ ] **Chapter Metadata** - Embed chapter markers in M4B/MP3
- [ ] **Quality Settings** - User-selectable bitrate/quality
- [ ] **Format Selection** - Choose output format (WAV/MP3/M4B)

## Examples

### Basic Usage

```typescript
// Generate and concatenate
const chapters = await generateAllChapters()
const audiobook = await concatenateAudioChapters(chapters)
downloadAudioFile(audiobook, 'robinson-crusoe.wav')
```

### With Progress Tracking

```typescript
let currentStatus = ''

const audiobook = await concatenateAudioChapters(chapters, (progress) => {
  currentStatus = `${progress.status}: ${progress.current}/${progress.total}`
  console.log(progress.message)
})

console.log('Complete!')
```

### Error Handling

```typescript
try {
  const audiobook = await concatenateAudioChapters(chapters)
  downloadAudioFile(audiobook, 'audiobook.wav')
} catch (error) {
  console.error('Concatenation failed:', error)
  alert('Failed to create audiobook. Please try again.')
}
```

## Testing

Run the test suite:

```bash
npm test -- audioConcat.test.ts
```

**Test Coverage:**
- ✅ Single chapter handling
- ✅ Multiple chapter concatenation
- ✅ Progress callback invocation
- ✅ Chapter marker generation
- ✅ Download functionality
- ✅ Error handling
- ✅ Empty input validation

**Results:** 7/7 tests passing

## Troubleshooting

### "Out of memory" error

**Problem**: Browser runs out of memory during concatenation

**Solutions:**
1. Reduce number of chapters processed at once
2. Use lower quality TTS settings
3. Close other browser tabs
4. Try a different browser with more available memory

### Download doesn't start

**Problem**: File doesn't download after concatenation

**Solutions:**
1. Check browser download settings
2. Ensure pop-ups are not blocked
3. Try manually clicking download button again
4. Check browser console for errors

### Audio quality issues

**Problem**: Combined audio sounds degraded

**Solutions:**
1. Ensure all source chapters have same sample rate
2. Check individual chapter quality before concatenating
3. Verify source audio is not already compressed

## References

- [Web Audio API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [WAV File Format Specification](http://soundfile.sapp.org/doc/WaveFormat/)
- [AudioBuffer Interface](https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer)
