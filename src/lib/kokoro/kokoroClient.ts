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

// Helper to detect thenable/promise-like objects (cross-realm Promise instances too)
function isThenable(obj: unknown): obj is PromiseLike<unknown> {
  // Avoid 'any' by casting to a safe type with an optional 'then' property
  try {
    return !!obj && typeof (obj as { then?: unknown }).then === 'function'
  } catch {
    return false
  }
}

// Singleton instance for model caching
let ttsInstance: KokoroTTS | null = null

/**
 * Initialize or retrieve the cached Kokoro TTS instance
 * @param modelId - HuggingFace model ID (default: onnx-community/Kokoro-82M-v1.0-ONNX)
 * @param dtype - Model precision: "fp32", "fp16", "q8", "q4", "q4f16" (default: q8 for speed)
 * @param device - Execution device: "wasm" or "webgpu" (default: wasm for compatibility)
 */
/**
 * Factory for custom fetch wrapper that caches large model files using the Cache API
 * @param originalFetch - The original global fetch function to avoid recursion
 */
function createFetchWithCache(originalFetch: typeof fetch) {
  return async function fetchWithCache(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

    // Only cache ONNX model files and their configs
    // The model file is large (~300MB) and static
    // Check if Cache API is available (it might not be in some test environments)
    if (typeof caches === 'undefined') {
      return originalFetch(input, init)
    }

    if (url.includes('onnx') || url.includes('config.json') || url.includes('model.onnx')) {
      try {
        const cacheName = 'kokoro-models-v1'
        const cache = await caches.open(cacheName)
        const cachedResponse = await cache.match(input)

        if (cachedResponse) {
          console.warn(`[KokoroCache] Serving from cache: ${url}`)
          return cachedResponse
        }

        console.warn(`[KokoroCache] Fetching and caching: ${url}`)
        // Fetch from network using original fetch to avoid recursion
        const networkResponse = await originalFetch(input, init)

        // Clone response to store in cache (streams can only be read once)
        // Ensure we only cache successful responses
        if (networkResponse.ok) {
          try {
            await cache.put(input, networkResponse.clone())
          } catch (err) {
            console.warn('[KokoroCache] Failed to cache response:', err)
          }
        }

        return networkResponse
      } catch (err) {
        console.warn('[KokoroCache] Cache access failed, falling back to network:', err)
        return originalFetch(input, init)
      }
    }

    // Default behavior for other requests
    return originalFetch(input, init)
  }
}

async function getKokoroInstance(
  modelId: string = 'onnx-community/Kokoro-82M-v1.0-ONNX',
  dtype: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16' = 'q8',
  device: 'wasm' | 'webgpu' = 'wasm'
): Promise<KokoroTTS> {
  // In test environments, do not reuse the cached instance to avoid leaking mocked
  // behavior across tests (vitest re-mocks modules per-test but caching module
  // state can persist between tests). When not testing, keep the cache for
  // performance.
  const isTestEnv =
    process.env.NODE_ENV === 'test' ||
    (globalThis as unknown as { __vitest__?: boolean }).__vitest__ === true
  if (!ttsInstance || isTestEnv) {
    console.warn(`[KokoroClient] Initializing instance. Model: ${modelId}`)
    console.log(`Loading Kokoro TTS model: ${modelId} (${dtype}, ${device})...`)

    // Intercept global fetch to enable caching for the model loading
    const originalFetch = globalThis.fetch
    // Create cached fetch using the original fetch to avoid recursion
    globalThis.fetch = createFetchWithCache(originalFetch) as typeof fetch

    try {
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
    } finally {
      // Restore original fetch
      globalThis.fetch = originalFetch
    }
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
  const sentences: string[] = text.match(/[^.!?]+[.!?]+/g) || []

  // If no sentence-ending punctuation found, split by other delimiters
  if (sentences.length === 0) {
    // Try splitting by commas, semicolons, or newlines
    const parts = text.split(/[,;\n]+/).filter((p) => p.trim())
    if (parts.length > 1) {
      sentences.push(...parts.map((p) => p.trim()))
    } else {
      // Last resort: split by words if text is too long
      if (text.length > maxChunkSize) {
        const words = text.split(/\s+/)
        let wordChunk = ''
        for (const word of words) {
          if (wordChunk.length + word.length + 1 > maxChunkSize && wordChunk.length > 0) {
            sentences.push(wordChunk.trim())
            wordChunk = word + ' '
          } else {
            wordChunk += word + ' '
          }
        }
        if (wordChunk.trim()) {
          sentences.push(wordChunk.trim())
        }
      } else {
        sentences.push(text)
      }
    }
  }

  let currentChunk = ''
  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim()
    if (!trimmedSentence) continue

    // If a single sentence is longer than maxChunkSize, it becomes its own chunk
    if (trimmedSentence.length > maxChunkSize) {
      // Save current chunk if it has content
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim())
        currentChunk = ''
      }
      // Add the long sentence as its own chunk
      chunks.push(trimmedSentence)
      continue
    }

    // If adding this sentence would exceed the limit, save current chunk and start new one
    if (
      currentChunk.length + trimmedSentence.length + 1 > maxChunkSize &&
      currentChunk.length > 0
    ) {
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
 * For long texts, automatically splits into chunks and concatenates using streaming
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

    // For very long text, use streaming to avoid TTS limitations
    // Most TTS models have token/character limits
    const MAX_CHUNK_SIZE = 1000 // characters per chunk

    if (text.length > MAX_CHUNK_SIZE) {
      console.log(`Long text detected (${text.length} chars), using streaming approach...`)

      // Split text into chunks first to get accurate count
      const chunks = splitTextIntoChunks(text, MAX_CHUNK_SIZE)
      console.log(`Split into ${chunks.length} chunks`)

      // Report accurate total chunks for progress from the start
      if (onChunkProgress) {
        onChunkProgress(0, chunks.length)
      }

      // Import TextSplitterStream from kokoro-js
      const { TextSplitterStream } = await import('kokoro-js')

      // Set up the stream
      const splitter = new TextSplitterStream()
      const stream = tts.stream(splitter, { voice, speed } as unknown as Parameters<
        typeof tts.stream
      >[1])

      // Collect audio blobs from the stream
      const audioBlobs: Blob[] = []
      let chunkCount = 0

      // Process stream in parallel with feeding text
      const streamPromise = (async () => {
        for await (const { text: chunkText, phonemes: _phonemes, audio } of stream) {
          chunkCount++
          console.log(`Generated chunk ${chunkCount}: ${chunkText.substring(0, 50)}...`)
          // Diagnostic: capture the exact type/shape of the audio object (may be a Blob, JSHandle, or other wrapper)
          try {
            const props = [] as string[]
            try {
              props.push(...Object.getOwnPropertyNames(audio))
            } catch (e) {
              // Some host-provided wrappers can throw on property access (e.g., Playwright JSHandle)
              props.push(`uninspectable (${String(e)})`)
            }
            console.log(
              `Chunk ${chunkCount} audio object: typeof=${typeof audio}; constructor=${audio?.constructor?.name}; hasToBlob=${typeof (audio as any)?.toBlob === 'function'}; props=${props.slice(0, 10).join(',')}`
            )
          } catch (e) {
            console.warn(`Failed to inspect audio object for chunk ${chunkCount}:`, e)
          }
          // audio may be some object with a toBlob method; toBlob can be
          // synchronous or asynchronous. Wrap in try/catch to surface errors
          // from chunk conversion and log helpful context.
          try {
            const maybeBlob = (audio as any).toBlob()
            // Log the type of the return value to detect wrapper types like JSHandle
            try {
              const maybeProps = [] as string[]
              try {
                maybeProps.push(...Object.getOwnPropertyNames(maybeBlob))
              } catch (_e) {
                maybeProps.push('uninspectable')
              }
              const maybeString =
                typeof maybeBlob === 'object'
                  ? String((maybeBlob as any)?.toString?.())
                  : String(maybeBlob)
              const isJSHandle =
                maybeString.includes('JSHandle') ||
                (maybeBlob?.constructor?.name || '').includes('JSHandle')
              if (isJSHandle) {
                console.warn(`Chunk ${chunkCount} maybeBlob looks like a JSHandle: ${maybeString}`)
              }
              const isMaybeThenable = isThenable(maybeBlob)
              console.log(
                `Chunk ${chunkCount} maybeBlob: typeof=${typeof maybeBlob}; constructor=${maybeBlob?.constructor?.name}; isThenable=${isMaybeThenable}; props=${maybeProps.slice(0, 10).join(',')}`
              )
            } catch {
              // swallow logging errors
            }

            const blob = isThenable(maybeBlob) ? await maybeBlob : maybeBlob
            // Post-conversion: log Blob-like characteristics
            try {
              console.log(
                `Chunk ${chunkCount} converted blob: instanceofBlob=${blob instanceof Blob}; constructor=${blob?.constructor?.name}; type=${blob?.type}; size=${blob?.size}`
              )
            } catch (e) {
              console.log(`Chunk ${chunkCount} converted blob: cannot introspect blob:`, e)
            }
            audioBlobs.push(blob)
          } catch (e) {
            console.error(
              `Failed to convert chunk ${chunkCount} to Blob. chunkText: ${chunkText.substring(0, 60)}...`,
              e
            )
            // Re-throw so the outer catch handler can surface this as a failure.
            throw e
          }

          // Report chunk progress with actual total
          if (onChunkProgress) {
            onChunkProgress(chunkCount, chunks.length)
          }
        }
      })()

      // Feed text to the stream in chunks
      for (const chunk of chunks) {
        splitter.push(chunk)
        // Small delay between chunks to prevent overwhelming the system
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      // Close the stream to signal that no more text will be added
      splitter.close()

      // Wait for all audio to be generated
      await streamPromise

      // If only one chunk, return it directly
      if (audioBlobs.length === 1) {
        return audioBlobs[0]
      }

      // For multiple chunks, we need to properly concatenate the audio
      // Import concatenation utility
      const { concatenateAudioChapters, audioLikeToBlob } = await import('../audioConcat.ts')
      const audioChapters = audioBlobs.map((blob, i) => ({
        id: `chunk-${i}`,
        title: `Chunk ${i + 1}`,
        blob,
      }))

      console.log(`Concatenating ${audioBlobs.length} audio chunks...`)

      // Log blob details for debugging: type and length
      try {
        for (let i = 0; i < audioBlobs.length; i++) {
          const blob = audioBlobs[i]
          try {
            const arr = await blob.arrayBuffer()
            console.log(`Chunk ${i + 1} blob type: ${blob.type}; size: ${arr.byteLength}`)
          } catch (e) {
            console.warn(`Failed to read chunk ${i + 1} blob:`, e)
          }
        }
      } catch (e) {
        console.warn('Failed to inspect audio blob info:', e)
      }

      try {
        // Run a final pass to ensure all audio blobs are real Blobs by converting
        // anything that isn't a Blob into a WAV Blob using audioLikeToBlob
        for (let i = 0; i < audioChapters.length; i++) {
          try {
            if (!(audioChapters[i].blob instanceof Blob)) {
              audioChapters[i].blob = await audioLikeToBlob(audioChapters[i].blob as unknown)
            }
          } catch (e) {
            console.warn(`Falling back conversion of chunk ${i} failed:`, e)
            throw e
          }
        }
        return await concatenateAudioChapters(audioChapters, { format: 'wav' })
      } catch (error) {
        // Enrich logged error with stack/message when available
        if (error instanceof Error) {
          console.error('Concatenation error stack:', error.stack)
        } else {
          try {
            console.error('Concatenation error:', JSON.stringify(error))
          } catch (_e) {
            console.error('Concatenation error:', error)
          }
        }
        throw error
      }
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
    const toBlobFn = (audio as unknown as { toBlob?: () => unknown })?.toBlob
    if (typeof toBlobFn !== 'function') {
      throw new Error('Generated audio object does not expose toBlob()')
    }
    const maybe = toBlobFn.call(audio)
    const blob = isThenable(maybe) ? await maybe : maybe
    try {
      const maybeString =
        typeof maybe === 'object'
          ? String((maybe as unknown as { toString?: () => string })?.toString?.())
          : String(maybe)
      const ctorName = (maybe as unknown as { constructor?: { name?: string } })?.constructor?.name
      console.log(
        `[kokoroClient] generate() toBlob result: typeof=${typeof maybe}; constructor=${ctorName}; repr=${maybeString}`
      )
    } catch {
      // ignore logging errors
    }
    if (blob instanceof Blob) {
      return blob
    }
    // Fallback: convert non-Blob audio-like into Blob using audioLikeToBlob
    const { audioLikeToBlob } = await import('../audioConcat.ts')
    return await audioLikeToBlob(blob as unknown)
  } catch (error) {
    console.error('Kokoro TTS generation failed:', error)
    // Reset cached TTS instance when generation fails due to unexpected wrapper
    // to avoid repeated failures when using test mocks that replace kokoro-js
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - clear cached module for subsequent test runs
      ttsInstance = null
    } catch {
      // ignore
    }
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
      // Ensure audio is a Blob, awaiting toBlob() if it returns a Promise.
      try {
        // Diagnostic logging similar to generateVoice
        const audio = (chunk as unknown as { audio?: unknown }).audio
        try {
          const props = [] as string[]
          try {
            props.push(...Object.getOwnPropertyNames(audio))
          } catch (e) {
            props.push('uninspectable')
          }
          const hasToBlob = typeof (audio as unknown as { toBlob?: unknown })?.toBlob === 'function'
          const ctorName = (audio as unknown as { constructor?: { name?: string } })?.constructor
            ?.name
          console.log(
            `Stream chunk audio object: typeof=${typeof audio}; constructor=${ctorName}; hasToBlob=${hasToBlob}; props=${props.slice(0, 10).join(',')}`
          )
        } catch (e) {
          console.warn('Failed to inspect stream chunk audio object:', e)
        }

        const toBlobFn = (audio as unknown as { toBlob?: () => unknown })?.toBlob
        if (typeof toBlobFn !== 'function') {
          throw new Error('Streaming chunk audio object does not have toBlob()')
        }
        const maybe = toBlobFn.call(audio)
        const audioBlob = isThenable(maybe) ? await maybe : maybe
        try {
          const maybeString =
            typeof audioBlob === 'object'
              ? String((audioBlob as unknown as { toString?: () => string })?.toString?.())
              : String(audioBlob)
          if (maybeString.includes('JSHandle')) {
            console.warn('Stream chunk converted blob looks like JSHandle:', maybeString)
          }
          const ablob = audioBlob as Blob
          console.log(
            `Stream chunk converted blob: instanceofBlob=${ablob instanceof Blob}; constructor=${ablob?.constructor?.name}; type=${ablob?.type}; size=${ablob?.size}`
          )
        } catch (e) {
          console.warn('Failed to inspect converted stream chunk blob:', e)
        }
        yield {
          text: chunk.text,
          phonemes: chunk.phonemes,
          audio: audioBlob as Blob,
        }
      } catch (e) {
        console.error('Failed to convert streaming chunk audio to Blob:', e)
        throw e
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
