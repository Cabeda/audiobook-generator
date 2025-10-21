# TTS Model Selection

## Overview

The audiobook generator now supports multiple Text-to-Speech (TTS) engines with an extensible architecture that makes it easy to add new models in the future.

## Available Models

### 1. Web Speech API (Default)

- **Description**: Browser built-in TTS using the Web Speech Synthesis API
- **Advantages**:
  - ✅ No model download required
  - ✅ Works offline immediately
  - ✅ Fast initialization
  - ✅ Low memory footprint
  - ✅ Uses system voices
- **Disadvantages**:
  - ❌ Quality depends on OS/browser
  - ❌ Limited voice customization
  - ❌ Inconsistent across platforms

### 2. Kokoro TTS

- **Description**: High-quality neural TTS model (ONNX-based)
- **Advantages**:
  - ✅ Consistent high quality across platforms
  - ✅ Multiple voice options (30+ voices)
  - ✅ Customizable quantization levels
  - ✅ Works offline after initial download
- **Disadvantages**:
  - ❌ Requires ~80-200MB model download
  - ❌ Higher memory usage
  - ❌ Slower initialization

## Usage

### User Interface

1. **Model Selection**: Choose between "Web Speech API" and "Kokoro TTS" in the TTS Model dropdown
2. **Voice Selection**: Available voices update automatically based on selected model
3. **Advanced Options**:
   - Kokoro-specific options (quantization) only appear when Kokoro is selected
   - Model preference is saved in browser localStorage

### For Developers

#### Architecture

The implementation uses a modular architecture with three layers:

1. **TTS Clients** (`src/lib/webspeech/`, `src/lib/kokoro/`)
   - Individual implementations for each TTS engine
   - Common interface: `generateVoice(params, onChunkProgress?): Promise<Blob>`

2. **Abstraction Layer** (`src/lib/tts/ttsModels.ts`)
   - Unified interface for all TTS engines
   - Factory function to get appropriate engine
   - Model metadata for UI display

3. **Worker Integration** (`src/tts.worker.ts`, `src/lib/ttsWorkerManager.ts`)
   - Routes requests to appropriate TTS engine
   - Handles progress reporting
   - Prevents UI blocking

#### Adding a New TTS Model

To add a new TTS model, follow these steps:

1. **Create a client module** (e.g., `src/lib/mytts/myTTSClient.ts`):

```typescript
export type GenerateParams = {
  text: string
  voice?: string
  speed?: number
  // Add model-specific options
}

export async function generateVoice(
  params: GenerateParams,
  onChunkProgress?: (current: number, total: number) => void
): Promise<Blob> {
  // Implementation
}

export function listVoices(): string[] {
  // Return available voices
}
```

2. **Update the abstraction layer** (`src/lib/tts/ttsModels.ts`):

```typescript
export type TTSModelType = 'webspeech' | 'kokoro' | 'mytts'

export const TTS_MODELS: TTSModelInfo[] = [
  // ... existing models
  {
    id: 'mytts',
    name: 'My TTS',
    description: 'Description of my TTS model',
    requiresDownload: true/false,
    supportsOffline: true/false,
  },
]

// Add case in getTTSEngine():
case 'mytts': {
  const { generateVoice } = await import('../mytts/myTTSClient')
  return {
    generateVoice: async (params, onChunkProgress) => {
      return generateVoice(params, onChunkProgress)
    },
  }
}
```

3. **Update the UI** (`src/components/GeneratePanel.svelte`):
   - Add voice loading logic if needed
   - Add model-specific options in the advanced section
   - Update voice list rendering

## Technical Details

### Web Speech API Implementation

The Web Speech API client (`src/lib/webspeech/webSpeechClient.ts`) includes:

- **Voice Loading**: Handles async voice loading across different browsers
- **Text Chunking**: Splits text into manageable chunks for stability
- **Audio Recording**: Uses MediaRecorder API to capture synthesized audio
- **Format Conversion**: Converts WebM to WAV for consistency

### Worker Architecture

All TTS generation happens in a Web Worker to prevent UI blocking:

1. Main thread sends generation request with model type
2. Worker loads appropriate TTS engine dynamically
3. Worker streams progress updates back to main thread
4. Completed audio returned as transferable ArrayBuffer

### Browser Compatibility

**Web Speech API**:

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support
- Mobile browsers: ⚠️ Limited (varies by OS)

**Kokoro TTS**:

- Chrome/Edge: ✅ Full support (WebAssembly + SIMD)
- Firefox: ✅ Full support
- Safari: ⚠️ May have performance limitations
- Mobile browsers: ⚠️ May require significant memory

## Configuration

### LocalStorage Keys

- `audiobook_model`: Selected TTS model type
- `audiobook_quantization`: Kokoro quantization level (only for Kokoro)

### Default Settings

- **Model**: Web Speech API (fastest startup)
- **Voice**: First available system voice
- **Quantization**: q8 (balanced speed/quality for Kokoro)

## Performance Considerations

### Memory Usage

- **Web Speech API**: ~10-50 MB (browser-dependent)
- **Kokoro TTS**:
  - q4: ~80 MB
  - q8: ~120 MB
  - fp16: ~160 MB
  - fp32: ~200 MB

### Generation Speed

- **Web Speech API**: 2-5x real-time (varies by system)
- **Kokoro TTS**: 1-3x real-time (depends on quantization)

### Startup Time

- **Web Speech API**: <1 second
- **Kokoro TTS**: 5-30 seconds (first time, includes download)

## Future Enhancements

Potential additions:

- [ ] ElevenLabs API integration
- [ ] Azure Cognitive Services
- [ ] Google Cloud TTS
- [ ] Coqui TTS
- [ ] Voice cloning options
- [ ] Pitch/speed controls for Web Speech API
- [ ] Voice preview functionality
- [ ] Batch voice selection for different chapters

## References

- [Web Speech API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [Kokoro TTS on Hugging Face](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX)
- [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/)
