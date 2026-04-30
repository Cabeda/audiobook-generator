/**
 * Generation State Persistence
 *
 * Persists the current generation state to localStorage so that if the browser
 * tab crashes or the user refreshes mid-generation, the app can offer to resume.
 *
 * The state is lightweight (just IDs and progress) and stored in localStorage
 * for simplicity — no IndexedDB version bump needed.
 */

import logger from '../utils/logger'

const STORAGE_KEY = 'audiobook_generation_state'

export interface GenerationState {
  bookId: number
  bookTitle: string
  chapterIds: string[]
  completedChapterIds: string[]
  currentChapterIndex: number
  startedAt: number
  model: string
  voice: string
  quantization: string
  device: string
}

/**
 * Save the current generation state.
 * Called at the start of generation and after each chapter completes.
 */
export function saveGenerationState(state: GenerationState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    logger.debug('[GenerationState] Saved state', {
      bookId: state.bookId,
      progress: `${state.completedChapterIds.length}/${state.chapterIds.length}`,
    })
  } catch (e) {
    logger.warn('[GenerationState] Failed to save state:', e)
  }
}

/**
 * Update the generation state to mark a chapter as completed.
 */
export function markChapterCompleted(chapterId: string): void {
  const state = getGenerationState()
  if (!state) return

  if (!state.completedChapterIds.includes(chapterId)) {
    state.completedChapterIds.push(chapterId)
  }
  state.currentChapterIndex = state.chapterIds.indexOf(chapterId) + 1
  saveGenerationState(state)
}

/**
 * Retrieve the persisted generation state, if any.
 * Returns null if no interrupted generation exists.
 */
export function getGenerationState(): GenerationState | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return null
    return JSON.parse(stored) as GenerationState
  } catch (e) {
    logger.warn('[GenerationState] Failed to read state:', e)
    return null
  }
}

/**
 * Check if there's an interrupted generation that can be resumed.
 * Returns the state if generation was in progress but not completed.
 */
export function getInterruptedGeneration(): GenerationState | null {
  const state = getGenerationState()
  if (!state) return null

  // If all chapters are completed, there's nothing to resume
  if (state.completedChapterIds.length >= state.chapterIds.length) {
    clearGenerationState()
    return null
  }

  // If the state is older than 24 hours, discard it (stale)
  const ageMs = Date.now() - state.startedAt
  if (ageMs > 24 * 60 * 60 * 1000) {
    logger.info('[GenerationState] Discarding stale generation state (>24h old)')
    clearGenerationState()
    return null
  }

  return state
}

/**
 * Clear the persisted generation state.
 * Called when generation completes successfully or is explicitly canceled.
 */
export function clearGenerationState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
    logger.debug('[GenerationState] Cleared state')
  } catch (e) {
    logger.warn('[GenerationState] Failed to clear state:', e)
  }
}
