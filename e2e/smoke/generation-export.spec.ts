import { test, expect } from '@playwright/test'
import { join } from 'path'
import process from 'node:process'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

/**
 * Generation & Export smoke test.
 *
 * Uses Piper TTS (small model, fast generation) to generate a single
 * short chapter, then exports as each format to verify the full pipeline.
 * First run downloads the voice model (~5MB), subsequent runs use cache.
 */
test.describe('Generation & Export', () => {
  test.describe.configure({ timeout: 120000 })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Upload EPUB
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SHORT_EPUB)
    await expect(page.getByRole('heading', { name: 'Short Test Book' })).toBeVisible({
      timeout: 10000,
    })

    // Switch to Piper TTS (smaller model, faster than Kokoro)
    const modelSelect = page.locator('.toolbar-left .premium-select').first()
    await modelSelect.selectOption('piper')

    // Select only first chapter
    await page.getByRole('button', { name: 'Deselect All', exact: true }).click()
    await page.locator('input[type="checkbox"]').first().check()
  })

  test('should generate a chapter and export as MP3', async ({ page }) => {
    await page.getByRole('button', { name: 'Generate Selected' }).click()
    await expect(page.getByText('✓ Generated')).toBeVisible({ timeout: 90000 })

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('button', { name: /Export MP3/i }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.mp3$/i)
  })

  test('should export as WAV', async ({ page }) => {
    await page.getByRole('button', { name: 'Generate Selected' }).click()
    await expect(page.getByText('✓ Generated')).toBeVisible({ timeout: 90000 })

    await page.getByRole('button', { name: 'Choose export format' }).click()
    await page.getByRole('menuitem', { name: 'WAV' }).click()

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('button', { name: /Export WAV/i }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.wav$/i)
  })

  test('should export as M4B', async ({ page }) => {
    await page.getByRole('button', { name: 'Generate Selected' }).click()
    await expect(page.getByText('✓ Generated')).toBeVisible({ timeout: 90000 })

    await page.getByRole('button', { name: 'Choose export format' }).click()
    await page.getByRole('menuitem', { name: 'M4B Audiobook' }).click()

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('button', { name: /Export M4B/i }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.m4b$/i)
  })

  test('should export valid EPUB with correct structure and media overlays', async ({ page }) => {
    await page.getByRole('button', { name: 'Generate Selected' }).click()
    await expect(page.getByText('✓ Generated')).toBeVisible({ timeout: 90000 })

    await page.getByRole('button', { name: 'Choose export format' }).click()
    await page.getByRole('menuitem', { name: 'EPUB' }).click()

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('button', { name: /Export EPUB/i }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.epub$/i)

    // --- EPUB Structure Validation ---
    const fs = await import('fs/promises')
    const JSZip = (await import('jszip')).default
    const downloadPath = await download.path()
    expect(downloadPath).toBeTruthy()

    const buffer = await fs.readFile(downloadPath!)
    const zip = await JSZip.loadAsync(buffer)

    // Mimetype
    const mimetype = await zip.file('mimetype')?.async('string')
    expect(mimetype).toBe('application/epub+zip')

    // Container
    const container = await zip.file('META-INF/container.xml')?.async('string')
    expect(container).toContain('rootfile')

    // OPF
    const opfFiles = Object.keys(zip.files).filter((f) => f.endsWith('.opf'))
    expect(opfFiles.length).toBeGreaterThanOrEqual(1)
    const opf = await zip.file(opfFiles[0])?.async('string')
    expect(opf).toContain('<manifest')
    expect(opf).toContain('<spine')

    // Content files
    const xhtmlFiles = Object.keys(zip.files).filter(
      (f) => f.endsWith('.xhtml') || f.endsWith('.html')
    )
    expect(xhtmlFiles.length).toBeGreaterThanOrEqual(1)

    // SMIL + audio files exist
    const smilFiles = Object.keys(zip.files).filter((f) => f.endsWith('.smil'))
    expect(smilFiles.length).toBeGreaterThanOrEqual(1)
    const audioFiles = Object.keys(zip.files).filter(
      (f) => f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.m4a')
    )
    expect(audioFiles.length).toBeGreaterThanOrEqual(1)

    // --- Media Overlay Validation ---
    // Verify each SMIL correctly maps text segments to audio clips
    for (const smilPath of smilFiles) {
      const smilContent = await zip.file(smilPath)!.async('string')

      // Extract all <text src="..."/> and <audio src="..." clipBegin="..." clipEnd="..."/>
      const textRefs = [...smilContent.matchAll(/<text\s+src="([^"]+)"/g)]
      const audioRefs = [
        ...smilContent.matchAll(
          /<audio\s+src="([^"]+)"\s+clipBegin="([^"]+)"\s+clipEnd="([^"]+)"/g
        ),
      ]

      // Every par must have both a text and audio reference
      expect(textRefs.length).toBeGreaterThan(0)
      expect(audioRefs.length).toBe(textRefs.length)

      // Resolve the XHTML file referenced by text elements
      const xhtmlSrc = textRefs[0][1].split('#')[0]
      const xhtmlBasename = xhtmlSrc.split('/').pop()!
      const xhtmlFile = Object.keys(zip.files).find((f) => f.endsWith(xhtmlBasename))
      expect(xhtmlFile).toBeTruthy()
      const xhtmlContent = await zip.file(xhtmlFile!)!.async('string')

      // Each text fragment ID must exist in the XHTML
      for (const textRef of textRefs) {
        const fragment = textRef[1].split('#')[1]
        if (fragment) {
          expect(xhtmlContent).toContain(`id="${fragment}"`)
        }
      }

      // Audio file referenced by SMIL must exist in the ZIP
      const audioSrc = audioRefs[0][1]
      const audioBasename = audioSrc.split('/').pop()!
      const audioExists = Object.keys(zip.files).some((f) => f.endsWith(audioBasename))
      expect(audioExists).toBe(true)

      // Clip times must be valid and sequential (no gaps/overlaps)
      let lastClipEnd = 0
      for (const audioRef of audioRefs) {
        const clipBegin = parseFloat(audioRef[2])
        const clipEnd = parseFloat(audioRef[3])
        expect(clipEnd).toBeGreaterThan(clipBegin)
        expect(clipBegin).toBeGreaterThanOrEqual(lastClipEnd - 0.001) // float tolerance
        lastClipEnd = clipEnd
      }
    }
  })

  // Known bug: SMIL clip times are calculated from WAV segment durations,
  // but the concatenated MP3 has different total duration due to encoding
  // padding. This causes audio-text drift that worsens over longer chapters.
  test.fail('should have SMIL timing match actual MP3 duration (drift bug)', async ({ page }) => {
    await page.getByRole('button', { name: 'Generate Selected' }).click()
    await expect(page.getByText('✓ Generated')).toBeVisible({ timeout: 90000 })

    await page.getByRole('button', { name: 'Choose export format' }).click()
    await page.getByRole('menuitem', { name: 'EPUB' }).click()

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('button', { name: /Export EPUB/i }).click(),
    ])

    const fs = await import('fs/promises')
    const JSZip = (await import('jszip')).default
    const buffer = await fs.readFile((await download.path())!)
    const zip = await JSZip.loadAsync(buffer)

    const smilFiles = Object.keys(zip.files).filter((f) => f.endsWith('.smil'))
    for (const smilPath of smilFiles) {
      const smilContent = await zip.file(smilPath)!.async('string')
      const audioRefs = [
        ...smilContent.matchAll(
          /<audio\s+src="([^"]+)"\s+clipBegin="([^"]+)"\s+clipEnd="([^"]+)"/g
        ),
      ]

      // Get last clipEnd = total SMIL duration
      const lastClipEnd = parseFloat(audioRefs[audioRefs.length - 1]?.[3] ?? '0')

      // Parse MP3 duration from the audio file
      const audioSrc = audioRefs[0][1]
      const audioBasename = audioSrc.split('/').pop()!
      const audioFile = Object.keys(zip.files).find((f) => f.endsWith(audioBasename))!
      const audioBuffer = await zip.file(audioFile)!.async('uint8array')

      let mp3Duration = 0
      for (let i = 0; i < audioBuffer.length - 4; i++) {
        if (audioBuffer[i] === 0xff && (audioBuffer[i + 1] & 0xe0) === 0xe0) {
          const header =
            (audioBuffer[i] << 24) |
            (audioBuffer[i + 1] << 16) |
            (audioBuffer[i + 2] << 8) |
            audioBuffer[i + 3]
          const bitrateIndex = (header >> 12) & 0x0f
          const sampleRateIndex = (header >> 10) & 0x03
          const mpegVersion = (header >> 19) & 0x03

          if (bitrateIndex > 0 && bitrateIndex < 15 && sampleRateIndex < 3) {
            const bitrates = [0, 32, 40, 48, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
            const sampleRates = mpegVersion === 3 ? [44100, 48000, 32000] : [22050, 24000, 16000]
            const bitrate = bitrates[bitrateIndex] * 1000

            if (bitrate > 0 && sampleRates[sampleRateIndex] > 0) {
              mp3Duration = (audioBuffer.length - i) / (bitrate / 8)
              break
            }
          }
        }
      }

      // SMIL total duration should be within 5% of actual MP3 duration
      if (mp3Duration > 0 && lastClipEnd > 0) {
        const driftRatio = Math.abs(lastClipEnd - mp3Duration) / mp3Duration
        expect(driftRatio).toBeLessThan(0.05)
      }
    }
  })
})
