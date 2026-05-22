/**
 * Parse the duration of an MP3 blob by counting frames.
 * Returns duration in seconds, or 0 if parsing fails.
 */
export async function parseMp3Duration(blob: Blob): Promise<number> {
  try {
    const buffer = new Uint8Array(await blob.arrayBuffer())
    const SAMPLES_PER_FRAME_L3 = 1152 // MPEG1 Layer 3
    const SAMPLES_PER_FRAME_L3_V2 = 576 // MPEG2/2.5 Layer 3

    let totalSamples = 0
    let sampleRate = 0
    let i = 0

    // Skip ID3v2 tag if present
    if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
      const size =
        ((buffer[6] & 0x7f) << 21) |
        ((buffer[7] & 0x7f) << 14) |
        ((buffer[8] & 0x7f) << 7) |
        (buffer[9] & 0x7f)
      i = 10 + size
    }

    const sampleRatesTable = [
      [44100, 48000, 32000], // MPEG1
      [22050, 24000, 16000], // MPEG2
      [11025, 12000, 8000], // MPEG2.5
    ]
    const bitratesV1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
    const bitratesV2L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]

    while (i < buffer.length - 4) {
      // Find frame sync
      if (buffer[i] !== 0xff || (buffer[i + 1] & 0xe0) !== 0xe0) {
        i++
        continue
      }

      const b1 = buffer[i + 1]
      const b2 = buffer[i + 2]

      const versionBits = (b1 >> 3) & 0x03
      const layerBits = (b1 >> 1) & 0x03
      const bitrateIndex = (b2 >> 4) & 0x0f
      const sampleRateIndex = (b2 >> 2) & 0x03
      const padding = (b2 >> 1) & 0x01

      // Validate: layer must be Layer 3 (01), version must be valid
      if (
        layerBits !== 0x01 ||
        versionBits === 0x01 ||
        sampleRateIndex === 3 ||
        bitrateIndex === 0 ||
        bitrateIndex === 15
      ) {
        i++
        continue
      }

      const versionIndex = versionBits === 3 ? 0 : versionBits === 2 ? 1 : 2
      const isV1 = versionIndex === 0

      const sr = sampleRatesTable[versionIndex][sampleRateIndex]
      const bitrate = (isV1 ? bitratesV1L3[bitrateIndex] : bitratesV2L3[bitrateIndex]) * 1000
      const samplesPerFrame = isV1 ? SAMPLES_PER_FRAME_L3 : SAMPLES_PER_FRAME_L3_V2

      if (!sampleRate) sampleRate = sr

      // Calculate frame size and advance
      const frameSize = isV1
        ? Math.floor((144 * bitrate) / sr) + padding
        : Math.floor((72 * bitrate) / sr) + padding

      if (frameSize < 1) {
        i++
        continue
      }

      totalSamples += samplesPerFrame
      i += frameSize
    }

    return sampleRate > 0 ? totalSamples / sampleRate : 0
  } catch {
    return 0
  }
}
