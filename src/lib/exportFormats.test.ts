import { describe, it, expect } from 'vitest'
import { EXPORT_FORMATS, exportMimeType, isAudioExportFormat } from './exportFormats'

describe('export formats', () => {
  it('offers every format the export button can produce', () => {
    expect(EXPORT_FORMATS.map((f) => f.value)).toEqual(['mp3', 'm4b', 'epub', 'mp4', 'wav'])
  })

  it('gives each audio format its own MIME type', () => {
    expect(exportMimeType('mp3')).toBe('audio/mpeg')
    expect(exportMimeType('m4b')).toBe('audio/m4b')
    expect(exportMimeType('mp4')).toBe('audio/mp4')
    expect(exportMimeType('wav')).toBe('audio/wav')
  })

  it('treats epub as the only non-audio format', () => {
    expect(isAudioExportFormat('epub')).toBe(false)
    expect(isAudioExportFormat('mp4')).toBe(true)
    expect(isAudioExportFormat('wav')).toBe(true)
  })
})
