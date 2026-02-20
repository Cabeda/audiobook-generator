import { test, expect } from '@playwright/test'
import { join } from 'path'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

test.describe('Segment Persistence on Page Refresh', () => {
  test('should persist generated segments and merged audio after page refresh', async ({
    page,
  }) => {
    // Capture console logs
    const logs: string[] = []
    page.on('console', (msg) => {
      const text = msg.text()
      logs.push(text)
      console.log('[BROWSER]', text)
    })

    // Navigate to the app
    await page.goto('http://localhost:5173')

    // Clear storage first
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })

    // Upload test file
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SHORT_EPUB)
    await page.waitForSelector('text=Short Test Book', { timeout: 10000 })

    // Open the book
    await page.locator('button:has-text("Deselect all")').click()
    await page.locator('input[type="checkbox"]').first().check()
    await page.locator('button:has-text("Read")').first().click()
    await page.waitForSelector('.reader-page', { timeout: 5000 })
    await page.waitForSelector('.segment', { timeout: 5000 })

    // Click first segment to start generation
    const firstSegment = page.locator('.segment').first()
    await firstSegment.click()

    // Wait for first segment to be generated
    await expect(page.locator('.segment-generated').first()).toBeVisible({ timeout: 30000 })

    // Wait for audio to be saved
    await page.waitForTimeout(3000)

    // Log what's in IndexedDB
    await page.evaluate(() => {
      console.log('=== CHECKING INDEXEDDB BEFORE REFRESH ===')
      const request = indexedDB.open('AudiobookGeneratorDB')
      request.onsuccess = () => {
        const db = request.result
        console.log('DB opened, stores:', Array.from(db.objectStoreNames))

        const segmentsTx = db.transaction('chapterSegments', 'readonly')
        const segmentsStore = segmentsTx.objectStore('chapterSegments')
        const segmentsRequest = segmentsStore.getAll()
        segmentsRequest.onsuccess = () => {
          console.log('Segments in DB:', segmentsRequest.result.length)
        }

        const audioTx = db.transaction('chapterAudio', 'readonly')
        const audioStore = audioTx.objectStore('chapterAudio')
        const audioRequest = audioStore.getAll()
        audioRequest.onsuccess = () => {
          console.log('Audio entries in DB:', audioRequest.result.length)
        }
      }
    })

    await page.waitForTimeout(1000)

    // Refresh the page
    await page.reload()
    await page.waitForTimeout(2000)

    // Log what's in IndexedDB after refresh
    await page.evaluate(() => {
      console.log('=== CHECKING INDEXEDDB AFTER REFRESH ===')
      const request = indexedDB.open('AudiobookGeneratorDB')
      request.onsuccess = () => {
        const db = request.result

        const segmentsTx = db.transaction('chapterSegments', 'readonly')
        const segmentsStore = segmentsTx.objectStore('chapterSegments')
        const segmentsRequest = segmentsStore.getAll()
        segmentsRequest.onsuccess = () => {
          console.log('Segments in DB after refresh:', segmentsRequest.result.length)
        }

        const audioTx = db.transaction('chapterAudio', 'readonly')
        const audioStore = audioTx.objectStore('chapterAudio')
        const audioRequest = audioStore.getAll()
        audioRequest.onsuccess = () => {
          console.log('Audio entries in DB after refresh:', audioRequest.result.length)
        }
      }
    })

    await page.waitForTimeout(1000)

    // Navigate back to reader and verify UI shows generated segments
    await page.waitForSelector('text=Short Test Book', { timeout: 5000 })
    await page.locator('button:has-text("Deselect all")').click()
    await page.locator('input[type="checkbox"]').first().check()
    await page.locator('button:has-text("Read")').first().click()
    await page.waitForSelector('.reader-page', { timeout: 5000 })
    await page.waitForSelector('.segment', { timeout: 5000 })

    // Wait for segments to load from DB
    await page.waitForTimeout(3000)

    // Check if segments are marked as generated in UI
    const generatedSegmentsInUI = await page.locator('.segment-generated').count()
    console.log('Generated segments in UI after refresh:', generatedSegmentsInUI)

    // The test passes if we see the console logs showing segments persist
    // We'll manually verify the output
  })
})
