import { test, expect } from '@playwright/test'

/**
 * How the engines behave.
 *
 * The product promise is that a reader can upload a book and start listening
 * straight away, so the numbers that matter are how long the first audio
 * takes and how much faster than real time an engine speaks.
 */
const MODELS = ['kokoro', 'piper', 'pocket'] as const

type Measurement = {
  model: string
  voice: string
  loadSeconds: number
  firstAudioSeconds: number
  audioSeconds: number
  generationSeconds: number
  realTimeFactor: number
  segments: number
  error?: string
}

test.describe('engines', () => {
  test('every engine speaks, and speaks fast enough to keep up', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000)

    await page.goto('/')

    const measurements = (await page.evaluate(
      async (models) => {
        // The dev server serves the module; it is not a path on disk.
        // @ts-expect-error - resolved by the dev server at runtime
        const harness = await import('/src/lib/benchmark/harness.ts')
        const results: unknown[] = []
        for (const model of models) {
          results.push(await harness.measureEngine(model))
        }
        return results
      },
      [...MODELS]
    )) as Measurement[]

    console.log('')
    console.log('| Engine | Voice | Load | First audio | Audio | Faster than real time |')
    console.log('| --- | --- | --- | --- | --- | --- |')
    for (const m of measurements) {
      console.log(
        `| ${m.model} | ${m.voice} | ${m.loadSeconds.toFixed(1)}s | ` +
          `${m.firstAudioSeconds.toFixed(1)}s | ${m.audioSeconds.toFixed(1)}s | ` +
          `${m.realTimeFactor.toFixed(1)}x |`
      )
    }
    console.log('')

    expect(measurements).toHaveLength(MODELS.length)

    for (const measurement of measurements) {
      const name = measurement.model
      expect(measurement.error, `${name} failed: ${measurement.error}`).toBeUndefined()

      // The engine spoke every segment.
      expect(measurement.segments, `${name} segments`).toBe(3)
      expect(measurement.audioSeconds, `${name} audio length`).toBeGreaterThan(1)

      // The first audio of a cold run includes the model download, so the
      // bound is generous; the warm run below is the one that has to be
      // immediate.
      expect(measurement.firstAudioSeconds, `${name} cold time to first audio`).toBeLessThan(30)

      // The engine keeps up with the audio it produces.
      expect(measurement.realTimeFactor, `${name} faster than real time`).toBeGreaterThan(0.5)
    }
  })

  test('a model that is already loaded starts speaking at once', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000)

    await page.goto('/')

    const second = (await page.evaluate(
      async (models) => {
        // The dev server serves the module; it is not a path on disk.
        // @ts-expect-error - resolved by the dev server at runtime
        const harness = await import('/src/lib/benchmark/harness.ts')
        const results: unknown[] = []
        for (const model of models) {
          // The first run loads the model; the second one finds it ready.
          await harness.measureEngine(model)
          results.push(await harness.measureEngine(model))
        }
        return results
      },
      [...MODELS]
    )) as Measurement[]

    for (const measurement of second) {
      const name = measurement.model
      expect(measurement.error, `${name} failed: ${measurement.error}`).toBeUndefined()

      // With the model already in memory the first audio is immediate.
      expect(measurement.loadSeconds, `${name} warm load`).toBeLessThan(2)
      expect(measurement.firstAudioSeconds, `${name} warm time to first audio`).toBeLessThan(5)
    }
  })
})
