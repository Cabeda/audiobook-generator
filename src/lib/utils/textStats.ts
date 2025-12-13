const DEFAULT_WORDS_PER_MINUTE = 160

export function countWords(text: string): number {
  if (!text) return 0
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function estimateSpeechDurationSeconds(
  words: number,
  wordsPerMinute: number = DEFAULT_WORDS_PER_MINUTE
): number {
  if (!Number.isFinite(words) || words <= 0) return 0
  if (!Number.isFinite(wordsPerMinute) || wordsPerMinute <= 0) return 0
  const wordsPerSecond = wordsPerMinute / 60
  return words / wordsPerSecond
}

export function formatDurationShort(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s'
  const totalSeconds = Math.round(seconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const secs = totalSeconds % 60

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  }

  if (minutes > 0) {
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`
  }

  return `${secs}s`
}

export { DEFAULT_WORDS_PER_MINUTE }
