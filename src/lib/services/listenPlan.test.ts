// Specification for how a chapter's listening plan is chosen.
// Seam: listenPlanFor (book + chapter + preferences → voice/language).
import { describe, expect, it } from 'vitest'
import type { PiperVoice } from '../piper/piperClient'
import type { Book, Chapter } from '../types/book'
import { listenPlanFor } from './listenPlan'

const piperVoices: PiperVoice[] = [
  { key: 'en_US-lessac-medium', name: 'Lessac (US)', language: 'en_US', quality: 'medium' },
  { key: 'pt_PT-tugão-medium', name: 'Tugão', language: 'pt_PT', quality: 'medium' },
  { key: 'pt_BR-faber-medium', name: 'Faber (BR)', language: 'pt_BR', quality: 'medium' },
]

describe('listenPlanFor', () => {
  it('gives a Portuguese book a Portuguese voice without anyone choosing one', () => {
    // What importing a Portuguese book leaves behind: the importer stamps the
    // detected language on the chapter (detectAndPersistLanguagesForBook).
    const chapter: Chapter = {
      id: 'c1',
      title: 'I',
      content: '<p>Portugal é a 10ª economia mais lenta do século.</p>',
      detectedLanguage: 'pt',
      languageConfidence: 0.98,
    }
    const book: Book = { title: 'Portugal', author: 'Expresso', chapters: [chapter] }

    const plan = listenPlanFor(
      book,
      chapter,
      { model: 'piper', voice: 'en_US-lessac-medium' }, // the listener never picked a voice
      piperVoices
    )

    expect(plan.language).toBe('pt')
    expect(['pt_PT-tugão-medium', 'pt_BR-faber-medium']).toContain(plan.voice)
  })

  it('keeps an explicit chapter voice the listener chose', () => {
    const chapter: Chapter = {
      id: 'c1',
      title: 'I',
      content: '<p>x</p>',
      voice: 'pt_PT-tugão-medium',
      detectedLanguage: 'pt',
      languageConfidence: 0.98,
    }
    const book: Book = { title: 'Portugal', author: 'Expresso', chapters: [chapter] }

    const plan = listenPlanFor(
      book,
      chapter,
      { model: 'piper', voice: 'en_US-lessac-medium' },
      piperVoices
    )

    expect(plan.voice).toBe('pt_PT-tugão-medium')
  })

  it('caps the weight precision on constrained devices', () => {
    const chapter: Chapter = { id: 'c1', title: 'I', content: '<p>x</p>' }
    const book: Book = { title: 'Any', author: 'A', chapters: [chapter] }
    const prefs = { model: 'piper', voice: 'en_US-lessac-medium' }

    expect(listenPlanFor(book, chapter, prefs).quantization).toBe('q8')
    expect(listenPlanFor(book, chapter, { ...prefs, isMobile: true }).quantization).toBe('q4')
  })
})
