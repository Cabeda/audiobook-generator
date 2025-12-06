export interface AudioSegment {
  id: string
  chapterId: string
  index: number
  text: string
  audioBlob: Blob
  duration: number // Duration in seconds
  startTime: number // Offset from chapter start in seconds
}

export interface AudioChapterMetadata {
  chapterId: string
  totalDuration: number
  segments: AudioSegment[]
}
