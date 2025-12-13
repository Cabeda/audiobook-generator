/**
 * Shared audio-related constants for TTS generation
 */

// Minimum text length for TTS generation (characters)
export const MIN_TEXT_LENGTH = 3

// WAV file header size in bytes (RIFF + fmt + data chunks)
export const WAV_HEADER_SIZE = 44

/**
 * Create a minimal valid silent WAV file (44-byte header with no audio data)
 * This is a properly formatted WAV file that can be played without errors.
 *
 * Format: 16-bit PCM, mono, 16000 Hz sample rate, 0 samples (silent)
 */
export function createSilentWav(): Blob {
  const buffer = new ArrayBuffer(WAV_HEADER_SIZE)
  const view = new DataView(buffer)

  // RIFF header
  view.setUint32(0, 0x52494646, false) // 'RIFF'
  view.setUint32(4, 36, true) // File size - 8 (no audio data, just headers)
  view.setUint32(8, 0x57415645, false) // 'WAVE'

  // fmt chunk
  view.setUint32(12, 0x666d7420, false) // 'fmt '
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // audio format = PCM
  view.setUint16(22, 1, true) // channels = mono
  view.setUint32(24, 16000, true) // sample rate = 16000 Hz
  view.setUint32(28, 32000, true) // byte rate = sample rate * channels * bytes per sample
  view.setUint16(32, 2, true) // block align = channels * bytes per sample
  view.setUint16(34, 16, true) // bits per sample = 16

  // data chunk
  view.setUint32(36, 0x64617461, false) // 'data'
  view.setUint32(40, 0, true) // data size = 0 (no audio data)

  return new Blob([view], { type: 'audio/wav' })
}
