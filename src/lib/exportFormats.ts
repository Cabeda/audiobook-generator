export type ExportFormat = 'mp3' | 'm4b' | 'epub' | 'mp4' | 'wav'

export const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'mp3', label: 'MP3' },
  { value: 'm4b', label: 'M4B Audiobook' },
  { value: 'epub', label: 'EPUB' },
  { value: 'mp4', label: 'MP4' },
  { value: 'wav', label: 'WAV' },
]
