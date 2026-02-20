interface Progress {
  bookId: string
  chapterId: string
  segmentIndex: number
  timestamp: number
}

const PROGRESS_KEY = 'audiobook_progress'

export function saveProgress(bookId: string, chapterId: string, segmentIndex: number) {
  try {
    const progress: Progress = { bookId, chapterId, segmentIndex, timestamp: Date.now() }
    localStorage.setItem(`${PROGRESS_KEY}_${bookId}`, JSON.stringify(progress))
  } catch (e) {
    console.warn('Failed to save progress:', e)
  }
}

export function loadProgress(bookId: string): Progress | null {
  try {
    const data = localStorage.getItem(`${PROGRESS_KEY}_${bookId}`)
    return data ? JSON.parse(data) : null
  } catch (e) {
    console.warn('Failed to load progress:', e)
    return null
  }
}

export function clearProgress(bookId: string) {
  try {
    localStorage.removeItem(`${PROGRESS_KEY}_${bookId}`)
  } catch (e) {
    console.warn('Failed to clear progress:', e)
  }
}
