// Deprecated: in-browser TTS removed. Use Edge/Kokoro TTS clients instead.
// This file has been intentionally left empty and will be removed in a future cleanup.
export {}

/**
 * Get available voices from the browser
 * Note: Voice list might not be immediately available on page load
 */
export function getAvailableVoices(): SpeechSynthesisVoice[] {
  if (!('speechSynthesis' in window)) {
    console.warn('In-browser speech synthesis not supported in this browser')
    return []
  }
  return window.speechSynthesis.getVoices()
}

/**
 * Wait for voices to be loaded (some browsers load them asynchronously)
 */
export function waitForVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const voices = getAvailableVoices()
    if (voices.length > 0) {
      resolve(voices)
      return
    }

    // Wait for voiceschanged event
    const handler = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', handler)
      resolve(getAvailableVoices())
    }
    window.speechSynthesis.addEventListener('voiceschanged', handler)

    // Timeout after 5 seconds
    setTimeout(() => {
      window.speechSynthesis.removeEventListener('voiceschanged', handler)
      resolve(getAvailableVoices())
    }, 5000)
  })
}

/**
 * Find a voice by URI or name
 */
export function findVoice(voiceId?: string): SpeechSynthesisVoice | null {
  if (!voiceId) return null
  const voices = getAvailableVoices()
  return voices.find((v) => v.voiceURI === voiceId || v.name === voiceId) || null
}

/**
 * Get the default voice for the browser
 */
export function getDefaultVoice(): SpeechSynthesisVoice | null {
  const voices = getAvailableVoices()
  return voices.find((v) => v.default) || voices[0] || null
}

/**
 * Split text into chunks for browser-based speech synthesis
 * Browser speech synthesis may have limitations on text length and can be more stable with smaller chunks
 */
export function splitTextIntoChunks(text: string, maxChunkSize: number = 200): string[] {
  const chunks: string[] = []

  // Split by sentences
  const sentences: string[] = text.match(/[^.!?]+[.!?]+/g) || []

  if (sentences.length === 0) {
    // No sentence-ending punctuation, split by other delimiters
    const parts = text.split(/[,;\n]+/).filter((p) => p.trim())
    if (parts.length > 1) {
      sentences.push(...parts.map((p) => p.trim()))
    } else {
      // Last resort: split by words
      if (text.length > maxChunkSize) {
        const words = text.split(/\s+/)
        let wordChunk = ''
        for (const word of words) {
          if ((wordChunk + ' ' + word).length > maxChunkSize) {
            if (wordChunk) chunks.push(wordChunk.trim())
            wordChunk = word
          } else {
            wordChunk += (wordChunk ? ' ' : '') + word
          }
        }
        if (wordChunk) chunks.push(wordChunk.trim())
        return chunks
      } else {
        return [text]
      }
    }
  }

  // Combine sentences into chunks
  let currentChunk = ''
  for (const sentence of sentences) {
    const trimmed = sentence.trim()
    if (!trimmed) continue

    if ((currentChunk + ' ' + trimmed).length > maxChunkSize) {
      if (currentChunk) chunks.push(currentChunk.trim())
      currentChunk = trimmed
    } else {
      currentChunk += (currentChunk ? ' ' : '') + trimmed
    }
  }

  if (currentChunk) chunks.push(currentChunk.trim())
  return chunks.length > 0 ? chunks : [text]
}

/**
 * Convert text to speech using browser speech synthesis and return as WAV Blob
 * @param params - Generation parameters
 * @param onChunkProgress - Optional callback for chunk progress (current, total)
 */
export async function generateVoice(
  params: GenerateParams,
  onChunkProgress?: (current: number, total: number) => void
): Promise<Blob> {
  if (!('speechSynthesis' in window)) {
    throw new Error('In-browser speech synthesis is not supported in this browser')
  }

  const { text, voice: voiceId, speed = 1.0, pitch = 1.0 } = params

  // Ensure voices are loaded
  await waitForVoices()

  // Find the requested voice or use default
  const voice = voiceId ? findVoice(voiceId) : getDefaultVoice()

  // Split text into manageable chunks
  const chunks = splitTextIntoChunks(text)
  const audioChunks: Blob[] = []

  // Process each chunk
  for (let i = 0; i < chunks.length; i++) {
    if (onChunkProgress) {
      onChunkProgress(i + 1, chunks.length)
    }

    const chunk = chunks[i]
    const audioBlob = await synthesizeChunk(chunk, voice, speed, pitch)
    audioChunks.push(audioBlob)
  }

  // Combine all audio chunks into a single blob
  if (audioChunks.length === 1) {
    return audioChunks[0]
  }

  // For multiple chunks, we need to properly concatenate them
  // Import concatenation utility to properly merge WAV files
  const { concatenateAudioChapters } = await import('../audioConcat.ts')
  const audioChapters = audioChunks.map((blob, i) => ({
    id: `chunk-${i}`,
    title: `Chunk ${i + 1}`,
    blob,
  }))

  console.log(`Concatenating ${audioChunks.length} audio chunks...`)
  return await concatenateAudioChapters(audioChapters, { format: 'wav' })
}

/**
 * Synthesize a single text chunk to audio
 */
function synthesizeChunk(
  text: string,
  voice: SpeechSynthesisVoice | null,
  speed: number,
  pitch: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text)

    if (voice) {
      utterance.voice = voice
    }
    utterance.rate = speed
    utterance.pitch = pitch

    // Capture audio using Web Audio API
    const audioContext = new AudioContext({ sampleRate: 22050 })
    const destination = audioContext.createMediaStreamDestination()
    const mediaRecorder = new MediaRecorder(destination.stream, {
      mimeType: 'audio/webm;codecs=opus',
    })

    const audioChunks: BlobPart[] = []

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data)
      }
    }

    mediaRecorder.onstop = async () => {
      try {
        // Create a blob from recorded chunks
        const webmBlob = new Blob(audioChunks, { type: 'audio/webm' })

        // Convert to WAV format for consistency with Kokoro
        const wavBlob = await convertWebMToWav(webmBlob, audioContext.sampleRate)
        audioContext.close()
        resolve(wavBlob)
      } catch (err) {
        audioContext.close()
        reject(err)
      }
    }

    utterance.onend = () => {
      // Stop recording after speech ends
      setTimeout(() => {
        mediaRecorder.stop()
      }, 100) // Small delay to ensure all audio is captured
    }

    utterance.onerror = (event) => {
      mediaRecorder.stop()
      audioContext.close()
      reject(new Error(`Speech synthesis error: ${event.error}`))
    }

    // Start recording and speaking
    mediaRecorder.start()
    window.speechSynthesis.speak(utterance)
  })
}

/**
 * Convert WebM audio to WAV format
 */
async function convertWebMToWav(webmBlob: Blob, sampleRate: number): Promise<Blob> {
  const audioContext = new AudioContext({ sampleRate })
  const arrayBuffer = await webmBlob.arrayBuffer()
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

  // Extract PCM data
  const pcmData = audioBuffer.getChannelData(0)

  // Encode as WAV
  const wavBlob = encodeWAV(pcmData, audioBuffer.sampleRate)
  audioContext.close()
  return wavBlob
}

/**
 * Encode PCM data as WAV format
 */
function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  function writeString(view: DataView, offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  // WAV header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // PCM format
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // Mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)

  // PCM data
  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

/**
 * List available voices with metadata
 */
export function listVoices(): Array<{ id: string; name: string; lang: string; default: boolean }> {
  const voices = getAvailableVoices()
  return voices.map((v) => ({
    id: v.voiceURI,
    name: v.name,
    lang: v.lang,
    default: v.default,
  }))
}
