/**
 * Page probe for the reader playback tests.
 *
 * Installed before the app loads. It does three jobs:
 *
 *  1. Records every <audio> element the app creates, so a test can tell
 *     whether a segment really played to its end.
 *  2. Records the order in which segments become the active (highlighted) one.
 *  3. Optionally replaces the TTS worker with one that answers every request
 *     with a canned WAV, so the playback chain can be exercised without
 *     downloading a model. The nightly engine tests use the real worker.
 */

import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

export interface ReaderProbeState {
  /** Segment indexes that became active, in order. */
  active: number[]
  /** <audio> elements that were asked to play. */
  played: number
  /** <audio> elements that reached their natural end. */
  ended: number
  /** <audio> elements that hit a media error. */
  errored: number
  /** <audio> elements the app created. */
  created: number
  /** Generation requests the fake worker received. */
  requests: number
}

/**
 * Installs the observers. It is a function because Playwright serialises it
 * into the page — it must not close over anything outside its own scope.
 */
export function installReaderProbe(): void {
  const RealAudio = window.Audio

  // --- audio element recorder --------------------------------------------
  interface AudioRecord {
    played: boolean
    ended: boolean
    errored: boolean
  }
  const audioLog: AudioRecord[] = []
  let created = 0

  // Catch every play() call, however the element was made.
  const nativePlay = window.HTMLMediaElement.prototype.play
  window.HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    const record = audioLog[audioLog.length - 1]
    if (record) record.played = true
    return nativePlay.call(this)
  }

  function AudioCtor(this: unknown, src?: unknown) {
    const element = new RealAudio(src as string | undefined)
    created++
    const record: AudioRecord = { played: false, ended: false, errored: false }
    audioLog.push(record)
    element.addEventListener('ended', () => {
      record.ended = true
    })
    element.addEventListener('error', () => {
      record.errored = true
    })
    return element
  }
  AudioCtor.prototype = RealAudio.prototype
  window.Audio = AudioCtor as unknown as typeof Audio

  // --- active segment observer -------------------------------------------
  const active: number[] = []
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const element = mutation.target as HTMLElement
      if (!element.classList?.contains('active')) continue
      const index = Number(element.getAttribute('data-segment-index'))
      if (Number.isNaN(index)) continue
      if (active[active.length - 1] !== index) active.push(index)
    }
  })
  observer.observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] })

  // --- state --------------------------------------------------------------
  Object.defineProperty(window, '__readerProbe', {
    value: (): ReaderProbeState => ({
      active: [...active],
      played: audioLog.filter((record) => record.played).length,
      ended: audioLog.filter((record) => record.played && record.ended).length,
      errored: audioLog.filter((record) => record.errored).length,
      created,
      requests: (window as unknown as { __ttsWorkerRequests?: number }).__ttsWorkerRequests ?? 0,
    }),
  })
}

/**
 * Replaces the TTS worker with one that answers every request with a canned
 * WAV. Install it together with the probe when the test does not want to
 * download a real model.
 */
export function installFakeTtsWorker(): void {
  const RealWorker = window.Worker

  // 24 kHz, mono, 16-bit PCM. Short, so a whole chapter plays in seconds.
  function buildWav(ms: number): ArrayBuffer {
    const sampleRate = 24000
    const samples = Math.max(1, Math.floor((sampleRate * ms) / 1000))
    const dataBytes = samples * 2
    const buffer = new ArrayBuffer(44 + dataBytes)
    const view = new DataView(buffer)
    const ascii = (offset: number, text: string) => {
      for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
    }
    ascii(0, 'RIFF')
    view.setUint32(4, 36 + dataBytes, true)
    ascii(8, 'WAVE')
    ascii(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true) // PCM
    view.setUint16(22, 1, true) // mono
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    ascii(36, 'data')
    view.setUint32(40, dataBytes, true)
    return buffer
  }

  const cannedWav = buildWav(40)
  let requests = 0

  class FakeTtsWorker {
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: unknown) => void) | null = null

    constructor() {
      // The manager waits for this before it will send any request.
      setTimeout(() => this.onmessage?.({ data: { type: 'ready' } } as MessageEvent), 0)
    }

    postMessage(message: { id?: string }) {
      const id = message?.id
      if (!id) return
      requests++
      // A fresh copy per request: the real worker transfers the buffer.
      const audioBuffer = cannedWav.slice(0)
      setTimeout(() => {
        this.onmessage?.({ data: { id, type: 'complete', audioBuffer } } as MessageEvent)
      }, 10)
    }

    terminate() {}
    addEventListener() {}
    removeEventListener() {}
  }

  function WorkerCtor(this: unknown, url: unknown, options?: unknown) {
    if (String(url).includes('tts.worker')) return new FakeTtsWorker()
    return new RealWorker(url as string, options as WorkerOptions)
  }
  WorkerCtor.prototype = RealWorker.prototype
  window.Worker = WorkerCtor as unknown as typeof Worker

  Object.defineProperty(window, '__ttsWorkerRequests', {
    get: () => requests,
  })
}

/** Reads the probe state out of the page. */
export async function readProbe(page: Page): Promise<ReaderProbeState> {
  return page.evaluate(() =>
    (
      window as unknown as {
        __readerProbe: () => ReaderProbeState
      }
    ).__readerProbe()
  )
}

/**
 * Uploads a book, opens its first chapter in the reader and waits for the
 * segments to be rendered. Returns the number of segments in the chapter.
 */
export async function openReader(page: Page, file: string, heading: RegExp): Promise<number> {
  await page.locator('input[type="file"]').setInputFiles(file)
  await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 30000 })

  await page
    .getByRole('button', { name: /Read chapter/ })
    .first()
    .click()
  await expect(page.locator('.reader-page')).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.segment').first()).toBeVisible({ timeout: 15000 })

  return page.locator('.segment').count()
}

/**
 * Waits for the reader to play every segment of the chapter.
 *
 * Returns the probe state. The caller asserts on it; this only waits.
 */
export async function waitForPlayback(
  page: Page,
  segmentCount: number,
  timeoutMs: number
): Promise<ReaderProbeState> {
  const deadline = Date.now() + timeoutMs
  let state = await readProbe(page)
  while (
    Date.now() < deadline &&
    !(state.ended >= segmentCount && state.active.length >= segmentCount)
  ) {
    await page.waitForTimeout(250)
    state = await readProbe(page)
  }
  return state
}

/** A one-line summary of the playback, for failure messages. */
export function describePlayback(state: ReaderProbeState, segmentCount: number): string {
  return (
    `segments=${segmentCount} active=${state.active.length}/${segmentCount} ` +
    `played=${state.played} ended=${state.ended} errored=${state.errored} ` +
    `created=${state.created} requests=${state.requests} ` +
    `lastActive=${state.active[state.active.length - 1]} ` +
    `seq=${state.active.join(',')}`
  )
}
