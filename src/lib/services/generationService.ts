import { get } from 'svelte/store'
import type { Chapter } from '../types/book'
import type { VoiceId } from '../kokoro/kokoroClient'
import { getTTSWorker } from '../ttsWorkerManager'
import {
  selectedModel,
  selectedVoice,
  selectedQuantization,
  selectedDevice,
  availableVoices,
  voiceLabels,
} from '../../stores/ttsStore'
import {
  chapterStatus,
  chapterErrors,
  generatedAudio,
  chapterProgress,
  book,
} from '../../stores/bookStore'
import { listVoices as listKokoroVoices } from '../kokoro/kokoroClient'
import {
  concatenateAudioChapters,
  downloadAudioFile,
  type AudioChapter,
  type ConcatenationProgress,
} from '../audioConcat'
import { EpubGenerator, type EpubMetadata } from '../epub/epubGenerator'
import logger from '../utils/logger'
import { audioLikeToBlob } from '../audioConcat'
import { saveChapterSegments } from '../libraryDB'
import type { AudioSegment } from '../types/audio'
import { generateVoiceStream } from '../kokoro/kokoroClient'

class GenerationService {
  private running = false
  private canceled = false

  async generateChapters(chapters: Chapter[]) {
    if (this.running) {
      logger.warn('Generation already running')
      return
    }

    const model = get(selectedModel)
    if (model === 'web_speech') {
      alert('Web Speech API does not support audio file generation.')
      return
    }

    this.running = true
    this.canceled = false // Reset canceled state

    const worker = getTTSWorker()
    const totalChapters = chapters.length

    // Helper to check for cancellation
    const checkCanceled = () => {
      if (this.canceled) {
        throw new Error('Cancelled by user')
      }
    }

    try {
      for (let i = 0; i < totalChapters; i++) {
        if (this.canceled) break

        const ch = chapters[i]
        const currentVoice = get(selectedVoice)
        const currentQuantization = get(selectedQuantization)
        const currentDevice = get(selectedDevice)

        // Validate content
        if (!ch.content || !ch.content.trim()) {
          chapterStatus.update((m) => new Map(m).set(ch.id, 'error'))
          chapterErrors.update((m) => new Map(m).set(ch.id, 'Chapter content is empty'))
          continue
        }

        // Update status to processing
        chapterStatus.update((m) => new Map(m).set(ch.id, 'processing'))

        // Check Kokoro voice validity
        let effectiveVoice = currentVoice
        if (model === 'kokoro') {
          const kokoroVoices = listKokoroVoices()
          if (!kokoroVoices.includes(effectiveVoice as VoiceId)) {
            logger.warn('Invalid Kokoro voice, falling back to af_heart')
            effectiveVoice = 'af_heart'
            // Update store? No, better not implicitly change user setting during batch, just use fallback
          }
        }

        try {
          if (model === 'kokoro') {
            // Segment-based generation for Kokoro
            // Cast effectiveVoice to VoiceId to satisfy type, assuming validation happened earlier
            logger.info(
              `[Generation] Starting Kokoro stream for chapter ${ch.id} with voice ${effectiveVoice}`
            )

            const stream = generateVoiceStream({
              text: ch.content,
              voice: effectiveVoice as VoiceId,
              speed: 1.0,
              dtype: currentQuantization,
              device: currentDevice,
            })

            const segments: AudioSegment[] = []
            let index = 0

            // Estimate sentence count for progress (rough estimate)
            const estimatedSentences = ch.content.split(/[.!?]+/).length

            chapterProgress.update((m) =>
              new Map(m).set(ch.id, {
                current: 0,
                total: estimatedSentences,
                message: 'Initializing stream...',
              })
            )

            for await (const chunk of stream) {
              if (this.canceled) break

              const segment: AudioSegment = {
                id: `${ch.id}-${index}`,
                chapterId: ch.id,
                index: index++,
                text: chunk.text,
                audioBlob: chunk.audio,
              }
              segments.push(segment)

              // Update progress with more detail
              chapterProgress.update((m) => {
                return new Map(m).set(ch.id, {
                  current: index,
                  total: estimatedSentences,
                  message: `Generating sentence ${index} of ~${estimatedSentences}`,
                })
              })
            }

            if (this.canceled) break

            chapterProgress.update((m) =>
              new Map(m).set(ch.id, {
                current: segments.length,
                total: segments.length,
                message: 'Finalizing audio...',
              })
            )

            // Save segments to DB
            // Use type assertion for book ID as we know it exists if we are generating
            const currentBook = get(book)
            if (currentBook) {
              // The LibraryBook interface has optional number id, but Book has string id.
              // We will try to parse it, or default to 0 (which might fail DB constraint, but let's assume valid ID)
              // If the book is from file import it might not have numeric ID yet?
              // Wait, saving segments requires a numeric bookId for the IndexedDB key.
              // If currentBook.id is a string UUID (from import) and not saved to library, we have a problem.
              // However, onBookLoaded now saves to library so we should have numeric ID.
              // We'll rely on currentBook having an 'id' that is numeric or string-numeric.
              // Let's cast loosely for now or check if it is "LibraryBook"
              const bookId = Number(currentBook.id) || 0
              await saveChapterSegments(bookId, ch.id, segments)
            }

            // Concatenate for backward compatibility (Play/Download)
            const audioChapters: AudioChapter[] = segments.map((s) => ({
              id: s.id,
              title: `Segment ${s.index}`,
              blob: s.audioBlob,
            }))

            const fullBlob = await concatenateAudioChapters(audioChapters, { format: 'wav' })

            // Save full audio
            generatedAudio.update((m) => {
              const newMap = new Map(m)
              if (m.has(ch.id)) {
                URL.revokeObjectURL(m.get(ch.id)!.url)
              }
              newMap.set(ch.id, {
                url: URL.createObjectURL(fullBlob),
                blob: fullBlob,
              })
              return newMap
            })
          } else {
            // Legacy/Worker path for Piper (or fallback)
            const blob = await worker.generateVoice({
              text: ch.content,
              modelType: model as 'kokoro' | 'piper',
              voice: effectiveVoice,
              dtype: model === 'kokoro' ? currentQuantization : undefined,
              device: currentDevice,
              onProgress: (msg) => {
                chapterProgress.update((m) => {
                  const current = m.get(ch.id) || { current: 0, total: 0 }
                  return new Map(m).set(ch.id, { ...current, message: msg })
                })
              },
              onChunkProgress: (current, total) => {
                chapterProgress.update((m) => {
                  const existing = m.get(ch.id) || { message: 'Generating...' }
                  return new Map(m).set(ch.id, { ...existing, current, total })
                })
              },
            })

            if (this.canceled) break

            // Success
            generatedAudio.update((m) => {
              const newMap = new Map(m)
              if (m.has(ch.id)) {
                URL.revokeObjectURL(m.get(ch.id)!.url)
              }
              newMap.set(ch.id, {
                url: URL.createObjectURL(blob),
                blob,
              })
              return newMap
            })
          }

          chapterStatus.update((m) => new Map(m).set(ch.id, 'done'))
          chapterErrors.update((m) => {
            const newMap = new Map(m)
            newMap.delete(ch.id)
            return newMap
          })
        } catch (err: any) {
          if (this.canceled) break

          const errorMsg = err.message || 'Unknown error'
          logger.error(`Generation failed for chapter ${ch.title}:`, err)

          chapterStatus.update((m) => new Map(m).set(ch.id, 'error'))
          chapterErrors.update((m) => new Map(m).set(ch.id, errorMsg))
        }
      }
    } finally {
      this.running = false
    }
  }

  cancel() {
    this.canceled = true
    const worker = getTTSWorker()
    worker.cancelAll()
    // Reset status of processing chapters?
    // Maybe not necessary, the loop will break and they will stay as 'processing' or we can mark them as error/pending?
    // Let's leave them for now or better, mark 'processing' as 'pending' to allow retry?
    // For now, simple cancel.
  }

  isRunning() {
    return this.running
  }

  async exportAudio(
    chapters: Chapter[],
    format: 'mp3' | 'm4b' | 'wav' = 'mp3',
    bitrate = 192,
    bookInfo: { title: string; author: string }
  ) {
    const generated = get(generatedAudio)

    const audioChapters: AudioChapter[] = []
    for (const ch of chapters) {
      if (generated.has(ch.id)) {
        audioChapters.push({
          id: ch.id,
          title: ch.title,
          blob: generated.get(ch.id)!.blob,
        })
      }
    }

    if (audioChapters.length === 0) {
      alert('No generated audio found for selected chapters')
      return
    }

    try {
      const combined = await concatenateAudioChapters(
        audioChapters,
        {
          format,
          bitrate,
          bookTitle: bookInfo.title,
          bookAuthor: bookInfo.author,
        },
        (p) => console.log('Concatenating:', p.message)
      )

      const ext = format === 'wav' ? 'wav' : format === 'm4b' ? 'm4b' : 'mp3'
      const filename = `${bookInfo.title.replace(/[^a-z0-9]/gi, '_')}_audiobook.${ext}`
      downloadAudioFile(combined, filename)
    } catch (e) {
      logger.error('Export failed', e)
      alert('Export failed')
    }
  }

  // TODO: Add EPUB export logic similar to GeneratePanel (requires segment aligned data which current simple generation might not store fully unless we change worker response handling)
  // For now simple audio export is the priority.
}

export const generationService = new GenerationService()
