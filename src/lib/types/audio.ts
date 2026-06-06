export interface AudioSegment {
  id: string
  chapterId: string
  index: number
  text: string
  audioBlob: Blob
  duration: number // Duration in seconds
  startTime: number // Offset from chapter start in seconds
  /** Quality tier: 0=web_speech, 1=low, 2=medium, 3=high/best */
  qualityTier?: number
  /** TTS voice used to generate this segment */
  voice?: string
  /** TTS model used to generate this segment */
  model?: string
}

export interface AudioChapterMetadata {
  chapterId: string
  totalDuration: number
  segments: AudioSegment[]
}
