/**
 * WAV file parsing utilities.
 *
 * Pure functions for reading WAV blob headers and computing accurate durations.
 * Extracted from generationService to keep audio-format concerns separate.
 */

/**
 * Read a Blob (or a slice of it) as a Uint8Array.
 * Works in both browser and jsdom test environments where
 * Blob.arrayBuffer() or Blob.slice().arrayBuffer() may be missing.
 */
export async function readBlobAsUint8Array(blob: Blob, maxBytes?: number): Promise<Uint8Array> {
  const target = maxBytes != null && maxBytes < blob.size ? blob.slice(0, maxBytes) : blob

  // Try the modern API first
  if (typeof target.arrayBuffer === 'function') {
    try {
      return new Uint8Array(await target.arrayBuffer())
    } catch {
      // fall through
    }
  }

  // Fallback: FileReader (works in jsdom)
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result))
      } else {
        reject(new Error('FileReader did not return ArrayBuffer'))
      }
    }
    reader.onerror = () => reject(reader.error || new Error('FileReader error'))
    reader.readAsArrayBuffer(target)
  })
}

/**
 * Parse a WAV blob header and return the accurate duration in seconds.
 * Handles arbitrary chunk layouts (extra LIST/fact/etc. chunks before data).
 *
 * This replaces the old hardcoded `(blob.size - 44) / (24000 * 4)` estimate
 * which assumed 24 kHz float32 mono and caused highlight-audio desync when
 * the actual format differed (e.g. 16-bit PCM, different sample rates).
 */
export async function parseWavDuration(blob: Blob): Promise<number> {
  const headerBytes = await readBlobAsUint8Array(blob, 1024)
  const view = new DataView(headerBytes.buffer)

  // Validate RIFF/WAVE
  const riff = String.fromCharCode(...headerBytes.slice(0, 4))
  const wave = String.fromCharCode(...headerBytes.slice(8, 12))
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    // Not a valid WAV — fall back to blob-size estimate (24kHz 16-bit mono)
    const fallback = (blob.size - 44) / (24000 * 2)
    return fallback > 0 ? fallback : 0
  }

  let offset = 12
  let sampleRate = 24000
  let numChannels = 1
  let bitsPerSample = 16
  let dataLength = -1

  while (offset + 8 <= headerBytes.length) {
    const chunkId = String.fromCharCode(...headerBytes.slice(offset, offset + 4))
    const chunkSize = view.getUint32(offset + 4, true)

    if (chunkId === 'fmt ') {
      numChannels = view.getUint16(offset + 10, true)
      sampleRate = view.getUint32(offset + 12, true)
      bitsPerSample = view.getUint16(offset + 22, true)
    } else if (chunkId === 'data') {
      dataLength = chunkSize
      break
    }

    offset += 8 + chunkSize
  }

  if (dataLength <= 0) {
    // Could not find data chunk — fall back using parsed fmt values
    const fallback = (blob.size - 44) / (sampleRate * (bitsPerSample / 8) * numChannels)
    return fallback > 0 ? fallback : 0
  }

  const bytesPerSec = sampleRate * (bitsPerSample / 8) * numChannels
  return bytesPerSec > 0 ? dataLength / bytesPerSec : 0
}
