/**
 * Audio concatenation utilities for combining chapter audio into a complete audiobook
 */
import { FFmpeg } from '@ffmpeg/ffmpeg'

// Singleton FFmpeg instance
let ffmpegInstance: FFmpeg | null = null
let ffmpegLoaded = false

/**
 * Get or create FFmpeg instance
 */
async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegLoaded) {
    return ffmpegInstance
  }

  if (!ffmpegInstance) {
    ffmpegInstance = new FFmpeg()

    // Enable logging for debugging
    ffmpegInstance.on('log', ({ message }) => {
      console.log('[FFmpeg]', message)
      if (message.includes('Aborted()')) {
        console.warn('[FFmpeg] Detected Abort! Resetting instance.')
        ffmpegLoaded = false
        ffmpegInstance = null
      }
    })
  }

  if (!ffmpegLoaded) {
    try {
      // Use ESM build from jsdelivr with direct URLs (no toBlobURL needed)
      const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm'
      console.log('[FFmpeg] Loading FFmpeg core from:', baseURL)

      await ffmpegInstance.load({
        coreURL: `${baseURL}/ffmpeg-core.js`,
        wasmURL: `${baseURL}/ffmpeg-core.wasm`,
      })

      console.log('[FFmpeg] Successfully loaded')
      ffmpegLoaded = true
    } catch (err) {
      console.error('[FFmpeg] Failed to load:', err)
      // Reset instance so it can be retried
      ffmpegInstance = null
      ffmpegLoaded = false
      throw new Error(`Failed to load FFmpeg: ${String(err)}`)
    }
  }

  return ffmpegInstance
}

// Compatibility wrappers for different @ffmpeg/ffmpeg builds/APIs
type FFmpegFS = {
  FS?: (
    op: 'writeFile' | 'readFile' | 'unlink' | 'remove',
    filename: string,
    data?: Uint8Array
  ) => Uint8Array | void
}

async function ffWriteFile(ffmpeg: FFmpeg, filename: string, data: Uint8Array) {
  const asWithWrite = ffmpeg as unknown as {
    writeFile?: (name: string, d: Uint8Array) => Promise<void> | void
  } & FFmpegFS

  if (typeof asWithWrite.writeFile === 'function') {
    // some builds return a promise
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - allow calling possible promise-returning API
    return await asWithWrite.writeFile(filename, data)
  }

  if (typeof asWithWrite.FS === 'function') {
    return asWithWrite.FS('writeFile', filename, data)
  }

  throw new Error('FFmpeg write API not available')
}

async function ffRun(ffmpeg: FFmpeg, args: string[]) {
  const asWithRun = ffmpeg as unknown as {
    exec?: (a: string[]) => Promise<unknown>
    run?: (...a: string[]) => Promise<unknown>
  }

  try {
    if (typeof asWithRun.exec === 'function') {
      console.log('[FFmpeg] Executing with exec():', args.join(' '))
      const result = await asWithRun.exec(args)
      console.log('[FFmpeg] Execution completed successfully')
      return result
    }

    if (typeof asWithRun.run === 'function') {
      console.log('[FFmpeg] Executing with run():', args.join(' '))
      try {
        const result = await asWithRun.run(...args)
        console.log('[FFmpeg] Execution completed successfully')
        return result
      } catch {
        // fallback: some builds accept an array as single arg
        // The call signature may not match compile-time types; ignore here with explanation.
        console.log('[FFmpeg] Retrying with array argument')
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore: calling run with an array is required for some FFmpeg builds
        const result = await asWithRun.run(args)
        console.log('[FFmpeg] Execution completed successfully')
        return result
      }
    }

    throw new Error('FFmpeg run/exec API not available')
  } catch (err) {
    console.error('[FFmpeg] Execution failed:', err)
    throw err
  }
}

async function ffReadFile(ffmpeg: FFmpeg, filename: string): Promise<Uint8Array> {
  const asWithRead = ffmpeg as unknown as {
    readFile?: (name: string) => Promise<Uint8Array | string> | Uint8Array | string
  } & FFmpegFS

  try {
    if (typeof asWithRead.readFile === 'function') {
      const result = asWithRead.readFile(filename)
      const data = result instanceof Promise ? await result : result

      if (!data) {
        throw new Error(
          `File '${filename}' not found in FFmpeg virtual filesystem (readFile returned null/undefined)`
        )
      }

      if (typeof data === 'string') {
        return new TextEncoder().encode(data)
      }
      return data
    }

    if (typeof asWithRead.FS === 'function') {
      const data = asWithRead.FS('readFile', filename) as Uint8Array
      if (!data) {
        throw new Error(
          `File '${filename}' not found in FFmpeg virtual filesystem (FS returned null/undefined)`
        )
      }
      return data
    }

    throw new Error('FFmpeg read API not available')
  } catch (err) {
    console.error(`[FFmpeg] Error reading file '${filename}':`, err)
    throw new Error(
      `Failed to read file '${filename}' from FFmpeg: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

async function ffDeleteFile(ffmpeg: FFmpeg, filename: string) {
  const asWithDelete = ffmpeg as unknown as FFmpegFS & {
    deleteFile?: (name: string) => Promise<void> | void
  }

  if (typeof asWithDelete.deleteFile === 'function') {
    // Some FFmpeg builds expose deleteFile with a different signature; ignore types here.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore: call deleteFile when available
    return await asWithDelete.deleteFile(filename)
  }

  if (typeof asWithDelete.FS === 'function') {
    try {
      return asWithDelete.FS('unlink', filename)
    } catch {
      try {
        return asWithDelete.FS('remove', filename)
      } catch {
        // best-effort cleanup; ignore errors
      }
    }
  }

  // nothing to do
}

export type AudioFormat = 'wav' | 'mp3' | 'm4b' | 'mp4'

export type AudioChapter = {
  id: string
  title: string
  blob: Blob
  duration?: number
}

export type ConcatenationProgress = {
  current: number
  total: number
  status: 'loading' | 'decoding' | 'concatenating' | 'encoding' | 'complete'
  message: string
}

export type ConcatenationOptions = {
  format?: AudioFormat
  bitrate?: number // For MP3: 128, 192, 256, 320 kbps
  bookTitle?: string
  bookAuthor?: string
}

// Helper: resample and ensure channel counts are consistent
export function resampleAndNormalizeAudioBuffers(
  audioContext: BaseAudioContext,
  buffers: AudioBuffer[]
): AudioBuffer[] {
  const targetSampleRate = audioContext.sampleRate
  const targetNumChannels = Math.max(...buffers.map((b) => b.numberOfChannels))

  return buffers.map((buf) => {
    // 1) Convert channel count if necessary
    let converted = buf
    if (buf.numberOfChannels !== targetNumChannels) {
      converted = convertChannels(buf, targetNumChannels, audioContext)
    }

    // 2) Resample if necessary
    if (converted.sampleRate !== targetSampleRate) {
      converted = resampleBuffer(converted, targetSampleRate, audioContext)
    }

    return converted
  })
}

/**
 * Convert various audio-like objects into a WAV Blob. This helper accepts:
 * - Blob -> returned as-is
 * - ArrayBuffer / Uint8Array -> wrapped in Blob
 * - Objects with arrayBuffer() -> await and wrap in Blob
 * - AudioBuffer-like objects (with numberOfChannels and getChannelData) -> convert to WAV via audioBufferToWav
 */
export async function audioLikeToBlob(
  audio: unknown,
  _seen: WeakSet<object> = new WeakSet(),
  _depth = 0
): Promise<Blob> {
  if (!audio) throw new Error('No audio provided')
  // Prevent infinite recursion on self-referencing wrapper values
  try {
    if (typeof audio === 'object' && audio !== null) {
      if (_seen.has(audio)) {
        throw new Error('Detected circular audio wrapper reference during conversion')
      }
      _seen.add(audio)
    }
  } catch (e) {
    // Some host wrappers might throw when used as map keys; ignore
  }

  // If already a Blob
  if (audio instanceof Blob) return audio

  // If it's an ArrayBuffer
  if (audio instanceof ArrayBuffer) return new Blob([audio], { type: 'audio/wav' })

  if (audio instanceof Uint8Array)
    return new Blob([new Uint8Array(audio).buffer], { type: 'audio/wav' })

  // Type guards
  function hasArrayBufferMethod(
    a: unknown
  ): a is { arrayBuffer: () => Promise<ArrayBuffer>; type?: string } {
    return !!a && typeof (a as any).arrayBuffer === 'function'
  }

  function isAudioBufferLike(a: unknown): a is AudioBuffer {
    return (
      !!a &&
      typeof (a as any).numberOfChannels === 'number' &&
      typeof (a as any).getChannelData === 'function' &&
      typeof (a as any).sampleRate === 'number'
    )
  }

  // If it has arrayBuffer() method (e.g., Response or other wrappers)
  if (hasArrayBufferMethod(audio)) {
    try {
      const arr = await audio.arrayBuffer()
      const t = (audio as any).type as string | undefined
      return new Blob([arr], { type: t || 'audio/wav' })
    } catch (e) {
      // fall through
    }
  }

  // If it looks like an AudioBuffer-like object
  if (isAudioBufferLike(audio)) {
    try {
      // Use internal converter
      return audioBufferToWav(audio as AudioBuffer)
    } catch (e) {
      // fall through
    }
  }

  // Abort if we've unwrapped too many levels to avoid infinite recursion
  if (_depth > 12) {
    throw new Error('Exceeded maximum audio wrapper unwrapping depth')
  }

  // If it's a Promise-like that resolves to something, await it and try again
  if (typeof (audio as any)?.then === 'function') {
    try {
      const resolved = await (audio as Promise<unknown>)
      return await audioLikeToBlob(resolved, _seen, _depth + 1)
    } catch {
      // fall through
    }
  }

  // If it's a JSHandle-like wrapper exported from e.g. Playwright, attempt to find underlying value
  const ctorName = (audio as any)?.constructor?.name
  if (typeof ctorName === 'string' && ctorName.includes('JSHandle')) {
    // Try common unwrapping patterns, including Playwright's jsonValue/getter style
    const candidates = [
      (audio as any).value,
      (audio as any).json,
      (audio as any).toJSON,
      (audio as any).payload,
      // Playwright's JSHandle exposes jsonValue() which returns a Promise
      typeof (audio as any).jsonValue === 'function' ? (audio as any).jsonValue() : undefined,
      // Some wrappers may expose a getter like .get() or .valueOf()
      typeof (audio as any).get === 'function' ? (audio as any).get() : undefined,
      typeof (audio as any).valueOf === 'function' ? (audio as any).valueOf() : undefined,
    ]

    for (const cand of candidates) {
      if (cand == null) continue
      try {
        // If candidate is a Promise, await it
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore - runtime checks will ensure safety
        const resolved = typeof (cand as any)?.then === 'function' ? await cand : cand
        const maybe = await audioLikeToBlob(resolved, _seen, _depth + 1)
        return maybe
      } catch (e) {
        // try next candidate
      }
    }
    // If none of the unwrapping attempts returned something useful, inspect representation
    const repr = String(audio?.toString?.() ?? audio)
    if (repr.includes('JSHandle@error')) {
      // Explicit error returned from the wrapper; surface as failure for consumer to handle
      // Log a warning for tests to assert on
      console.warn('[audioLikeToBlob] JSHandle reported an error state:', repr)
      throw new Error('JSHandle reported an error when attempting to convert to Blob')
    }
    console.warn(
      '[audioLikeToBlob] Detected JSHandle-like wrapper but could not unwrap it. Throwing strict error.'
    )
    // Strict mode: do not fallback to a fake blob; throw and let caller handle the error.
    throw new Error('Unsupported JSHandle-like wrapper; could not convert to Blob')
  }

  // If we reach here we cannot convert
  throw new Error(
    `Unsupported audio type for conversion: ${String(audio?.constructor?.name || typeof audio)}`
  )
}

// Convert number of channels by duplicating or mixing channels
function convertChannels(
  buffer: AudioBuffer,
  targetChannels: number,
  audioContext: BaseAudioContext
): AudioBuffer {
  if (buffer.numberOfChannels === targetChannels) return buffer
  const out = audioContext.createBuffer(targetChannels, buffer.length, buffer.sampleRate)

  for (let ch = 0; ch < targetChannels; ch++) {
    const outData = out.getChannelData(ch)
    if (ch < buffer.numberOfChannels) {
      outData.set(buffer.getChannelData(ch))
    } else {
      // Duplicate last channel if fewer channels than target
      outData.set(buffer.getChannelData(buffer.numberOfChannels - 1))
    }
  }

  return out
}

// Resample AudioBuffer to the target sample rate using linear interpolation
function resampleBuffer(
  buffer: AudioBuffer,
  targetSampleRate: number,
  audioContext: BaseAudioContext
): AudioBuffer {
  if (buffer.sampleRate === targetSampleRate) return buffer

  const ratio = targetSampleRate / buffer.sampleRate
  const newLength = Math.round(buffer.length * ratio)
  const out = audioContext.createBuffer(buffer.numberOfChannels, newLength, targetSampleRate)

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const input = buffer.getChannelData(ch)
    const output = out.getChannelData(ch)
    for (let i = 0; i < newLength; i++) {
      const srcIndex = i / ratio
      const i0 = Math.floor(srcIndex)
      const i1 = Math.min(i0 + 1, input.length - 1)
      const frac = srcIndex - i0
      const v0 = input[i0]
      const v1 = input[i1]
      output[i] = v0 + frac * (v1 - v0)
    }
  }

  return out
}

/**
 * Concatenate multiple audio blobs into a single audio file
 * @param chapters - Array of audio chapters with metadata
 * @param options - Concatenation options including format
 * @param onProgress - Optional progress callback
 * @returns Combined audio blob with chapter markers
 */
export async function concatenateAudioChapters(
  chapters: AudioChapter[],
  options: ConcatenationOptions = {},
  onProgress?: (progress: ConcatenationProgress) => void
): Promise<Blob> {
  const { format = 'wav', bitrate = 192 } = options
  if (chapters.length === 0) {
    throw new Error('No chapters to concatenate')
  }

  // Optimize: If all inputs are WAV and output is WAV, use efficient Blob composition
  // This avoids loading the entire audiobook into memory (AudioContext or FFmpeg FS)
  if (format === 'wav' && chapters.every((c) => c.blob.type.includes('wav'))) {
    try {
      console.log('[audioConcat] Using optimized WAV concatenation')
      return await concatWavBlobs(chapters)
    } catch (err) {
      console.warn('[audioConcat] Optimized WAV concat failed, falling back:', err)
      // Fallthrough to other methods
    }
  }

  // Note: Even with single chapter, we still process it to ensure correct format
  if (chapters.length === 1 && format === 'wav' && chapters[0].blob.type === 'audio/wav') {
    return chapters[0].blob
  }

  // Create audio context for processing when available. Some environments
  // (e.g., Web Workers, headless) may not expose `AudioContext` or
  // `OfflineAudioContext`. When Web Audio is unavailable, we fall back to an
  // FFmpeg-based concatenation which works in both workers and main thread.
  let audioContext: AudioContext | OfflineAudioContext | null = null
  if (typeof (globalThis as any).AudioContext === 'function') {
    audioContext = new (globalThis as any).AudioContext()
    console.log('[audioConcat] Using AudioContext')
  } else if (typeof (globalThis as any).OfflineAudioContext === 'function') {
    // Use a minimal offline context for decoding and resampling in worker contexts
    audioContext = new (globalThis as any).OfflineAudioContext(2, 1, 44100)
    console.log('[audioConcat] Using OfflineAudioContext (worker fallback)')
  } else if (typeof (globalThis as any).webkitAudioContext === 'function') {
    audioContext = new (globalThis as any).webkitAudioContext()
    console.log('[audioConcat] Using webkitAudioContext')
  }
  const sampleRate = (audioContext as any)?.sampleRate || 44100
  console.log(
    `[audioConcat] audioContext: ${audioContext?.constructor?.name || 'unknown'}; sampleRate: ${sampleRate}`
  )

  onProgress?.({
    current: 0,
    total: chapters.length,
    status: 'loading',
    message: 'Loading audio chapters...',
  })

  // If we couldn't create a WebAudio context, fallback to FFmpeg-based
  // concatenation which doesn't rely on Web Audio APIs and works in worker
  // contexts. This is particularly useful for headless CI and the web worker
  // where AudioContext is missing.
  if (!audioContext) {
    console.warn(
      '[audioConcat] Web Audio API unavailable — attempting FFmpeg-based concat fallback'
    )
    try {
      return await ffmpegConcatenateBlobs(chapters, format, bitrate, options, onProgress)
    } catch (err) {
      console.warn('[audioConcat] FFmpeg fallback failed:', err)
      // Try a lightweight WAV-only concatenation if all inputs are WAV PCM with matching params
      try {
        return await concatWavBlobs(chapters)
      } catch (wavErr) {
        console.error('[audioConcat] WAV-only concatenation fallback failed:', wavErr)
        throw new Error(
          'Web Audio API not available and FFmpeg fallback failed; cannot concatenate audio'
        )
      }
    }
  }

  // Decode all audio blobs to AudioBuffers
  const audioBuffers: AudioBuffer[] = []
  for (let i = 0; i < chapters.length; i++) {
    onProgress?.({
      current: i + 1,
      total: chapters.length,
      status: 'decoding',
      message: `Decoding chapter ${i + 1}/${chapters.length}: ${chapters[i].title}`,
    })

    // Yield to UI thread to prevent blocking
    await new Promise((resolve) => setTimeout(resolve, 0))

    try {
      const blob = chapters[i].blob
      console.log(`[audioConcat] Decoding chapter ${i + 1}: size=${blob.size}, type=${blob.type}`)

      // Validate blob size
      if (blob.size === 0) {
        console.warn(
          `[audioConcat] Chapter ${i + 1} "${chapters[i].title}" has empty audio blob. Generating 1s silence.`
        )
        // Create 1 second of silence
        const silence = audioContext.createBuffer(1, sampleRate, sampleRate)
        audioBuffers.push(silence)
        continue
      }

      const arrayBuffer = await blob.arrayBuffer()

      // Log first few bytes to help diagnose format issues
      const view = new Uint8Array(arrayBuffer.slice(0, 12))
      const header = String.fromCharCode(...view.slice(0, 4))
      console.log(
        `[audioConcat] Chapter ${i + 1} header: "${header}" (bytes: ${Array.from(view.slice(0, 12)).join(',')})`
      )

      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
      audioBuffers.push(audioBuffer)
    } catch (err) {
      console.error(`[audioConcat] Failed to decode chapter ${i + 1} "${chapters[i].title}":`, err)
      // Instead of failing the entire process, try to add silence for failed chapters too
      try {
        console.warn(`[audioConcat] Generating silence for failed chapter ${i + 1}`)
        const silence = audioContext.createBuffer(1, sampleRate, sampleRate)
        audioBuffers.push(silence)
      } catch (e) {
        throw new Error(
          `Failed to decode audio for chapter ${i + 1} "${chapters[i].title}": ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }

  // Normalize sample rate / channel count across decoded buffers
  const normalizedBuffers = resampleAndNormalizeAudioBuffers(audioContext, audioBuffers)

  onProgress?.({
    current: 0,
    total: 1,
    status: 'concatenating',
    message: 'Concatenating audio chapters...',
  })

  // Calculate total length
  const totalLength = normalizedBuffers.reduce((sum, buffer) => sum + buffer.length, 0)
  const numberOfChannels = normalizedBuffers[0].numberOfChannels

  // Create output buffer
  const outputBuffer = audioContext.createBuffer(numberOfChannels, totalLength, sampleRate)

  // Copy all audio data into output buffer
  let offset = 0
  for (let i = 0; i < normalizedBuffers.length; i++) {
    const buffer = normalizedBuffers[i]

    // Yield before processing each chapter to keep UI responsive. In Web Workers
    // requestAnimationFrame may not exist, so fall back to setTimeout.
    await new Promise((resolve) =>
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(() => setTimeout(resolve, 0))
        : setTimeout(resolve, 0)
    )

    for (let channel = 0; channel < numberOfChannels; channel++) {
      const outputData = outputBuffer.getChannelData(channel)
      const inputData = buffer.getChannelData(channel)
      outputData.set(inputData, offset)
    }

    offset += buffer.length
  }

  onProgress?.({
    current: 0,
    total: 1,
    status: 'encoding',
    message: `Encoding to ${format.toUpperCase()}...`,
  })

  // Convert to requested format
  let outputBlob: Blob

  switch (format) {
    case 'mp3':
      outputBlob = await audioBufferToMp3(outputBuffer, bitrate, chapters, options)
      break
    case 'm4b':
      // M4B uses AAC encoding with .m4b extension and chapter metadata
      outputBlob = await audioBufferToMp3(outputBuffer, bitrate, chapters, options)
      break
    case 'mp4':
      // MP4 uses AAC encoding with .mp4 extension and chapter metadata
      outputBlob = await audioBufferToMp3(outputBuffer, bitrate, chapters, options)
      break
    case 'wav':
    default:
      outputBlob = audioBufferToWav(outputBuffer)
      break
  }

  onProgress?.({
    current: 1,
    total: 1,
    status: 'complete',
    message: 'Audiobook created successfully!',
  })

  // Close audio context to free resources if the method exists
  if (typeof (audioContext as any).close === 'function') {
    try {
      await (audioContext as any).close()
    } catch {
      // Swallow errors closing contexts in some environments
    }
  }

  return outputBlob
}

/**
 * Convert AudioBuffer to MP3, M4B, or MP4 blob using FFmpeg
 */
export async function audioBufferToMp3(
  audioBuffer: AudioBuffer,
  bitrate: number,
  chapters: AudioChapter[],
  options: ConcatenationOptions
): Promise<Blob> {
  // First convert AudioBuffer to WAV
  const wavBlob = audioBufferToWav(audioBuffer)

  // Then convert WAV to MP3, M4B, or MP4 using FFmpeg
  const ffmpeg = await getFFmpeg()

  // Determine output format and file (declare here so finally can reference)
  const isM4B = options.format === 'm4b'
  const isMP4 = options.format === 'mp4'
  const outputFile = isM4B ? 'output.m4b' : isMP4 ? 'output.mp4' : 'output.mp3'
  const codec = isM4B || isMP4 ? 'aac' : 'libmp3lame'

  try {
    // Write input WAV file
    const wavData = new Uint8Array(await wavBlob.arrayBuffer())
    console.log(`[audioConcat] Writing input WAV: ${wavData.length} bytes`)
    await ffWriteFile(ffmpeg, 'input.wav', wavData)

    // Build FFmpeg command
    // Order matters: inputs first, then output options, then output file
    const args: string[] = ['-i', 'input.wav']

    // Add metadata input if available (for chapters)
    if ((isM4B || isMP4) && chapters.length > 0) {
      const metadata = createFFmpegMetadata(chapters, audioBuffer.duration)
      await ffWriteFile(ffmpeg, 'metadata.txt', new TextEncoder().encode(metadata))
      // Note: second input (index 1) contains metadata
      args.push('-i', 'metadata.txt', '-map_metadata', '1')
    }

    // Output options
    args.push('-c:a', codec, '-b:a', `${bitrate}k`)

    // Add metadata tags
    if (options.bookTitle) args.push('-metadata', `title=${options.bookTitle}`)
    if (options.bookAuthor) args.push('-metadata', `artist=${options.bookAuthor}`)

    // Overwrite output file
    args.push('-y', outputFile)

    console.log(`[audioConcat] Running FFmpeg with args:`, args)

    // Execute FFmpeg
    await ffRun(ffmpeg, args)

    console.log(`[audioConcat] Reading output file: ${outputFile}`)

    // Read output file
    const data = await ffReadFile(ffmpeg, outputFile)
    console.log(`[audioConcat] Output file size: ${data.length} bytes`)

    if (data.length === 0) {
      throw new Error('FFmpeg produced an empty output file')
    }

    const mimeType = isM4B ? 'audio/m4b' : isMP4 ? 'audio/mp4' : 'audio/mpeg'
    return new Blob([new Uint8Array(data)], { type: mimeType })
  } catch (err) {
    throw new Error(`Failed to convert audio buffer to ${options.format || 'mp3'}: ${String(err)}`)
  } finally {
    // Best-effort cleanup
    try {
      await ffDeleteFile(ffmpeg, 'input.wav')
      await ffDeleteFile(ffmpeg, outputFile)
      if ((isM4B || isMP4) && chapters.length > 0) await ffDeleteFile(ffmpeg, 'metadata.txt')
    } catch {
      // swallow cleanup errors
    }
  }
}

/**
 * Lightweight WAV-only concatenation that does not require WebAudio or FFmpeg.
 * This supports only PCM WAV files with identical sampleRate, channels, and bitDepth.
 */
/**
 * Lightweight WAV-only concatenation that does not require WebAudio or FFmpeg.
 * This supports only PCM/Float WAV files with identical sampleRate, channels, and bitDepth.
 * Optimized to use Blob composition to avoid large memory allocations.
 */
async function concatWavBlobs(chapters: AudioChapter[]): Promise<Blob> {
  if (!chapters || chapters.length === 0) throw new Error('No chapters')

  const parts: BlobPart[] = []
  let totalDataLength = 0

  // Helper to parse WAV header from a blob
  async function parseWavHeader(blob: Blob) {
    // Read first 1024 bytes to be safe (headers are usually small)
    const headerData = new Uint8Array(await blob.slice(0, 1024).arrayBuffer())
    const view = new DataView(headerData.buffer)

    if (String.fromCharCode(...headerData.slice(0, 4)) !== 'RIFF')
      throw new Error('Not a RIFF WAV file')
    if (String.fromCharCode(...headerData.slice(8, 12)) !== 'WAVE')
      throw new Error('Not a WAVE file')

    let offset = 12
    let fmt: any = null
    let dataOffset = -1
    let dataLength = 0

    while (offset < headerData.length) {
      const chunkId = String.fromCharCode(...headerData.slice(offset, offset + 4))
      const chunkSize = view.getUint32(offset + 4, true)

      if (chunkId === 'fmt ') {
        fmt = {
          audioFormat: view.getUint16(offset + 8, true),
          numChannels: view.getUint16(offset + 10, true),
          sampleRate: view.getUint32(offset + 12, true),
          byteRate: view.getUint32(offset + 16, true),
          blockAlign: view.getUint16(offset + 20, true),
          bitsPerSample: view.getUint16(offset + 22, true),
        }
      } else if (chunkId === 'data') {
        dataOffset = offset + 8
        dataLength = chunkSize
        break
      }

      offset += 8 + chunkSize
    }

    if (!fmt || dataOffset === -1) throw new Error('Invalid WAV: missing fmt or data chunk')

    return { fmt, dataOffset, dataLength }
  }

  // Parse first chapter to establish format
  const firstInfo = await parseWavHeader(chapters[0].blob)

  // Add first chapter's data
  parts.push(
    chapters[0].blob.slice(firstInfo.dataOffset, firstInfo.dataOffset + firstInfo.dataLength)
  )
  totalDataLength += firstInfo.dataLength

  // Process remaining chapters
  for (let i = 1; i < chapters.length; i++) {
    const info = await parseWavHeader(chapters[i].blob)

    // Validate format compatibility
    if (
      info.fmt.audioFormat !== firstInfo.fmt.audioFormat ||
      info.fmt.numChannels !== firstInfo.fmt.numChannels ||
      info.fmt.sampleRate !== firstInfo.fmt.sampleRate ||
      info.fmt.bitsPerSample !== firstInfo.fmt.bitsPerSample
    ) {
      throw new Error(
        `Chapter ${i + 1} format mismatch (SR: ${info.fmt.sampleRate} vs ${firstInfo.fmt.sampleRate}, CH: ${info.fmt.numChannels} vs ${firstInfo.fmt.numChannels})`
      )
    }

    parts.push(chapters[i].blob.slice(info.dataOffset, info.dataOffset + info.dataLength))
    totalDataLength += info.dataLength
  }

  // Create new header
  const headerBuffer = new ArrayBuffer(44)
  const headerView = new DataView(headerBuffer)

  writeString(headerView, 0, 'RIFF')
  headerView.setUint32(4, 36 + totalDataLength, true)
  writeString(headerView, 8, 'WAVE')
  writeString(headerView, 12, 'fmt ')
  headerView.setUint32(16, 16, true)
  headerView.setUint16(20, firstInfo.fmt.audioFormat, true)
  headerView.setUint16(22, firstInfo.fmt.numChannels, true)
  headerView.setUint32(24, firstInfo.fmt.sampleRate, true)
  headerView.setUint32(28, firstInfo.fmt.byteRate, true)
  headerView.setUint16(32, firstInfo.fmt.blockAlign, true)
  headerView.setUint16(34, firstInfo.fmt.bitsPerSample, true)
  writeString(headerView, 36, 'data')
  headerView.setUint32(40, totalDataLength, true)

  // Prepend header to parts
  parts.unshift(headerBuffer)

  return new Blob(parts, { type: 'audio/wav' })
}

/**
 * FFmpeg-based concatenation fallback for environments without Web Audio
 * (e.g. Web Workers, headless). This writes each chapter blob into FFmpeg's
 * virtual filesystem, normalizes each file to a WAV with matching sample rate
 * and channels, concatenates using the concat demuxer or filter, and then
 * encodes to the requested format.
 */
async function ffmpegConcatenateBlobs(
  chapters: AudioChapter[],
  format: AudioFormat,
  bitrate: number,
  options: ConcatenationOptions,
  onProgress?: (progress: ConcatenationProgress) => void
): Promise<Blob> {
  const ffmpeg = await getFFmpeg()

  onProgress?.({
    current: 0,
    total: chapters.length,
    status: 'loading',
    message: 'Loading audio via FFmpeg...',
  })

  const tmpFiles: string[] = []
  let concatList = ''

  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i]
    // Use .wav extension as we expect WAV inputs from TTS
    const filename = `input_${i}.wav`
    const data = new Uint8Array(await c.blob.arrayBuffer())

    if (data.length === 0) {
      console.warn(
        `[audioConcat] Chapter ${i + 1} "${c.title}" has empty audio blob. Generating 1s silence for FFmpeg.`
      )
      // Create a silent WAV file
      const silenceBlob = createSilentWav(1)
      const silenceData = new Uint8Array(await silenceBlob.arrayBuffer())
      await ffWriteFile(ffmpeg, filename, silenceData)
    } else {
      await ffWriteFile(ffmpeg, filename, data)
    }

    tmpFiles.push(filename)
    concatList += `file '${filename}'\n`

    onProgress?.({
      current: i + 1,
      total: chapters.length,
      status: 'decoding', // technically just writing to FS
      message: `Prepared ${c.title}`,
    })
  }

  // Write list file for concat demuxer
  await ffWriteFile(ffmpeg, 'list.txt', new TextEncoder().encode(concatList))

  onProgress?.({
    current: 0,
    total: 1,
    status: 'concatenating',
    message: 'Concatenating and encoding...',
  })

  // Determine output filename and args
  const isM4B = format === 'm4b'
  const isMP4 = format === 'mp4'
  const ext = isM4B ? 'm4b' : isMP4 ? 'mp4' : format === 'mp3' ? 'mp3' : 'wav'
  const outFile = `output.${ext}`

  // Use concat demuxer
  const args = ['-f', 'concat', '-safe', '0', '-i', 'list.txt']

  // Add metadata input if available (for chapters)
  if ((isM4B || isMP4) && chapters.length > 0) {
    // Calculate total duration roughly
    const totalDuration = chapters.reduce((sum, c) => sum + (c.duration || 0), 0)
    const metadata = createFFmpegMetadata(chapters, totalDuration)
    await ffWriteFile(ffmpeg, 'metadata.txt', new TextEncoder().encode(metadata))
    args.push('-i', 'metadata.txt', '-map_metadata', '1')
  }

  // Encoding options
  // Note: concat demuxer just streams packets. If we want to encode to MP3/AAC, we specify codecs.
  if (format === 'mp3') {
    args.push('-c:a', 'libmp3lame', '-b:a', `${bitrate}k`)
  } else if (isM4B || isMP4) {
    args.push('-c:a', 'aac', '-b:a', `${bitrate}k`)
  } else {
    // WAV: copy if inputs are WAV, or re-encode to PCM
    // -c:a copy works if inputs are same format.
    // But to be safe against minor differences, let's use pcm_s16le
    args.push('-c:a', 'pcm_s16le')
  }

  // Metadata tags
  if (options.bookTitle) args.push('-metadata', `title=${options.bookTitle}`)
  if (options.bookAuthor) args.push('-metadata', `artist=${options.bookAuthor}`)

  args.push('-y', outFile)

  console.log('[audioConcat] Running FFmpeg concat:', args)
  await ffRun(ffmpeg, args)

  // Read output
  const data = await ffReadFile(ffmpeg, outFile)
  const mime =
    format === 'wav'
      ? 'audio/wav'
      : format === 'mp3'
        ? 'audio/mpeg'
        : isM4B
          ? 'audio/m4b'
          : 'audio/mp4'

  // Cleanup temporary files
  try {
    for (const f of tmpFiles) await ffDeleteFile(ffmpeg, f)
    await ffDeleteFile(ffmpeg, 'list.txt')
    await ffDeleteFile(ffmpeg, 'metadata.txt')
    await ffDeleteFile(ffmpeg, outFile)
  } catch {
    // best effort
  }

  onProgress?.({
    current: 1,
    total: 1,
    status: 'complete',
    message: 'FFmpeg concatenation complete',
  })

  return new Blob([new Uint8Array(data)], { type: mime })
}

function inferExtensionFromMime(mime: string): string {
  if (!mime) return 'bin'
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3'
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('m4a') || mime.includes('m4b')) return 'm4a'
  return 'bin'
}

/**
 * Create FFmpeg metadata file for chapters
 */
function createFFmpegMetadata(chapters: AudioChapter[], totalDuration: number): string {
  let metadata = ';FFMETADATA1\n'
  let currentTime = 0

  for (let i = 0; i < chapters.length; i++) {
    const duration = chapters[i].duration || totalDuration / chapters.length
    const startMs = Math.floor(currentTime * 1000)
    const endMs = Math.floor((currentTime + duration) * 1000)

    metadata += '\n[CHAPTER]\n'
    metadata += 'TIMEBASE=1/1000\n'
    metadata += `START=${startMs}\n`
    metadata += `END=${endMs}\n`
    metadata += `title=${chapters[i].title}\n`

    currentTime += duration
  }

  return metadata
}

/**
 * Convert AudioBuffer to WAV blob
 */
function audioBufferToWav(audioBuffer: AudioBuffer): Blob {
  const numberOfChannels = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const format = 1 // PCM
  const bitDepth = 16

  const bytesPerSample = bitDepth / 8
  const blockAlign = numberOfChannels * bytesPerSample

  const data = interleave(audioBuffer)
  const dataLength = data.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  // Write WAV header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, format, true)
  view.setUint16(22, numberOfChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataLength, true)

  // Write audio data
  floatTo16BitPCM(view, 44, data)

  return new Blob([buffer], { type: 'audio/wav' })
}

/**
 * Interleave channels from AudioBuffer
 */
function interleave(audioBuffer: AudioBuffer): Float32Array {
  const numberOfChannels = audioBuffer.numberOfChannels
  const length = audioBuffer.length * numberOfChannels
  const result = new Float32Array(length)

  let offset = 0
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      result[offset++] = audioBuffer.getChannelData(channel)[i]
    }
  }

  return result
}

/**
 * Write string to DataView
 */
function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

/**
 * Convert float samples to 16-bit PCM
 */
function floatTo16BitPCM(view: DataView, offset: number, input: Float32Array): void {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
}

/**
 * Create chapter markers metadata (for future M4B/MP3 support)
 */
export function createChapterMarkers(
  chapters: AudioChapter[],
  audioBuffers: AudioBuffer[]
): string {
  let currentTime = 0
  const markers: string[] = []

  for (let i = 0; i < chapters.length; i++) {
    const duration = audioBuffers[i].duration
    const startTime = formatTimestamp(currentTime)

    markers.push(`CHAPTER${String(i + 1).padStart(2, '0')}=${startTime}`)
    markers.push(`CHAPTER${String(i + 1).padStart(2, '0')}NAME=${chapters[i].title}`)

    currentTime += duration
  }

  return markers.join('\n')
}

/**
 * Format timestamp for chapter markers (HH:MM:SS.mmm)
 */
function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 1000)

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

/**
 * Convert WAV blob to MP3 blob using FFmpeg
 * @param wavBlob - WAV audio blob
 * @param bitrate - MP3 bitrate (default: 192 kbps)
 * @returns MP3 blob
 */
export async function convertWavToMp3(wavBlob: Blob, bitrate: number = 192): Promise<Blob> {
  const ffmpeg = await getFFmpeg()
  const outFile = 'output.mp3'

  try {
    // Write input WAV file
    const wavData = new Uint8Array(await wavBlob.arrayBuffer())
    console.log(`[convertWavToMp3] Writing input WAV: ${wavData.length} bytes`)
    await ffWriteFile(ffmpeg, 'input.wav', wavData)

    // Convert to MP3 with -y flag to overwrite
    await ffRun(ffmpeg, [
      '-i',
      'input.wav',
      '-c:a',
      'libmp3lame',
      '-b:a',
      `${bitrate}k`,
      '-y',
      outFile,
    ])

    console.log('[convertWavToMp3] Conversion complete, attempting to read output file')

    // Try to list files to debug
    try {
      const asWithList = ffmpeg as any
      if (typeof asWithList.listDir === 'function') {
        const files = await asWithList.listDir('/')
        console.log('[convertWavToMp3] Files in FFmpeg FS:', files)
      } else if (typeof asWithList.FS === 'function') {
        try {
          const files = asWithList.FS('readdir', '/')
          console.log('[convertWavToMp3] Files in FFmpeg FS (via FS):', files)
        } catch {
          // Ignore listing errors
        }
      }
    } catch (err) {
      console.warn('[convertWavToMp3] Could not list FFmpeg filesystem:', err)
    }

    // Read output file
    const data = await ffReadFile(ffmpeg, outFile)
    console.log(`[convertWavToMp3] Output file size: ${data?.length || 0} bytes`)

    if (!data || data.length === 0) {
      throw new Error('FFmpeg produced an empty MP3 file')
    }

    const mp3Blob = new Blob([new Uint8Array(data)], { type: 'audio/mpeg' })

    return mp3Blob
  } catch (err) {
    throw new Error(`Failed to convert WAV to MP3: ${String(err)}`)
  } finally {
    try {
      await ffDeleteFile(ffmpeg, 'input.wav')
      await ffDeleteFile(ffmpeg, outFile)
    } catch {
      // ignore
    }
  }
}

/**
 * Download blob as file
 */
export function downloadAudioFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Get audio duration from blob
 */
export function getAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio()
    audio.addEventListener('loadedmetadata', () => {
      resolve(audio.duration)
    })
    audio.addEventListener('error', () => {
      reject(new Error('Failed to load audio metadata'))
    })
    audio.src = URL.createObjectURL(blob)
  })
}

/**
 * Create a silent WAV blob of specified duration
 */
export function createSilentWav(durationSeconds: number = 1, sampleRate: number = 44100): Blob {
  const numChannels = 1
  const bitDepth = 16
  const bytesPerSample = bitDepth / 8
  const totalSamples = sampleRate * durationSeconds
  const dataLength = totalSamples * numChannels * bytesPerSample

  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true)
  view.setUint16(32, numChannels * bytesPerSample, true)
  view.setUint16(34, bitDepth, true)
  writeStr(36, 'data')
  view.setUint32(40, dataLength, true)

  // Data is already 0 (silence) in new ArrayBuffer

  return new Blob([buffer], { type: 'audio/wav' })
}
