/**
 * Benchmark harness.
 *
 * Drives the speech engines and the export modules directly, so a benchmark
 * or a test never has to go through the user interface.
 *
 * It runs in a browser page (the engines use onnxruntime-web), but nothing
 * here touches the app's components: the harness talks to the same modules
 * the app talks to.
 */

import { parseEpubFile } from '../epubParser'
import { segmentHtmlContent } from '../services/segmentationService'
import {
  getTTSEngine,
  type TTSEngine,
  type TTSEngineConfig,
  type TTSModelType,
} from '../tts/ttsModels'
import { concatenateAudioChapters } from '../audioConcat'
import { incrementalConcatWav, parseWavDuration } from '../wavUtils'
import { piperClient } from '../piper/piperClient'
import { selectPiperVoiceForLanguage } from '../utils/voiceSelector'
import { POCKET_VOICE_IDS } from '../pocket/pocketAssets'
import logger from '../utils/logger'

export type BenchmarkPhase = 'loading' | 'generating' | 'encoding'

export interface BenchmarkProgress {
  model: TTSModelType
  phase: BenchmarkPhase
  /** Chapters finished so far. */
  done: number
  /** Chapters in the book. */
  total: number
  /** The chapter being worked on, for a readable log. */
  chapter?: string
}

export interface ModelBenchmarkResult {
  model: TTSModelType
  voice: string
  chapters: number
  segments: number
  /** Length of the generated audio, in seconds. */
  audioSeconds: number
  /** Time spent generating audio, in seconds. */
  generationSeconds: number
  /** Time spent encoding to MP3 and M4B, in seconds. */
  exportSeconds: number
  mp3Bytes: number
  m4bBytes: number
  /**
   * How much faster than real time the engine is: audio seconds per second
   * of generation. Higher is faster.
   */
  realTimeFactor: number
  /** True when the whole book was processed. */
  complete: boolean
  /**
   * How long the whole book would take, in seconds. Measured when the run
   * was cut short, the time it took when it was not.
   */
  estimatedTotalSeconds: number
  /** Set when the model could not finish the book. */
  error?: string
}

export interface BenchmarkReport {
  book: string
  startedAt: string
  /** Wall clock time of the whole benchmark, in seconds. */
  totalSeconds: number
  models: ModelBenchmarkResult[]
}

export interface BenchmarkOptions {
  /** The book, as bytes. */
  book: ArrayBuffer
  /** The name of the book, for the report. */
  name: string
  /** The engines to run. */
  models: TTSModelType[]
  /** Stop after this many chapters. The whole book when omitted. */
  maxChapters?: number
  /** Stop after this many segments in total. The whole book when omitted. */
  maxSegments?: number
  /**
   * Stop each model after this many seconds. The time the whole book would
   * take is then estimated from what was measured. The whole book when
   * omitted.
   */
  budgetSeconds?: number
  /** Encode each chapter to MP3 and M4B as well. On by default. */
  encodeFormats?: boolean
  onProgress?: (progress: BenchmarkProgress) => void
}

/** The engine settings each model is measured with. */
export function benchmarkConfig(model: TTSModelType): TTSEngineConfig {
  switch (model) {
    case 'kokoro':
      // The benchmark runs on the CPU, so WebGPU is not part of the comparison.
      return { model: 'onnx-community/Kokoro-82M-v1.0-ONNX', dtype: 'q8', device: 'wasm' }
    case 'piper':
    case 'pocket':
    default:
      return {}
  }
}

/** A voice the model can speak the book with. */
export async function benchmarkVoice(model: TTSModelType, language: string): Promise<string> {
  switch (model) {
    case 'kokoro':
      return 'af_heart'
    case 'piper': {
      const voices = await piperClient.getVoices()
      if (voices.length === 0) return ''
      return selectPiperVoiceForLanguage(language, voices)
    }
    case 'pocket':
    default:
      return POCKET_VOICE_IDS[0]
  }
}

type ChapterText = { id: string; title: string; segments: { text: string }[] }

/**
 * Split the book into the segments the engines will speak.
 *
 * `maxSegments` and `maxChapters` cut the book short, for a quick run.
 */
export function segmentBook(
  book: ArrayBuffer,
  maxSegments?: number,
  maxChapters?: number
): Promise<ChapterText[]> {
  const file = new File([book], 'book.epub', { type: 'application/epub+zip' })
  return parseEpubFile(file).then((parsed) => {
    const chapters: ChapterText[] = []
    let total = 0

    for (const chapter of parsed.chapters) {
      if (maxChapters && chapters.length >= maxChapters) break
      const { segments } = segmentHtmlContent(chapter.id, chapter.content ?? '')
      const texts: { text: string }[] = []
      for (const segment of segments) {
        if (!segment.text.trim()) continue
        texts.push({ text: segment.text })
        total++
        if (maxSegments && total >= maxSegments) break
      }
      chapters.push({ id: chapter.id, title: chapter.title, segments: texts })
      if (maxSegments && total >= maxSegments) break
    }

    return chapters
  })
}

/** Speak every segment of a chapter with one engine. */
async function generateChapter(
  engine: TTSEngine,
  chapter: ChapterText,
  voice: string
): Promise<{ blob: Blob; duration: number }> {
  const blobs: Blob[] = []
  for (const segment of chapter.segments) {
    const blob = await engine.generateVoice({ text: segment.text, voice })
    blobs.push(blob)
  }

  const blob = await incrementalConcatWav(blobs.length, async (index) => blobs[index] ?? null)
  const duration = await parseWavDuration(blob)
  return { blob, duration }
}

/**
 * Process a whole book with each engine and measure what it costs.
 *
 * The book is processed chapter by chapter: each chapter is generated and then
 * encoded to MP3 and M4B, so the whole run stays within the browser's memory.
 */
export async function benchmarkBook(options: BenchmarkOptions): Promise<BenchmarkReport> {
  const startedAt = new Date().toISOString()
  const started = performance.now()

  const chapters = await segmentBook(options.book, options.maxSegments, options.maxChapters)
  const totalSegments = chapters.reduce((sum, chapter) => sum + chapter.segments.length, 0)
  const results: ModelBenchmarkResult[] = []

  for (const model of options.models) {
    const voice = await benchmarkVoice(model, 'en')
    const result: ModelBenchmarkResult = {
      model,
      voice,
      chapters: 0,
      segments: 0,
      audioSeconds: 0,
      generationSeconds: 0,
      exportSeconds: 0,
      mp3Bytes: 0,
      m4bBytes: 0,
      realTimeFactor: 0,
      complete: false,
      estimatedTotalSeconds: 0,
    }

    try {
      options.onProgress?.({ model, phase: 'loading', done: 0, total: chapters.length })

      const engine = await getTTSEngine(model, benchmarkConfig(model))
      const modelStart = performance.now()

      for (const chapter of chapters) {
        if (chapter.segments.length === 0) continue

        const generationStart = performance.now()
        const { blob, duration } = await generateChapter(engine, chapter, voice)
        result.generationSeconds += (performance.now() - generationStart) / 1000
        result.audioSeconds += duration
        result.segments += chapter.segments.length
        result.chapters += 1

        options.onProgress?.({
          model,
          phase: 'encoding',
          done: result.chapters,
          total: chapters.length,
          chapter: chapter.title,
        })

        if (options.encodeFormats !== false) {
          const encodeStart = performance.now()
          const [mp3, m4b] = await Promise.all([
            concatenateAudioChapters([{ id: chapter.id, title: chapter.title, blob }], {
              format: 'mp3',
            }),
            concatenateAudioChapters([{ id: chapter.id, title: chapter.title, blob }], {
              format: 'm4b',
            }),
          ])
          result.exportSeconds += (performance.now() - encodeStart) / 1000
          result.mp3Bytes += mp3.size
          result.m4bBytes += m4b.size
        }

        // The chapter audio is released here: the whole book does not fit in
        // memory, so each chapter is encoded and dropped.
        if (
          options.budgetSeconds &&
          (performance.now() - modelStart) / 1000 >= options.budgetSeconds
        ) {
          logger.info('[benchmark] Time budget reached', { model, chapters: result.chapters })
          break
        }
      }

      result.realTimeFactor =
        result.generationSeconds > 0 ? result.audioSeconds / result.generationSeconds : 0
      result.complete = result.chapters === chapters.length

      // What the whole book would take, from what was measured.
      const perSegment = result.segments > 0 ? result.generationSeconds / result.segments : 0
      result.estimatedTotalSeconds = perSegment * totalSegments
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error)
    }

    results.push(result)
  }

  return {
    book: options.name,
    startedAt,
    totalSeconds: (performance.now() - started) / 1000,
    models: results,
  }
}

// ─── engine measurement ─────────────────────────────────────────────────────

export interface EngineMeasurement {
  model: TTSModelType
  voice: string
  /** Time to load the model and build its sessions, in seconds. */
  loadSeconds: number
  /** Time from the first request to the first audio, in seconds. */
  firstAudioSeconds: number
  /** Length of the generated audio, in seconds. */
  audioSeconds: number
  /** Time spent generating, in seconds. */
  generationSeconds: number
  /** Audio seconds per second of generation. Higher is faster. */
  realTimeFactor: number
  segments: number
  error?: string
}

/**
 * Measure one engine: how long it takes to load, how long it takes to speak
 * the first segment, and how fast it speaks.
 */
export async function measureEngine(
  model: TTSModelType,
  options: { segments?: number; text?: string } = {}
): Promise<EngineMeasurement> {
  const voice = await benchmarkVoice(model, 'en')
  const measurement: EngineMeasurement = {
    model,
    voice,
    loadSeconds: 0,
    firstAudioSeconds: 0,
    audioSeconds: 0,
    generationSeconds: 0,
    realTimeFactor: 0,
    segments: 0,
  }

  try {
    const engine = await getTTSEngine(model, benchmarkConfig(model))
    const warmupStart = performance.now()
    await engine.warmUp?.()
    measurement.loadSeconds = (performance.now() - warmupStart) / 1000

    const texts = options.text
      ? [options.text]
      : [
          'This is the first segment of the book.',
          'And this is the second one, a little longer than the first.',
          'The third segment is here as well.',
        ]

    const generationStart = performance.now()
    for (const text of texts) {
      const blob = await engine.generateVoice({ text, voice })
      if (measurement.segments === 0) {
        measurement.firstAudioSeconds = (performance.now() - generationStart) / 1000
      }
      measurement.audioSeconds += await parseWavDuration(blob)
      measurement.segments++
    }
    measurement.generationSeconds = (performance.now() - generationStart) / 1000
    measurement.realTimeFactor =
      measurement.generationSeconds > 0
        ? measurement.audioSeconds / measurement.generationSeconds
        : 0
  } catch (error) {
    measurement.error = error instanceof Error ? error.message : String(error)
  }

  return measurement
}

/** Measure every engine. */
export async function measureEngines(models: TTSModelType[]): Promise<EngineMeasurement[]> {
  const measurements: EngineMeasurement[] = []
  for (const model of models) {
    measurements.push(await measureEngine(model))
  }
  return measurements
}

// ─── export formats ─────────────────────────────────────────────────────────

export interface ExportFormatCheck {
  model: TTSModelType
  voice: string
  /** Length of the generated audio, in seconds. */
  audioSeconds: number
  mp3: { bytes: number; type: string }
  m4b: { bytes: number; type: string }
  /** The first bytes of each file, for the caller to check the container. */
  mp3Header: number[]
  m4bHeader: number[]
  error?: string
}

/**
 * Speak a short text with each engine and encode it to MP3 and M4B.
 *
 * The caller checks the results, so the test can assert on the container.
 */
export async function checkExportFormats(
  models: TTSModelType[],
  text = 'This is a test of the speech engine.'
): Promise<ExportFormatCheck[]> {
  const checks: ExportFormatCheck[] = []

  for (const model of models) {
    const voice = await benchmarkVoice(model, 'en')
    const check: ExportFormatCheck = {
      model,
      voice,
      audioSeconds: 0,
      mp3: { bytes: 0, type: '' },
      m4b: { bytes: 0, type: '' },
      mp3Header: [],
      m4bHeader: [],
    }

    try {
      const engine = await getTTSEngine(model, benchmarkConfig(model))
      const blob = await engine.generateVoice({ text, voice })
      check.audioSeconds = await parseWavDuration(blob)

      const mp3 = await concatenateAudioChapters([{ id: 'check', title: 'Check', blob }], {
        format: 'mp3',
      })
      const m4b = await concatenateAudioChapters([{ id: 'check', title: 'Check', blob }], {
        format: 'm4b',
      })

      check.mp3 = { bytes: mp3.size, type: mp3.type }
      check.m4b = { bytes: m4b.size, type: m4b.type }
      check.mp3Header = Array.from(new Uint8Array(await mp3.slice(0, 4).arrayBuffer()))
      check.m4bHeader = Array.from(new Uint8Array(await m4b.slice(0, 12).arrayBuffer()))
    } catch (error) {
      check.error = error instanceof Error ? error.message : String(error)
    }

    checks.push(check)
  }

  return checks
}
