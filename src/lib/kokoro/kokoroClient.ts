import { KokoroTTS } from 'kokoro-js'

// Valid Kokoro voice IDs based on the official kokoro-js library
export type VoiceId =
  | 'af_heart'
  | 'af_alloy'
  | 'af_aoede'
  | 'af_bella'
  | 'af_jessica'
  | 'af_kore'
  | 'af_nicole'
  | 'af_nova'
  | 'af_river'
  | 'af_sarah'
  | 'af_sky'
  | 'am_adam'
  | 'am_echo'
  | 'am_eric'
  | 'am_liam'
  | 'am_michael'
  | 'am_onyx'
  | 'am_puck'
  | 'am_santa'
  | 'bf_emma'
  | 'bf_isabella'
  | 'bm_george'
  | 'bm_lewis'
  | 'bf_alice'
  | 'bf_lily'
  | 'bm_daniel'
  | 'bm_fable'

export type GenerateParams = {
  text: string
  voice?: VoiceId
  speed?: number
  model?: string
  dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
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
      progress_callback: (progress: {
        status: string
        file?: string
        loaded?: number
        total?: number
      }) => {
        if (progress.loaded && progress.total) {
          const percent = ((progress.loaded / progress.total) * 100).toFixed(1)
          console.log(`Loading ${progress.file}: ${percent}%`)
        } else {
          console.log(`Model loading: ${progress.status}`)
        }
      },
    })
    console.log('Kokoro TTS model loaded successfully')
  }
  return ttsInstance
}

/**
 * Split text into chunks at sentence boundaries
 * Kokoro TTS works best with smaller text chunks (recommended: ~500-1000 chars)
 */
export function splitTextIntoChunks(text: string, maxChunkSize: number = 1000): string[] {
  const chunks: string[] = []

  // Split by sentences (periods, question marks, exclamation points)
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text]

  let currentChunk = ''
  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim()
    if (!trimmedSentence) continue

    // If adding this sentence would exceed the limit, save current chunk and start new one
    if (currentChunk.length + trimmedSentence.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim())
      currentChunk = trimmedSentence + ' '
    } else {
      currentChunk += trimmedSentence + ' '
    }
  }

  // Add the last chunk if it has content
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
  }

  return chunks.length > 0 ? chunks : [text]
}

/**
 * Generate speech from text using Kokoro TTS
 * For long texts, automatically splits into chunks and concatenates
 * @param params - Generation parameters
 * @returns WAV audio blob
 */
export async function generateVoice(
  params: GenerateParams,
  onChunkProgress?: (current: number, total: number) => void
): Promise<Blob> {
  const {
    text,
    voice = 'af_heart' as VoiceId, // Default voice: Heart (high-quality female American English)
    speed = 1.0,
    model = 'onnx-community/Kokoro-82M-v1.0-ONNX',
    dtype = 'q8',
  } = params

  try {
    // Get or initialize the TTS instance
    const tts = await getKokoroInstance(model, dtype)

    // For very long text, split into chunks to avoid TTS limitations
    // Most TTS models have token/character limits
    const MAX_CHUNK_SIZE = 1000 // characters per chunk

    if (text.length > MAX_CHUNK_SIZE) {
      console.log(`Long text detected (${text.length} chars), splitting into chunks...`)
      const chunks = splitTextIntoChunks(text, MAX_CHUNK_SIZE)
      console.log(`Split into ${chunks.length} chunks`)

      // Generate audio for each chunk
      const audioBlobs: Blob[] = []
      for (let i = 0; i < chunks.length; i++) {
        console.log(`Generating chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`)

        // Report chunk progress
        if (onChunkProgress) {
          onChunkProgress(i + 1, chunks.length)
        }

        const audio = await tts.generate(chunks[i], { voice, speed } as unknown as Parameters<
          typeof tts.generate
        >[1])
        audioBlobs.push(audio.toBlob())

        // Small delay between chunks to prevent overwhelming the system
        if (i < chunks.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      }

      // If only one chunk, return it directly
      if (audioBlobs.length === 1) {
        return audioBlobs[0]
      }

      // For multiple chunks, we need to properly concatenate the audio
      // Import concatenation utility
      const { concatenateAudioChapters } = await import('../audioConcat.ts')
      const audioChapters = audioBlobs.map((blob, i) => ({
        id: `chunk-${i}`,
        title: `Chunk ${i + 1}`,
        blob,
      }))

      console.log(`Concatenating ${audioBlobs.length} audio chunks...`)
      return await concatenateAudioChapters(audioChapters, { format: 'wav' })
    }

    // For short text, generate directly
    // Generate audio using the real Kokoro model
    // This handles:
    // - Text normalization (numbers, currencies, abbreviations)
    // - Grapheme-to-phoneme conversion (using espeak-ng)
    // - IPA phoneme tokenization
    // - StyleTTS2 inference with ISTFTNet decoder
    // - 24kHz audio generation
    const audio = await tts.generate(text, { voice, speed } as unknown as Parameters<
      typeof tts.generate
    >[1])

    // Convert RawAudio to Blob
    return audio.toBlob()
  } catch (error) {
    console.error('Kokoro TTS generation failed:', error)
    throw new Error(
      `Failed to generate speech: ${error instanceof Error ? error.message : String(error)}`
    )
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
    model = 'onnx-community/Kokoro-82M-v1.0-ONNX',
    dtype = 'q8',
  } = params

  try {
    const tts = await getKokoroInstance(model, dtype)

    // Stream generates audio sentence-by-sentence
    for await (const chunk of tts.stream(text, { voice, speed } as unknown as Parameters<
      typeof tts.stream
    >[1])) {
      yield {
        text: chunk.text,
        phonemes: chunk.phonemes,
        audio: chunk.audio.toBlob(),
      }
    }
  } catch (error) {
    console.error('Kokoro TTS streaming failed:', error)
    throw new Error(
      `Failed to stream speech: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * List all available voices
 * @returns Array of voice IDs
 */
export function listVoices(): VoiceId[] {
  // Return the known voices from kokoro-js
  const voices: VoiceId[] = [
    'af_heart',
    'af_alloy',
    'af_aoede',
    'af_bella',
    'af_jessica',
    'af_kore',
    'af_nicole',
    'af_nova',
    'af_river',
    'af_sarah',
    'af_sky',
    'am_adam',
    'am_echo',
    'am_eric',
    'am_liam',
    'am_michael',
    'am_onyx',
    'am_puck',
    'am_santa',
    'bf_emma',
    'bf_isabella',
    'bm_george',
    'bm_lewis',
    'bf_alice',
    'bf_lily',
    'bm_daniel',
    'bm_fable',
  ]
  return voices
}
