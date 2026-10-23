// Specification for the listen session: the chains that decide whether the
// reader plays, toggles, continues and re-makes a segment.
// Seam: ListenSession (the interface is the test surface).
import { describe, expect, it } from 'vitest'
import type { Chapter } from '../types/book'
import { ListenSession, type ListenPlatform } from './listenSession'

const chapterA: Chapter = { id: 'a', title: 'A', content: '<p>one</p>' }
const chapterB: Chapter = { id: 'b', title: 'B', content: '<p>two</p>' }

/** A scripted platform that records what the session asked it to do. */
function fakePlatform(state: {
  loaded?: string | null
  playing?: boolean
  hasAudio?: boolean
  segments?: Record<number, string>
}) {
  const calls: string[] = []
  const platform: ListenPlatform = {
    loadedChapter: () => state.loaded ?? null,
    isPlaying: () => state.playing ?? false,
    hasAudio: () => state.hasAudio ?? true,
    segmentText: (_chapter, index) => state.segments?.[index] ?? null,
    ensureAudio: async () => {
      calls.push('ensureAudio')
    },
    load: async (chapter, atSegment) => {
      calls.push(`load:${chapter.id}${atSegment != null ? `@${atSegment}` : ''}`)
      state.loaded = chapter.id
    },
    play: async () => {
      calls.push('play')
      state.playing = true
    },
    pause: () => {
      calls.push('pause')
      state.playing = false
    },
    seekToSegment: async (index) => {
      calls.push(`seek:${index}`)
    },
    synthesize: async (text) => {
      calls.push(`synthesize:${text}`)
      return new Blob([text])
    },
    replaceSegmentAudio: (index) => {
      calls.push(`replace:${index}`)
    },
    skip: (seconds) => {
      calls.push(`skip:${seconds}`)
    },
    stop: () => {
      calls.push('stop')
      state.playing = false
      state.loaded = null
    },
  }
  return { platform, calls, state }
}

describe('ListenSession', () => {
  it('plays a chapter by loading it first, and waits for its audio', async () => {
    const { platform, calls } = fakePlatform({ hasAudio: false })
    const session = new ListenSession(platform)

    await session.play(chapterA)

    expect(calls).toEqual(['ensureAudio', 'load:a', 'play'])
  })

  it('toggles a loaded session instead of loading it again', async () => {
    // The dead-play-button bug: a loaded-but-paused chapter must resume and a
    // playing one must pause — never reload.
    const playing = fakePlatform({ loaded: 'a', playing: true })
    await new ListenSession(playing.platform).play(chapterA)
    expect(playing.calls).toEqual(['pause'])

    const paused = fakePlatform({ loaded: 'a', playing: false })
    await new ListenSession(paused.platform).play(chapterA)
    expect(paused.calls).toEqual(['play'])
  })

  it('speaks from the sentence the reader clicked', async () => {
    const same = fakePlatform({ loaded: 'a', playing: false })
    await new ListenSession(same.platform).playFrom(chapterA, 3)
    expect(same.calls).toEqual(['seek:3', 'play'])

    const other = fakePlatform({ loaded: 'a', playing: true })
    await new ListenSession(other.platform).playFrom(chapterB, 2)
    expect(other.calls).toEqual(['load:b@2', 'play'])
  })

  it('starts a chapter at a saved sentence', async () => {
    const { platform, calls } = fakePlatform({})
    await new ListenSession(platform).play(chapterA, { atSegment: 5 })
    expect(calls).toEqual(['load:a@5', 'play'])
  })

  it('re-makes the playing segment when the voice changes', async () => {
    // The silent-voice-change bug: a voice change must force synthesis of this
    // one segment (bulk generation skips segments that already have audio).
    const { platform, calls } = fakePlatform({ segments: { 2: 'the spoken sentence' } })
    const session = new ListenSession(platform)

    await session.remakeSegment(chapterA, 2, { model: 'piper', voice: 'Tugão', language: 'pt' })

    expect(calls).toEqual(['synthesize:the spoken sentence', 'replace:2'])
  })

  it('does nothing when the segment has no text to re-make', async () => {
    const { platform, calls } = fakePlatform({})
    await new ListenSession(platform).remakeSegment(chapterA, 9, {
      model: 'piper',
      voice: 'x',
      language: 'en',
    })
    expect(calls).toEqual([])
  })

  it('toggles, skips and stops through the platform', () => {
    const playing = fakePlatform({ loaded: 'a', playing: true })
    const session = new ListenSession(playing.platform)
    session.toggle()
    session.skip(-15)
    session.stop()
    expect(playing.calls).toEqual(['pause', 'skip:-15', 'stop'])
  })
})
