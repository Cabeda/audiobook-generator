import { test, expect } from '@playwright/test'

/**
 * Every engine has to be able to produce audio that the exporter can turn
 * into an MP3 and an M4B.
 *
 * The check drives the engines and the export modules directly, so it does
 * not depend on the user interface.
 */
const MODELS = ['kokoro', 'piper', 'pocket'] as const

type ExportCheck = {
  model: string
  voice: string
  audioSeconds: number
  mp3: { bytes: number; type: string }
  m4b: { bytes: number; type: string }
  mp3Header: number[]
  m4bHeader: number[]
  error?: string
}

test.describe('export formats', () => {
  test('each engine can generate MP3 and M4B', async ({ page }) => {
    test.setTimeout(15 * 60 * 1000)

    await page.goto('/')

    const checks = (await page.evaluate(
      async (models) => {
        // The dev server serves the module; it is not a path on disk.
        // @ts-expect-error - resolved by the dev server at runtime
        const harness = await import('/src/lib/benchmark/harness.ts')
        return harness.checkExportFormats(models)
      },
      [...MODELS]
    )) as ExportCheck[]

    expect(checks).toHaveLength(MODELS.length)

    for (const check of checks) {
      expect(check.error, `${check.model} failed: ${check.error}`).toBeUndefined()

      // The engine produced audio.
      expect(check.audioSeconds, `${check.model} audio length`).toBeGreaterThan(0.1)
      expect(check.voice, `${check.model} voice`).not.toBe('')

      // The MP3 is an MPEG audio file: either an ID3 tag or a frame sync.
      expect(check.mp3.bytes, `${check.model} mp3 size`).toBeGreaterThan(1000)
      expect(check.mp3.type).toBe('audio/mpeg')
      const isId3 = String.fromCharCode(...check.mp3Header.slice(0, 3)) === 'ID3'
      const isFrameSync = check.mp3Header[0] === 0xff && (check.mp3Header[1] & 0xe0) === 0xe0
      expect(isId3 || isFrameSync, `${check.model} mp3 header`).toBe(true)

      // The M4B is an MP4 container.
      expect(check.m4b.bytes, `${check.model} m4b size`).toBeGreaterThan(1000)
      expect(check.m4b.type).toBe('audio/m4b')
      expect(String.fromCharCode(...check.m4bHeader.slice(4, 8)), `${check.model} m4b box`).toBe(
        'ftyp'
      )
    }
  })
})
