/**
 * Listen session.
 *
 * The deep module behind listening: open a chapter, speak from a sentence,
 * pause and resume what is loaded, re-make the playing segment when the voice
 * changes. Everything below the seam — the playback service adapter, synthesis,
 * generation waits — stays private; callers see only these verbs.
 *
 * The chains here decide whether the reader plays at all, so the interface is
 * the test surface: a restored session must toggle rather than reload, and a
 * voice change must force synthesis rather than ask a pipeline that skips
 * finished segments.
 */

import type { Chapter } from '../types/book'

export interface RemakeOptions {
  model: string
  voice: string
  language: string
  quantization?: string
  device?: string
}

/** What the session needs from the platform; the adapter supplies it. */
export interface ListenPlatform {
  /** The chapter with audio loaded in this session, or null. A restored id is
   * not a session. */
  loadedChapter(): string | null
  isPlaying(): boolean
  /** The chapter can be played right now. */
  hasAudio(chapter: Chapter): boolean
  segmentText(chapter: Chapter, index: number): string | null
  /** Generate whatever the chapter is missing before it can play. */
  ensureAudio(chapter: Chapter): Promise<void>
  /** Load a chapter, positioned at a sentence when one is given. */
  load(chapter: Chapter, atSegment?: number): Promise<void>
  play(): Promise<void>
  pause(): void
  /** Move the loaded chapter to a sentence. */
  seekToSegment(index: number): Promise<void>
  /** Forced synthesis of one segment — never skipped like bulk generation. */
  synthesize(
    text: string,
    options: RemakeOptions,
    context: { chapterId: string; index: number }
  ): Promise<Blob>
  /** Swap a segment's audio in, upgrading the playing one when it can. */
  replaceSegmentAudio(index: number, blob: Blob): void
  skip(seconds: number): void
  stop(): void
}

export class ListenSession {
  constructor(private platform: ListenPlatform) {}

  /**
   * Play a chapter: resume the loaded one (toggling when it is already
   * playing), otherwise make sure it has audio, load it and start — at a
   * sentence when the listener left off mid-chapter.
   */
  async play(chapter: Chapter, options: { atSegment?: number } = {}): Promise<void> {
    if (this.platform.loadedChapter() === chapter.id) {
      if (this.platform.isPlaying()) this.platform.pause()
      else await this.platform.play()
      return
    }
    if (!this.platform.hasAudio(chapter)) await this.platform.ensureAudio(chapter)
    await this.platform.load(chapter, options.atSegment)
    await this.platform.play()
  }

  /** Speak from a sentence (click a sentence to continue from there). */
  async playFrom(chapter: Chapter, segment: number): Promise<void> {
    if (this.platform.loadedChapter() === chapter.id) {
      await this.platform.seekToSegment(segment)
      await this.platform.play()
      return
    }
    await this.play(chapter, { atSegment: segment })
  }

  /** Pause what plays, resume what is paused. */
  toggle(): void {
    if (this.platform.isPlaying()) this.platform.pause()
    else void this.platform.play()
  }

  stop(): void {
    this.platform.stop()
  }

  skip(seconds: number): void {
    this.platform.skip(seconds)
  }

  /**
   * Re-make the playing segment with a new voice or model and swap it in.
   * The forced synthesis matters: bulk generation skips segments that already
   * have audio, which is exactly what a voice change must not do.
   */
  async remakeSegment(chapter: Chapter, index: number, options: RemakeOptions): Promise<void> {
    const text = this.platform.segmentText(chapter, index)
    if (!text) return
    const blob = await this.platform.synthesize(text, options, {
      chapterId: chapter.id,
      index,
    })
    this.platform.replaceSegmentAudio(index, blob)
  }
}
