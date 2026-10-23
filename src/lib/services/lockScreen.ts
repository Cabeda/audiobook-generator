/**
 * Lock screen.
 *
 * Playback that survives the screen going off and controls where the phone
 * already shows them: the lock screen / notification carries the book and
 * chapter plus play, pause, skip and chapter stepping, and the screen stays
 * awake while audio plays. Every API is guarded — browsers differ, and losing
 * the lock screen is never worth losing playback over.
 */

export interface NowPlaying {
  title: string
  chapter: string
}

export function setNowPlaying(nowPlaying: NowPlaying, playing: boolean): void {
  if (!('mediaSession' in navigator)) return
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: nowPlaying.chapter || nowPlaying.title,
      artist: nowPlaying.title,
      album: nowPlaying.title,
    })
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  } catch {
    // metadata is a nicety
  }
}

export interface LockScreenControls {
  play: () => void
  pause: () => void
  seekBack: () => void
  seekForward: () => void
  next: () => void
  previous: () => void
}

export function bindLockScreenControls(controls: LockScreenControls): void {
  if (!('mediaSession' in navigator)) return
  const set = (action: MediaSessionAction, handler: (() => void) | null) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler)
    } catch {
      // the platform does not know this action
    }
  }
  set('play', controls.play)
  set('pause', controls.pause)
  set('seekbackward', controls.seekBack)
  set('seekforward', controls.seekForward)
  set('nexttrack', controls.next)
  set('previoustrack', controls.previous)
}

let wakeLock: { release: () => Promise<void> } | null = null

/** Keep the screen on while audio plays; safe to call on every state change. */
export async function keepScreenAwake(active: boolean): Promise<void> {
  const requestWakeLock = (
    navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> }
    }
  ).wakeLock
  if (!requestWakeLock) return
  try {
    if (active && !wakeLock) {
      wakeLock = await requestWakeLock.request('screen')
    } else if (!active && wakeLock) {
      await wakeLock.release()
      wakeLock = null
    }
  } catch {
    // denied or backgrounded — playback continues without it
  }
}
