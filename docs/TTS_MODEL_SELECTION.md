# TTS Model Selection

## Overview

The audiobook generator supports multiple Text-to-Speech (TTS) engines and is designed to be extensible so that new engines can be added easily.

## Available Models

### 1. Edge TTS (Default)

- **Description**: Edge TTS is a Node-backed deterministic TTS system (server or local Node runtime) and is the default for stable, silent generation.
- **Advantages**:
  - ✅ Deterministic audio across environments
  - ✅ No audible browser playback during generation
  - ✅ Works reliably in headless/test environments
  - ✅ Consistent quality independent of OS/browser
- **Disadvantages**:
  - ❌ Requires a Node runtime or backend (not a purely in-browser option)
  - ❌ May require network access if using a cloud-hosted service

### 2. Kokoro TTS

- **Description**: High-quality neural TTS model (ONNX-based)
- **Advantages**:
  - ✅ Consistent high quality across platforms
  - ✅ Multiple voice options (30+ voices)
  - ✅ Customizable quantization levels
  - ✅ Works offline after the initial model download
- **Disadvantages**:
  - ❌ Requires model download (~80-200 MB)
  - ❌ Higher memory usage
  - ❌ Slower initialization

## Usage

### User Interface

1. **Model Selection**: Choose between "Edge TTS" and "Kokoro TTS" in the TTS Model dropdown
2. **Voice Selection**: Available voices update automatically based on selected model
3. **Advanced Options**:
   - Kokoro-specific options (quantization) appear when Kokoro is selected
   - Model preference is saved in browser localStorage

### For Developers

#### Architecture

The implementation uses a modular architecture with three layers:

1. **TTS Clients** (`src/lib/edge/`, `src/lib/kokoro/`)
   - Individual implementations for each TTS engine
   - Common interface: `generateVoice(params, onChunkProgress?): Promise<Blob>`

2. **Abstraction Layer** (`src/lib/tts/ttsModels.ts`)
   - Unified interface for all TTS engines
   - Factory function to get the appropriate engine
   - Model metadata for UI display

3. **Worker Integration** (`src/tts.worker.ts`, `src/lib/ttsWorkerManager.ts`)
   - Routes requests to the appropriate TTS engine
   - Handles progress reporting
   - Runs generation in a worker to prevent UI blocking

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
export type TTSModelType = 'edge' | 'kokoro' | 'mytts'

// Add model info to TTS_MODELS and a case in getTTSEngine to lazy-import and return the engine
```

3. **Update the UI** (`src/components/GeneratePanel.svelte`):
   - Add voice loading logic if needed
   - Add model-specific options in the advanced section
   - Update voice list rendering

## Technical Details

### Edge TTS Implementation

The Edge TTS client (`src/lib/edge/edgeTtsClient.ts`) provides:

- **Voice Loading**: Lists voices available via the Edge/Node TTS implementation
- **Streaming**: Supports partial streaming for large batched generation
- **No Playback**: Returns a Blob/ArrayBuffer suitable for concatenation without playing audio in the browser

### Worker Architecture

1. Main thread sends a generation request with the model type
2. Worker loads the appropriate TTS engine dynamically
3. Worker streams progress updates back to the main thread
4. Completed audio returned as a transferable ArrayBuffer or Blob
   \*\*\* End Patch

- ❌ May require network access if using a cloud-hosted Edge TTS

1. Main thread sends generation request with model type
2. Worker loads appropriate TTS engine dynamically
3. Worker streams progress updates back to main thread
4. Completed audio returned as transferable ArrayBuffer

### Browser Compatibility

**Edge TTS**:

- Chrome/Edge: ✅ Full support (client/server integration)
- Firefox: ✅ Full support
- Safari: ✅ Full support
- Mobile browsers: ✅ Supports generation via server/Edge integration

**Kokoro TTS**:

- Chrome/Edge: ✅ Full support (WebAssembly + SIMD)
- Firefox: ✅ Full support
- Safari: ⚠️ May have performance limitations
- Mobile browsers: ⚠️ May require significant memory

## Configuration

### Edge TTS Implementation

The Edge TTS client (`src/lib/edge/edgeTtsClient.ts`) includes:

- **Voice Loading**: Lists voices available via the Edge/Node TTS implementation
- **Streaming**: Supports partial streaming for large batched generation
- **No Playback**: Returns a Blob/ArrayBuffer suitable for concatenation without playing audio in the browser

### Default Settings

**Edge TTS**:

- Chrome/Edge: ✅ Full support (client/server integration)
- Firefox: ✅ Full support
- Safari: ✅ Full support
- Mobile browsers: ✅ Supports generation via server/Edge integration

## Performance Considerations

- fp32: ~200 MB
  -- **Edge TTS**: 1-3x real-time (depends on backend)
  -- **Kokoro TTS**: 1-3x real-time (depends on quantization)

### Startup Time

-- **Edge TTS**: <1 - 5 seconds (depends on backend/initialization)

- **Kokoro TTS**: 5-30 seconds (first time, includes download)

## Future Enhancements

Potential additions:

- [ ] ElevenLabs API integration
- [ ] Azure Cognitive Services
- [ ] Google Cloud TTS
- [ ] Coqui TTS
- [ ] Voice cloning options
      -- [ ] Pitch/speed controls for Edge TTS
- [ ] Voice preview functionality
- [ ] Batch voice selection for different chapters

## References

---

- [Kokoro TTS on Hugging Face](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX)
- [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/)
