/**
 * Reader position.
 *
 * Where the reader left off in each book — the chapter and sentence being
 * listened to and the scroll share of the reading — kept across sessions in
 * localStorage, the same way the player state is. Small enough to keep local:
 * multi-device sync is tracked separately.
 */

export interface ReaderPosition {
  /** Chapter the reader is on. */
  chapterId: string
  /** Segment being listened to within that chapter. */
  segmentIndex: number
  /** Share of the book scrolled through, 0..1. */
  scrollFraction: number
  /**
   * The sentence at the top of the reading area and its pixel distance from
   * it — what "exactly where I was" means. A fraction is not enough: the
   * scrollable height changes as chapters render lazily, so the same fraction
   * describes a different place before and after a reopen.
   */
  anchorSegment?: number
  anchorOffset?: number
  savedAt: number
}

const STORAGE_KEY = 'reader_positions'

type PositionMap = Record<string, ReaderPosition>

function readAll(): PositionMap {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as PositionMap
  } catch {
    return {}
  }
}

/** Where the reader left off in a book, or null when it is new to them. */
export function loadPosition(bookId: number | null): ReaderPosition | null {
  if (bookId == null) return null
  return readAll()[String(bookId)] ?? null
}

/** Remember where the reader is; newest wins per book. */
export function savePosition(bookId: number | null, position: ReaderPosition): void {
  if (bookId == null) return
  const all = readAll()
  all[String(bookId)] = position
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // storage full or unavailable — losing a position is not worth a crash
  }
}
