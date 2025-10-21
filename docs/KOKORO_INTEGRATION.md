# Kokoro TTS Integration

This document describes the integration of the [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) text-to-speech model into the audiobook generator.

## Overview

Kokoro is an open-weight TTS model with 82 million parameters. Despite its lightweight architecture, it delivers comparable quality to larger models while being significantly faster and more cost-efficient. The model runs 100% locally in the browser using ONNX Runtime Web.

### Key Features

- **Lightweight**: Only 82M parameters, optimized for browser execution
- **High Quality**: StyleTTS2 architecture with ISTFTNet decoder
- **Open License**: Apache 2.0 licensed, can be deployed anywhere
- **Browser-Native**: Runs entirely in the browser via WASM or WebGPU
- **Multiple Voices**: 27 voices across American and British English
- **Smart Preprocessing**: Automatic text normalization, G2P conversion, IPA phonemization

## Architecture

### Text Processing Pipeline

```
Input Text
    ↓
Text Normalization (numbers, currencies, abbreviations)
    ↓
Grapheme-to-Phoneme (G2P) using espeak-ng
    ↓
IPA Phoneme Tokenization
    ↓
StyleTTS2 Model Inference
    ↓
ISTFTNet Decoder
    ↓
24kHz Audio Output (WAV)
```

### Model Details

- **Architecture**: StyleTTS 2 + ISTFTNet decoder
- **Sample Rate**: 24kHz
- **Phoneme System**: IPA (International Phonetic Alphabet)
- **G2P Engine**: espeak-ng via WASM
- **Model Formats**: fp32, fp16, q8, q4, q4f16 (quantized)
- **Execution**: WASM (default) or WebGPU

## Usage

### Basic Generation

```typescript
import { generateVoice } from './lib/kokoro/kokoroClient'

// Generate speech from text
const audioBlob = await generateVoice({
  text: 'Hello world! This is Kokoro TTS.',
  voice: 'af_heart', // Optional: default is 'af_heart'
  speed: 1.0, // Optional: default is 1.0
})

// Use the blob (e.g., create audio element)
const audio = new Audio(URL.createObjectURL(audioBlob))
audio.play()
```

### Streaming Generation (for long texts)

```typescript
import { generateVoiceStream } from './lib/kokoro/kokoroClient'

// Stream audio sentence-by-sentence
for await (const chunk of generateVoiceStream({
  text: longText,
  voice: 'af_bella',
  speed: 1.2,
})) {
  console.log('Generated:', chunk.text)
  console.log('Phonemes:', chunk.phonemes)

  // Play or save chunk.audio (Blob)
  const audio = new Audio(URL.createObjectURL(chunk.audio))
  audio.play()
}
```

### Available Voices

```typescript
import { listVoices } from './lib/kokoro/kokoroClient'

const voices = listVoices()
// Returns: ['af_heart', 'af_bella', 'bm_george', ...]
```

## Voice Options

### American English (Female)

- `af_heart` ⭐ - Heart (Grade: A, Quality: A) - **Recommended**
- `af_bella` 🔥 - Bella (Grade: A-, Quality: A)
- `af_aoede` - Aoede (Grade: C+, Quality: B)
- `af_jessica` - Jessica (Grade: B-, Quality: B)
- `af_sarah` - Sarah (Grade: B-, Quality: B)
- `af_alloy` - Alloy (Grade: C, Quality: B)
- `af_kore` - Kore (Grade: C, Quality: B)
- `af_nicole` - Nicole (Grade: C, Quality: B)
- `af_nova` - Nova (Grade: C, Quality: B)
- `af_river` - River (Grade: C, Quality: B)
- `af_sky` - Sky (Grade: C, Quality: B)

### American English (Male)

- `am_adam` - Adam (Grade: C, Quality: B)
- `am_echo` - Echo (Grade: C+, Quality: B)
- `am_eric` - Eric (Grade: C, Quality: B)
- `am_michael` - Michael (Grade: C+, Quality: B)
- `am_puck` - Puck (Grade: C+, Quality: B)
- `am_liam` - Liam (Grade: D, Quality: C)
- `am_onyx` - Onyx (Grade: D, Quality: C)
- `am_santa` - Santa (Grade: D-, Quality: C)

### British English (Female)

- `bf_emma` ⭐ - Emma (Grade: A, Quality: A)
- `bf_isabella` - Isabella (Grade: C, Quality: B)
- `bf_alice` - Alice (Grade: D, Quality: C)
- `bf_lily` - Lily (Grade: D, Quality: C)

### British English (Male)

- `bm_george` - George (Grade: C, Quality: B)
- `bm_fable` - Fable (Grade: C, Quality: B)
- `bm_lewis` - Lewis (Grade: D+, Quality: C)
- `bm_daniel` - Daniel (Grade: D, Quality: C)

## Text Normalization

Kokoro automatically handles:

### Numbers

- **Decimals**: `12.34` → "twelve point three four"
- **Years**: `1990` → "nineteen ninety"
- **Times**: `12:34` → "twelve thirty four"
- **Large numbers**: `1,000` → "one thousand"
- **Ranges**: `10-20` → "ten to twenty"

### Currency

- **Dollars**: `$100` → "one hundred dollars"
- **Pounds**: `£1.50` → "one pound and fifty pence"

### Abbreviations

- `Dr.` → "Doctor"
- `Mr.` → "Mister"
- `Mrs.` → "Mrs"
- `Ms.` → "Miss"
- `etc.` → "et cetera"

### Special Characters

- Quotes: `'text'` → proper phonemization
- Parentheses: `(text)` → «text»
- Multiple spaces/newlines → normalized

## Performance

### Model Loading

- **First load**: ~5-10 seconds (downloads model files)
- **Subsequent loads**: Instant (cached in IndexedDB)
- **Model size**:
  - q8 (recommended): ~82MB
  - q4: ~41MB
  - fp32: ~328MB

### Generation Speed

- **WASM**: ~0.5-1.0s per sentence
- **WebGPU**: ~0.2-0.5s per sentence (if available)

### Memory Usage

- **Model**: ~200-400MB RAM
- **Per generation**: ~10-20MB

## Advanced Configuration

### Custom Model

```typescript
const audioBlob = await generateVoice({
  text: 'Custom model example',
  model: 'onnx-community/Kokoro-82M-v1.0-ONNX', // Default
})
```

### Model Precision

Edit `kokoroClient.ts` to change default precision:

```typescript
async function getKokoroInstance(
  modelId: string = 'onnx-community/Kokoro-82M-v1.0-ONNX',
  dtype: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16' = 'q8', // Change here
  device: 'wasm' | 'webgpu' = 'wasm' // Or use 'webgpu' if available
)
```

Precision tradeoffs:

- `fp32`: Highest quality, largest size (328MB), slowest
- `fp16`: High quality, medium size (164MB), medium speed
- `q8`: Good quality, small size (82MB), fast ⭐ **Recommended**
- `q4`: Lower quality, smallest size (41MB), fastest
- `q4f16`: Balanced quality/size (123MB)

## Integration with EPUB Parser

The Kokoro client is integrated with the EPUB parser in `GeneratePanel.svelte`:

```typescript
import { generateVoice } from '../lib/kokoro/kokoroClient'

// Generate audio for each chapter
for (const chapter of selectedChapters) {
  const audioBlob = await generateVoice({
    text: chapter.content,
    voice: selectedVoice,
    speed: selectedSpeed,
  })
  // Save or play audioBlob
}
```

## Testing

Run the test suite:

```bash
npm test
```

Tests cover:

- Voice listing
- Basic generation
- Custom voices
- Speed control
- Empty text handling
- Long text handling
- Special characters

## Troubleshooting

### Model fails to load

- **Issue**: Network error or CORS issue
- **Solution**: Ensure you're running on localhost or HTTPS. HuggingFace CDN requires HTTPS.

### Audio quality is poor

- **Issue**: Using q4 quantization
- **Solution**: Switch to q8 or fp16 for better quality

### Generation is slow

- **Issue**: Using fp32 or WASM on slow device
- **Solution**:
  1. Try WebGPU if available
  2. Use q8 or q4 quantization
  3. Enable hardware acceleration in browser

### Out of memory

- **Issue**: Browser tab crashes during generation
- **Solution**:
  1. Use q4 quantization (smallest model)
  2. Close other tabs
  3. Use streaming generation for long texts

## References

- [Kokoro GitHub](https://github.com/hexgrad/kokoro)
- [Kokoro HuggingFace](https://huggingface.co/hexgrad/Kokoro-82M)
- [kokoro-js NPM](https://www.npmjs.com/package/kokoro-js)
- [StyleTTS 2 Paper](https://arxiv.org/abs/2306.07691)
- [espeak-ng](https://github.com/espeak-ng/espeak-ng)

## License

Kokoro-82M is licensed under Apache 2.0, allowing commercial use.
