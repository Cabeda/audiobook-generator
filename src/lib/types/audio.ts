export interface AudioSegment {
  id: string
  chapterId: string
  index: number
  text: string
  audioBlob: Blob
  duration?: number
  timestamp?: number
}

export interface AudioChapterMetadata {
  chapterId: string
  totalDuration: number
  segments: AudioSegment[]
}
