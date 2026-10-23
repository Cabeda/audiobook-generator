// PROTOTYPE (throwaway): in-memory simulation of the TTS generation + playback
// pipeline so the UI variants can show how audiobook generation integrates.
// Timers are fake, nothing is persisted, no real model is loaded.

import {
  processedCount,
  segmentIndexAt,
  segmentStartFraction,
  segmentStateAt,
  type SegmentGenState,
} from './segmentMath'

export type AudioStatus = 'none' | 'queued' | 'generating' | 'ready' | 'failed'

export type ErrorKind = 'generation' | 'storage' | 'model' | 'offline'

interface Entry {
  status: AudioStatus
  progress: number
  duration: number // seconds (estimated from word count)
}

// ---------------------------------------------------------------------------
// Engine/voice metadata comes from the real registry, so the prototype cannot
// drift from the app (this is what once hid KittenTTS).
// ---------------------------------------------------------------------------

import {
  MODEL_OPTIONS,
  TTS_MODELS,
  engineSupportsLanguage,
  isTTSModelType,
  voiceOptionsFor,
  type SelectedModel,
} from '../lib/tts/ttsModels'
import type { PiperVoice } from '../lib/piper/piperClient'

/** Every model a picker offers, from the engine registry. */
export const MODELS: string[] = MODEL_OPTIONS.map((option) => option.id)

/** UI metadata for a model, from the registry. */
export function modelInfo(model: string): { name: string; blurb: string; size: string } {
  const info = TTS_MODELS.find((m) => m.id === model)
  return {
    name: info?.name ?? model,
    blurb: info?.description ?? '',
    size: info?.requiresDownload ? 'needs download' : 'built into the browser',
  }
}

/** Does the model speak the language? The registry decides. */
export function supportsLanguage(model: string, lang: string): boolean {
  if (model === 'web_speech') return true
  return isTTSModelType(model) && engineSupportsLanguage(model, lang)
}

/** The prototype cannot download Piper's catalogue; this stands in for it. */
const PIPER_STUB: PiperVoice[] = [
  { key: 'en_US-lessac-medium', name: 'Lessac (US)', language: 'en', quality: 'medium' },
  { key: 'en_GB-alan-low', name: 'Alan (UK)', language: 'en', quality: 'low' },
  { key: 'pt_BR-faber-medium', name: 'Faber (BR)', language: 'pt', quality: 'medium' },
  { key: 'de_DE-thorsten-medium', name: 'Thorsten', language: 'de', quality: 'medium' },
  { key: 'es_ES-davefx-medium', name: 'Davefx', language: 'es', quality: 'medium' },
  { key: 'fr_FR-siwis-medium', name: 'Siwis', language: 'fr', quality: 'medium' },
  { key: 'it_IT-riccardo-x_low', name: 'Riccardo', language: 'it', quality: 'low' },
  { key: 'nl_NL-mls-medium', name: 'MLS', language: 'nl', quality: 'medium' },
  { key: 'pl_PL-darkman-medium', name: 'Darkman', language: 'pl', quality: 'medium' },
  { key: 'ru_RU-denis-medium', name: 'Denis', language: 'ru', quality: 'medium' },
  { key: 'ja_JP-kokoro-medium', name: 'Kokoro (JP)', language: 'ja', quality: 'medium' },
  { key: 'hi_IN-cmu-medium', name: 'CMU', language: 'hi', quality: 'medium' },
]

/** Voices for a model in a language, via the registry's picker logic. */
export function voicesFor(model: string, lang?: string): string[] {
  return voiceOptionsFor(model as SelectedModel, lang ?? 'en', PIPER_STUB).map((v) => v.id)
}

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'pt', label: 'Português' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'pl', label: 'Polski' },
  { code: 'ru', label: 'Русский' },
  { code: 'ja', label: '日本語' },
  { code: 'hi', label: 'हिन्दी' },
] as const

/** Sample sentence per language for the voice sandbox. */
export const SAMPLE_TEXT: Record<string, string> = {
  en: 'The road climbed through the pines until the town was a smudge of smoke below.',
  pt: 'A estrada subia pelos pinheiros até que a cidade fosse apenas uma nuvem de fumo.',
  es: 'La carretera subía por los pinos hasta que el pueblo era solo una mancha de humo.',
  fr: 'La route grimpait dans les pins jusqu’à ce que le village ne soit plus qu’un voile de fumée.',
  de: 'Die Straße stieg durch die Kiefern, bis das Dorf nur noch ein Rauchfleck war.',
  it: 'La strada saliva tra i pini finché il paese non fu solo una macchia di fumo.',
  nl: 'De weg klom door de dennen tot het dorp nog maar een rookvlek was.',
  pl: 'Droga wspinała się przez sosny, aż wioska stała się tylko plamą dymu.',
  ru: 'Дорога поднималась через сосны, пока город не превратился в дымное пятно.',
  ja: '松林を抜けていくと、町は煙の染みのように見えてきた。',
  hi: 'सड़क देवदारों के बीच चढ़ती गई, जब तक कि कस्बा धुएँ का धब्बा न रह जाए।',
}

export const EXPORT_FORMATS = ['m4b', 'mp3', 'mp4', 'wav', 'epub'] as const

class PrototypeAudio {
  entries = $state<Record<string, Entry>>({})
  playing = $state(false)
  chapterId = $state<string | null>(null)
  position = $state(0)
  exporting = $state(false)
  exportPct = $state(0)
  exportDone = $state(false)

  /** Deterministic failure injection so error states can be tested on demand. */
  failures = $state({
    generation: false, // every generation attempt fails
    storage: false, // storage full: no generation, no export
    model: false, // the TTS model refuses to load
    offline: false, // no connection: generation pauses
  })

  lastError = $state<{ kind: ErrorKind; message: string } | null>(null)

  // fake TTS / export settings shared by all variants
  prefs = $state({
    model: 'kokoro' as (typeof MODELS)[number],
    voice: 'af_heart',
    language: 'en',
    rate: 1,
    autoContinue: true, // keep listening into the next chapter
    exportFormat: 'm4b' as (typeof EXPORT_FORMATS)[number],
    quantization: 'f32',
    device: 'webgpu',
  })

  private queue: string[] = []
  private pendingPlay: string | null = null
  private pendingSeek: number | null = null
  private durationOf: Record<string, number> = {}
  private segWeights: Record<string, number[]> = {}

  /** Register a chapter's segments (by text length) so playback can track them. */
  registerSegments(id: string, weights: number[]) {
    this.segWeights[id] = weights
  }

  segmentCount(id: string): number {
    return this.segWeights[id]?.length ?? 0
  }

  /** How far generation has moved through a chapter, in segments. */
  processedSegments(id: string): number {
    return processedCount(
      this.segmentCount(id),
      this.status(id).progress,
      this.status(id).status === 'ready'
    )
  }

  /** Generation state of one segment, from its chapter's progress. */
  segmentState(id: string, index: number): SegmentGenState {
    return segmentStateAt(
      index,
      this.processedSegments(id),
      this.status(id).status === 'generating'
    )
  }

  /** Which segment of the playing chapter is being spoken right now. */
  get segmentIndex(): number {
    if (!this.chapterId) return -1
    const w = this.segWeights[this.chapterId] ?? []
    return segmentIndexAt(w, this.duration > 0 ? this.position / this.duration : 0)
  }

  /** Called when a book opens: estimate durations, leave realistic mixed states. */
  seed(chapters: Array<{ id: string; content: string }>) {
    chapters.forEach((c, i) => {
      const words = c.content.replace(/<[^>]+>/g, ' ').split(/\s+/).length
      this.durationOf[c.id] = Math.max(30, Math.round(words / 2.6))
      if (!this.entries[c.id]) {
        // books opened for the first time look half-generated, like real usage
        this.entries[c.id] =
          i < Math.ceil(chapters.length / 2)
            ? { status: 'ready', progress: 1, duration: this.durationOf[c.id] }
            : { status: 'none', progress: 0, duration: this.durationOf[c.id] }
      }
    })
    this.pump()
  }

  status(id: string): Entry {
    return this.entries[id] ?? { status: 'none', progress: 0, duration: 0 }
  }

  /** Counts scoped to a book's chapter ids (omit ids for every book seen). */
  generatingCount(ids?: string[]) {
    return (ids ?? Object.keys(this.entries)).filter((id) => {
      const s = this.status(id).status
      return s === 'generating' || s === 'queued'
    }).length
  }

  readyCount(ids?: string[]) {
    return (ids ?? Object.keys(this.entries)).filter((id) => this.status(id).status === 'ready')
      .length
  }

  get duration() {
    return this.chapterId ? this.status(this.chapterId).duration : 0
  }

  generate(ids: string[]) {
    if (this.failures.storage) {
      this.lastError = {
        kind: 'storage',
        message: 'Storage is full — clear generated audio to make room.',
      }
      return
    }
    if (this.failures.offline) {
      this.lastError = {
        kind: 'offline',
        message: 'You are offline — generation resumes when the connection is back.',
      }
      return
    }
    this.lastError = null
    for (const id of ids) {
      const e = this.status(id)
      if (e.status === 'none' || e.status === 'failed') {
        if (this.failures.generation) {
          this.entries[id] = { ...e, status: 'failed', progress: 0 }
          continue
        }
        this.entries[id] = { ...e, status: 'queued', progress: 0 }
        this.queue.push(id)
      }
    }
    if (this.failures.generation) {
      this.lastError = {
        kind: 'generation',
        message: 'Generation failed — the engine returned an error.',
      }
    }
    this.pump()
  }

  /** Re-queue failed chapters (same path as generate — it accepts 'failed'). */
  retry(ids: string[]) {
    this.generate(ids)
  }

  failedCount(ids?: string[]) {
    return (ids ?? Object.keys(this.entries)).filter((id) => this.status(id).status === 'failed')
      .length
  }

  /** Generate (if needed) and play — the "dead simple" listen path. */
  play(id: string) {
    if (this.failures.model) {
      this.lastError = {
        kind: 'model',
        message: `The ${this.prefs.model} model failed to load — retry or switch model.`,
      }
      return
    }
    const e = this.status(id)
    if (e.status !== 'ready') {
      this.pendingPlay = id
      this.generate([id])
      return
    }
    this.lastError = null
    this.chapterId = id
    this.position = 0
    if (this.pendingSeek != null) {
      this.position = this.pendingSeek * this.duration
      this.pendingSeek = null
    }
    this.playing = true
    this.pump()
  }

  /** Speak from a given segment (click a sentence to continue from there). */
  playFromSegment(id: string, index: number) {
    const frac = segmentStartFraction(this.segWeights[id] ?? [], index)
    const e = this.status(id)
    if (e.status !== 'ready') {
      this.pendingPlay = id
      this.pendingSeek = frac
      this.generate([id])
      return
    }
    if (this.failures.model) {
      this.lastError = {
        kind: 'model',
        message: `The ${this.prefs.model} model failed to load — retry or switch model.`,
      }
      return
    }
    this.lastError = null
    this.chapterId = id
    this.playing = true
    this.position = frac * this.duration
    this.pump()
  }

  toggle() {
    if (!this.chapterId) return
    this.playing = !this.playing
    this.pump()
  }

  stop() {
    this.playing = false
    this.chapterId = null
    this.position = 0
    this.pump()
  }

  seek(fraction: number) {
    this.position = Math.max(0, Math.min(1, fraction)) * this.duration
  }

  skip(seconds: number) {
    this.position = Math.max(0, Math.min(this.duration, this.position + seconds))
  }

  export() {
    if (this.exporting) return
    if (this.failures.storage) {
      this.lastError = { kind: 'storage', message: 'Storage is full — export needs free space.' }
      return
    }
    this.lastError = null
    this.exporting = true
    this.exportDone = false
    this.exportPct = 0
    const timer = setInterval(() => {
      this.exportPct += 0.08
      if (this.exportPct >= 1) {
        this.exportPct = 1
        this.exporting = false
        this.exportDone = true
        clearInterval(timer)
      }
    }, 120)
  }

  /** Drop all generated audio (storage management in app settings). */
  clearGenerated() {
    this.playing = false
    this.chapterId = null
    this.position = 0
    for (const [id, e] of Object.entries(this.entries)) {
      this.entries[id] = { ...e, status: 'none', progress: 0 }
    }
    this.pump()
  }

  private pump() {
    // generation ticker: 2 concurrent "jobs", like the real worker pool
    if (!this.genTimer) {
      this.genTimer = setInterval(() => {
        const active = Object.entries(this.entries).filter(([, e]) => e.status === 'generating')
        const slots = 2 - active.length
        for (let i = 0; i < slots && this.queue.length > 0; i++) {
          const id = this.queue.shift()!
          const e = this.status(id)
          this.entries[id] = { ...e, status: 'generating', progress: 0 }
        }
        for (const [id, e] of Object.entries(this.entries)) {
          if (e.status !== 'generating') continue
          const next = e.progress + 0.04
          if (next >= 1) {
            this.entries[id] = { ...e, status: 'ready', progress: 1 }
            if (this.pendingPlay === id) {
              this.pendingPlay = null
              this.play(id)
            }
          } else {
            this.entries[id] = { ...e, progress: next }
          }
        }
        if (this.queue.length === 0 && this.generatingCount() === 0 && this.genTimer) {
          clearInterval(this.genTimer)
          this.genTimer = undefined
        }
      }, 140)
    }

    // playback ticker: auto-advances into the next chapter (generating it first)
    if (this.playing && !this.playTimer) {
      this.playTimer = setInterval(() => {
        this.position += 0.25 * this.prefs.rate
        if (this.position >= this.duration) {
          const id = this.chapterId
          this.playing = false
          if (id && this.onNext) this.onNext(id)
        }
      }, 250)
    }
    if (!this.playing && this.playTimer) {
      clearInterval(this.playTimer)
      this.playTimer = undefined
    }
  }

  /** Variants wire chapter continuation through this hook. */
  onNext: ((finishedId: string) => void) | null = null

  /** Clear tickers so a hot-reloaded module can't leave zombies behind. */
  destroy() {
    clearInterval(this.genTimer)
    clearInterval(this.playTimer)
    this.genTimer = undefined
    this.playTimer = undefined
  }

  private genTimer?: ReturnType<typeof setInterval>
  private playTimer?: ReturnType<typeof setInterval>
}

export const audio = new PrototypeAudio()

if (import.meta.hot) {
  import.meta.hot.dispose(() => audio.destroy())
}
