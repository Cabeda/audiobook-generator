import { KokoroTTS } from 'kokoro-js'

// Valid Kokoro voice IDs based on the official kokoro-js library
export type VoiceId =
  | 'af_heart' | 'af_alloy' | 'af_aoede' | 'af_bella' | 'af_jessica'
  | 'af_kore' | 'af_nicole' | 'af_nova' | 'af_river' | 'af_sarah'
  | 'af_sky' | 'am_adam' | 'am_echo' | 'am_eric' | 'am_liam'
  | 'am_michael' | 'am_onyx' | 'am_puck' | 'am_santa' | 'bf_emma'
  | 'bf_isabella' | 'bm_george' | 'bm_lewis' | 'bf_alice' | 'bf_lily'
  | 'bm_daniel' | 'bm_fable'

export type GenerateParams = {
  text: string
  voice?: VoiceId
  speed?: number
  model?: string
}

// Singleton instance for model caching
let ttsInstance: KokoroTTS | null = null

/**
 * Initialize or retrieve the cached Kokoro TTS instance
 * @param modelId - HuggingFace model ID (default: onnx-community/Kokoro-82M-v1.0-ONNX)
 * @param dtype - Model precision: "fp32", "fp16", "q8", "q4", "q4f16" (default: q8 for speed)
 * @param device - Execution device: "wasm" or "webgpu" (default: wasm for compatibility)
 */
async function getKokoroInstance(
  modelId: string = 'onnx-community/Kokoro-82M-v1.0-ONNX',
  dtype: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16' = 'q8',
  device: 'wasm' | 'webgpu' = 'wasm'
): Promise<KokoroTTS> {
  if (!ttsInstance) {
    console.log(`Loading Kokoro TTS model: ${modelId} (${dtype}, ${device})...`)
    ttsInstance = await KokoroTTS.from_pretrained(modelId, {
      dtype,
      device,
      progress_callback: (progress: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (progress.loaded && progress.total) {
          const percent = ((progress.loaded / progress.total) * 100).toFixed(1)
          console.log(`Loading ${progress.file}: ${percent}%`)
        } else {
          console.log(`Model loading: ${progress.status}`)
        }
      }
    })
    console.log('Kokoro TTS model loaded successfully')
  }
  return ttsInstance
}

/**
 * Generate speech from text using Kokoro TTS
 * @param params - Generation parameters
 * @returns WAV audio blob
 */
export async function generateVoice(params: GenerateParams): Promise<Blob> {
  const {
    text,
    voice = 'af_heart' as VoiceId, // Default voice: Heart (high-quality female American English)
    speed = 1.0,
    model = 'onnx-community/Kokoro-82M-v1.0-ONNX'
  } = params

  try {
    // Get or initialize the TTS instance
    const tts = await getKokoroInstance(model)

    // Generate audio using the real Kokoro model
    // This handles:
    // - Text normalization (numbers, currencies, abbreviations)
    // - Grapheme-to-phoneme conversion (using espeak-ng)
    // - IPA phoneme tokenization
    // - StyleTTS2 inference with ISTFTNet decoder
    // - 24kHz audio generation
    const audio = await tts.generate(text, { voice, speed } as unknown as Parameters<typeof tts.generate>[1])

    // Convert RawAudio to Blob
    return audio.toBlob()
  } catch (error) {
    console.error('Kokoro TTS generation failed:', error)
    throw new Error(`Failed to generate speech: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Generate speech in streaming mode for long texts
 * @param params - Generation parameters
 * @returns Async generator yielding audio blobs with metadata
 */
export async function* generateVoiceStream(params: GenerateParams): AsyncGenerator<{
  text: string
  phonemes: string
  audio: Blob
}> {
  const {
    text,
    voice = 'af_heart' as VoiceId,
    speed = 1.0,
    model = 'onnx-community/Kokoro-82M-v1.0-ONNX'
  } = params

  try {
    const tts = await getKokoroInstance(model)

    // Stream generates audio sentence-by-sentence
    for await (const chunk of tts.stream(text, { voice, speed } as unknown as Parameters<typeof tts.stream>[1])) {
      yield {
        text: chunk.text,
        phonemes: chunk.phonemes,
        audio: chunk.audio.toBlob()
      }
    }
  } catch (error) {
    console.error('Kokoro TTS streaming failed:', error)
    throw new Error(`Failed to stream speech: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * List all available voices
 * @returns Array of voice IDs
 */
export function listVoices(): VoiceId[] {
  // Return the known voices from kokoro-js
  const voices: VoiceId[] = [
    'af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica',
    'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah',
    'af_sky', 'am_adam', 'am_echo', 'am_eric', 'am_liam',
    'am_michael', 'am_onyx', 'am_puck', 'am_santa', 'bf_emma',
    'bf_isabella', 'bm_george', 'bm_lewis', 'bf_alice', 'bf_lily',
    'bm_daniel', 'bm_fable'
  ]
  return voices
}
