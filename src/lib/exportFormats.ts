/**
 * Export formats.
 *
 * The single place that knows which formats exist and how each one is named
 * on disk. Callers pick a format; the export module decides the rest.
 */

/** Audio containers the app can write. */
export type AudioExportFormat = 'mp3' | 'm4b' | 'mp4' | 'wav'

/** Everything the export button can produce. EPUB is a book, not audio. */
export type ExportFormat = AudioExportFormat | 'epub'

export const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'mp3', label: 'MP3' },
  { value: 'm4b', label: 'M4B Audiobook' },
  { value: 'epub', label: 'EPUB' },
  { value: 'mp4', label: 'MP4' },
  { value: 'wav', label: 'WAV' },
]

/** File extension for a format. */
export function exportFileExtension(format: ExportFormat): string {
  return format
}

/** MIME type for an audio format. */
export function exportMimeType(format: AudioExportFormat): string {
  switch (format) {
    case 'mp3':
      return 'audio/mpeg'
    case 'm4b':
      return 'audio/m4b'
    case 'mp4':
      return 'audio/mp4'
    case 'wav':
    default:
      return 'audio/wav'
  }
}

/** Narrow an export format to the audio formats. */
export function isAudioExportFormat(format: ExportFormat): format is AudioExportFormat {
  return format !== 'epub'
}
