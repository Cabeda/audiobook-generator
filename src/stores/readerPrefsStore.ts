/**
 * Reader preferences.
 *
 * How the reader looks and sounds — theme, text size, playback speed,
 * auto-continue. The library is remembered on the device; these are too.
 * Relaunching the app (or reopening it on a phone) must not reset them.
 */

import { persistedWritable } from './persistedWritable'

export type ReaderTheme = 'light' | 'sepia' | 'dark'

export const readerTheme = persistedWritable<ReaderTheme>('reader_theme', 'light')
export const readerFontSize = persistedWritable<number>('reader_font_size', 17)
export const playbackSpeed = persistedWritable<number>('playback_speed', 1)
export const continueAfterChapter = persistedWritable<boolean>('reader_auto_continue', true)
