# Audio Format Selection

## Overview

The audiobook generator now supports multiple output formats: MP3, M4B (audiobook format), and WAV. Users can select their preferred format and quality settings before generating the complete audiobook.

## Supported Formats

### MP3 (Recommended)
- **File Extension**: `.mp3`
- **Compression**: Lossy
- **File Size**: Small (10-20MB per hour at 192kbps)
- **Quality Options**: 128, 192, 256, 320 kbps
- **Best For**: General listening, sharing, mobile devices
- **Compatibility**: Universal (all devices and players)

### M4B (Audiobook Format)
- **File Extension**: `.m4b`
- **Compression**: Lossy (MP3-based)
- **File Size**: Small (similar to MP3)
- **Quality Options**: 128, 192, 256, 320 kbps
- **Best For**: Audiobook apps, iTunes, Apple Books
- **Compatibility**: iOS, macOS, Windows (with iTunes)
- **Features**: Audiobook metadata, chapter markers (future)

### WAV (Uncompressed)
- **File Extension**: `.wav`
- **Compression**: None
- **File Size**: Large (~600MB per hour)
- **Quality**: Lossless (16-bit PCM, 44.1kHz)
- **Best For**: Archival, further processing, maximum quality
- **Compatibility**: Universal

## Usage

### From UI

1. Open the audiobook generator
2. Upload your EPUB file
3. Select chapters to generate
4. **Choose output format** from the dropdown:
   - MP3 (Recommended)
   - M4B (Audiobook)
   - WAV (Uncompressed)
5. **Select bitrate** (for MP3/M4B):
   - 128 kbps - Smaller file size
   - 192 kbps - Balanced (default)
   - 256 kbps - High quality
   - 320 kbps - Maximum quality
6. Click "Generate & Download Audiobook"

### Programmatic Usage

```typescript
import { concatenateAudioChapters, type AudioFormat } from './lib/audioConcat'

// Generate MP3 at 192 kbps (recommended)
const mp3Blob = await concatenateAudioChapters(
  chapters,
  {
    format: 'mp3',
    bitrate: 192,
    bookTitle: 'My Audiobook',
    bookAuthor: 'Author Name'
  }
)

// Generate M4B audiobook at 256 kbps
const m4bBlob = await concatenateAudioChapters(
  chapters,
  {
    format: 'm4b',
    bitrate: 256,
    bookTitle: 'My Audiobook',
    bookAuthor: 'Author Name'
  }
)

// Generate uncompressed WAV
const wavBlob = await concatenateAudioChapters(
  chapters,
  {
    format: 'wav'
  }
)
```

## Quality vs File Size Comparison

For a 1-hour audiobook:

| Format | Bitrate | File Size | Quality | Use Case |
|--------|---------|-----------|---------|----------|
| MP3 | 128 kbps | ~60 MB | Good | Mobile, streaming |
| MP3 | 192 kbps | ~90 MB | Very Good | **Recommended** |
| MP3 | 256 kbps | ~120 MB | Excellent | High quality |
| MP3 | 320 kbps | ~150 MB | Maximum | Audiophiles |
| M4B | 192 kbps | ~90 MB | Very Good | Audiobook apps |
| WAV | N/A | ~600 MB | Lossless | Archival |

## Technical Implementation

### MP3 Encoding

Uses [lamejs](https://github.com/zhuker/lamejs) for browser-based MP3 encoding:

```typescript
- Input: AudioBuffer (Float32Array samples)
- Conversion: Float32 → Int16 PCM
- Encoding: LAME MP3 encoder
- Block size: 1152 samples (standard MP3 frame)
- Output: MP3 blob with MIME type 'audio/mpeg'
```

### M4B Format

M4B files are MP3-encoded with audiobook-specific metadata:

```typescript
- Base format: MP3
- MIME type: 'audio/m4b'
- Metadata: Book title, author (embedded)
- Future: Chapter markers, cover art
```

### WAV Format

Uncompressed PCM audio:

```typescript
- Format: PCM (Linear)
- Bit depth: 16-bit
- Sample rate: 44.1 kHz (or source rate)
- Channels: Stereo (2 channels)
- Byte order: Little-endian
```

## Format Selection Guidelines

### Choose MP3 if:
- ✅ You want small file sizes
- ✅ You need universal compatibility
- ✅ You're listening on mobile devices
- ✅ You're sharing the audiobook

### Choose M4B if:
- ✅ You use Apple Books or audiobook apps
- ✅ You want audiobook-specific features
- ✅ You need chapter navigation (future)
- ✅ You're organizing an audiobook library

### Choose WAV if:
- ✅ You need maximum quality
- ✅ You're archiving the audiobook
- ✅ You plan to process the audio further
- ✅ Storage space is not a concern

## Bitrate Recommendations

### For Speech/Audiobooks:

- **128 kbps**: Acceptable quality, very small files
- **192 kbps**: ⭐ **Recommended** - Best balance of quality and size
- **256 kbps**: High quality, larger files
- **320 kbps**: Maximum quality, largest files (overkill for speech)

### General Rule:
Speech content doesn't benefit much from bitrates above 192 kbps. The sweet spot is **192 kbps** for audiobooks.

## Browser Compatibility

| Format | Chrome | Firefox | Safari | Edge |
|--------|--------|---------|--------|------|
| MP3 | ✅ | ✅ | ✅ | ✅ |
| M4B | ✅ | ✅ | ✅ | ✅ |
| WAV | ✅ | ✅ | ✅ | ✅ |

All formats work in modern browsers (2020+).

## API Reference

### ConcatenationOptions

```typescript
type ConcatenationOptions = {
  format?: 'wav' | 'mp3' | 'm4b'  // Default: 'wav'
  bitrate?: number                 // Default: 192 (MP3/M4B only)
  bookTitle?: string               // Optional metadata
  bookAuthor?: string              // Optional metadata
}
```

### AudioFormat

```typescript
type AudioFormat = 'wav' | 'mp3' | 'm4b'
```

## Future Enhancements

- [ ] **ID3 Tags**: Embed title, author, cover art in MP3
- [ ] **Chapter Markers**: Add chapter navigation to M4B
- [ ] **AAC Encoding**: Native M4B with AAC codec
- [ ] **Opus Support**: Modern, efficient codec
- [ ] **Variable Bitrate**: Better quality at same file size
- [ ] **Streaming Export**: Process in chunks for large audiobooks

## Troubleshooting

### MP3 sounds distorted

**Problem**: Audio quality is poor or distorted

**Solutions**:
1. Increase bitrate (try 256 or 320 kbps)
2. Check source audio quality
3. Verify no clipping in source audio

### File size too large

**Problem**: Generated file is too big

**Solutions**:
1. Use MP3 instead of WAV
2. Lower bitrate (try 128 or 192 kbps)
3. Check if you selected multiple chapters

### M4B won't play in app

**Problem**: M4B file doesn't open in audiobook app

**Solutions**:
1. Try MP3 format instead
2. Verify app supports M4B format
3. Check file wasn't corrupted during download

## Examples

### Generate high-quality MP3

```typescript
const audiobook = await concatenateAudioChapters(chapters, {
  format: 'mp3',
  bitrate: 256,
  bookTitle: 'Robinson Crusoe',
  bookAuthor: 'Daniel Defoe'
})
```

### Generate compact M4B for mobile

```typescript
const audiobook = await concatenateAudioChapters(chapters, {
  format: 'm4b',
  bitrate: 128,
  bookTitle: 'My Audiobook',
  bookAuthor: 'Author'
})
```

### Generate archival WAV

```typescript
const audiobook = await concatenateAudioChapters(chapters, {
  format: 'wav'
})
```

## References

- [LAME MP3 Encoder](https://lame.sourceforge.io/)
- [lamejs - JavaScript MP3 Encoder](https://github.com/zhuker/lamejs)
- [MP3 Format Specification](https://en.wikipedia.org/wiki/MP3)
- [M4B Audiobook Format](https://en.wikipedia.org/wiki/M4B)
- [WAV File Format](http://soundfile.sapp.org/doc/WaveFormat/)
