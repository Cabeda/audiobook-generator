/**
 * Inject Nero-style chapter markers (chpl atom) into an M4B/MP4 file.
 *
 * The chpl atom is placed inside a udta atom within the moov atom.
 * Format:
 *   - 4 bytes: atom size (big-endian)
 *   - 4 bytes: 'chpl'
 *   - 1 byte: version (0)
 *   - 3 bytes: flags (0)
 *   - 4 bytes: reserved (0)
 *   - 1 byte: chapter count
 *   - For each chapter:
 *     - 8 bytes: start time in 100ns units (big-endian int64)
 *     - 1 byte: title length
 *     - N bytes: title (UTF-8)
 */

import logger from './utils/logger'

export interface ChapterMarker {
  title: string
  startTimeMs: number
}

/**
 * Inject chapter markers into an M4B blob.
 * Returns a new Blob with the chpl atom added inside moov/udta.
 */
export async function injectChapterMarkers(
  m4bBlob: Blob,
  chapters: ChapterMarker[]
): Promise<Blob> {
  if (chapters.length === 0) return m4bBlob

  const buffer = await m4bBlob.arrayBuffer()
  const data = new Uint8Array(buffer)

  // Find moov atom
  const moovOffset = findAtom(data, 'moov', 0)
  if (moovOffset === -1) {
    logger.warn('[chpl] No moov atom found, returning without chapter markers')
    return m4bBlob
  }

  const moovSize = readUint32(data, moovOffset)
  const moovEnd = moovOffset + moovSize

  // Build the chpl atom
  const chplData = buildChplAtom(chapters)

  // Build udta atom wrapping chpl
  const udtaSize = 8 + chplData.byteLength
  const udtaAtom = new Uint8Array(udtaSize)
  const udtaView = new DataView(udtaAtom.buffer)
  udtaView.setUint32(0, udtaSize)
  udtaAtom.set(new TextEncoder().encode('udta'), 4)
  udtaAtom.set(chplData, 8)

  // Insert udta at end of moov (before moov's end)
  // We need to expand moov's size by udtaSize
  const before = data.slice(0, moovEnd)
  const after = data.slice(moovEnd)

  // Update moov size
  const newMoovSize = moovSize + udtaSize
  const result = new Uint8Array(before.length + udtaSize + after.length)
  result.set(before, 0)
  result.set(udtaAtom, moovEnd)
  result.set(after, moovEnd + udtaSize)

  // Patch moov size in place
  const resultView = new DataView(result.buffer)
  resultView.setUint32(moovOffset, newMoovSize)

  logger.info(`[chpl] Injected ${chapters.length} chapter markers into M4B`)
  return new Blob([result], { type: 'audio/m4b' })
}

function buildChplAtom(chapters: ChapterMarker[]): Uint8Array {
  // Calculate size
  let titlesSize = 0
  const encoder = new TextEncoder()
  const encodedTitles = chapters.map((ch) => {
    const title = encoder.encode(ch.title.slice(0, 255))
    titlesSize += 8 + 1 + title.byteLength // timestamp + titleLen + title
    return title
  })

  const atomSize = 8 + 4 + 4 + 1 + titlesSize // header + version+flags + reserved + count + entries
  const buf = new Uint8Array(atomSize)
  const view = new DataView(buf.buffer)

  // Atom header
  view.setUint32(0, atomSize)
  buf.set(encoder.encode('chpl'), 4)

  // Version (1 byte) + flags (3 bytes)
  view.setUint32(8, 0)
  // Reserved
  view.setUint32(12, 0)
  // Chapter count
  buf[16] = chapters.length

  let offset = 17
  for (let i = 0; i < chapters.length; i++) {
    // Start time in 100ns units (ms * 10000)
    const time100ns = BigInt(chapters[i].startTimeMs) * 10000n
    view.setBigUint64(offset, time100ns)
    offset += 8
    // Title length + title
    buf[offset] = encodedTitles[i].byteLength
    offset += 1
    buf.set(encodedTitles[i], offset)
    offset += encodedTitles[i].byteLength
  }

  return buf
}

function findAtom(data: Uint8Array, name: string, start: number): number {
  const nameBytes = new TextEncoder().encode(name)
  let offset = start
  while (offset + 8 <= data.length) {
    const size = readUint32(data, offset)
    if (size < 8) break // Invalid atom
    if (
      data[offset + 4] === nameBytes[0] &&
      data[offset + 5] === nameBytes[1] &&
      data[offset + 6] === nameBytes[2] &&
      data[offset + 7] === nameBytes[3]
    ) {
      return offset
    }
    offset += size
  }
  return -1
}

function readUint32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3]) >>>
    0
  )
}
