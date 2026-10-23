/**
 * Listen plan.
 *
 * How a chapter should be listened to — which language, engine, voice and
 * settings — computed from the book, the chapter and the listener's
 * preferences. Pure, so the reader model and the tests ask the same thing.
 */

import type { Book, Chapter } from '../types/book'
import type { PiperVoice } from '../piper/piperClient'
import { planChapter, type ChapterPlan } from './chapterPlan'
import { resolveChapterLanguageWithDetection } from '../utils/languageResolver'
import type { Device, Quantization } from '../../stores/ttsStore'

export interface ListenPrefs {
  model: string
  voice: string
  quantization?: Quantization
  device?: Device
  /** The app's per-language defaults. */
  languageDefaults?: Record<string, { model?: string; voice?: string } | undefined>
}

/** The plan the reader plays a chapter with. */
export function listenPlanFor(
  book: Book,
  chapter: Chapter,
  prefs: ListenPrefs,
  piperVoices: PiperVoice[] = []
): ChapterPlan {
  return planChapter({
    chapter: { model: chapter.model, voice: chapter.voice },
    // The same answer everywhere: a chapter's override, then its detected
    // language (what importing stamps), then the book's, then the default.
    language: resolveChapterLanguageWithDetection(chapter, book),
    languageDefaults: prefs.languageDefaults ?? {},
    selectedModel: prefs.model,
    selectedVoice: prefs.voice,
    piperVoices,
    selectedQuantization: prefs.quantization,
    selectedDevice: prefs.device,
  })
}
