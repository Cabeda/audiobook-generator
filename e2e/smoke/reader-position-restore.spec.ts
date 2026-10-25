import { test, expect } from '@playwright/test'
import { join } from 'path'
import process from 'node:process'

import { importAndOpen } from '../helpers/flows'

const EPUB = join(process.cwd(), 'books', 'arthur-conan-doyle_the-sign-of-the-four_advanced.epub')

/**
 * The exact spot the reader is looking at: the topmost visible sentence and
 * its pixel distance from the top of the reading area. "Reopen exactly where
 * I was" means this triple is unchanged.
 */
async function readingSpot(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('.reader') as HTMLElement
    const top = scroller.getBoundingClientRect().top
    const segments = [...scroller.querySelectorAll('.segment')]
    const first = segments.find((el) => el.getBoundingClientRect().bottom > top + 1)
    if (!first) return null
    return {
      section: first.closest('[data-section]')?.getAttribute('data-section') ?? null,
      segment: first.getAttribute('data-segment-index') ?? null,
      offset: Math.round(first.getBoundingClientRect().top - top),
    }
  })
}

/** Scrolls down like a reader, in steps, so lazily rendered chapters catch up. */
async function scrollDeep(page: import('@playwright/test').Page, fraction: number) {
  await page.evaluate(async (target) => {
    const scroller = document.querySelector('.reader') as HTMLElement
    const wanted = target * (scroller.scrollHeight - scroller.clientHeight)
    for (let i = 0; i < 200 && scroller.scrollTop < wanted - 4; i++) {
      scroller.scrollTop = Math.min(wanted, scroller.scrollTop + scroller.clientHeight * 0.8)
      await new Promise((r) => setTimeout(r, 60))
    }
  }, fraction)
}

test.describe('Reader position restore', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await importAndOpen(page, EPUB, /Sign/i)
  })

  test('closing right after scrolling reopens exactly there', async ({ page }) => {
    await scrollDeep(page, 0.5)
    const before = await readingSpot(page)
    expect(before).not.toBeNull()

    // close the device and reopen it
    await page.reload()
    await expect(page.locator('.segment').first()).toBeVisible({ timeout: 30000 })
    await page.waitForTimeout(1000) // let the restore settle

    expect(await readingSpot(page)).toEqual(before)
  })

  test('a scroll that was read for a while reopens exactly there', async ({ page }) => {
    await scrollDeep(page, 0.5)
    const before = await readingSpot(page)
    expect(before).not.toBeNull()

    await page.waitForTimeout(3500) // the reader pauses to read, then closes

    await page.reload()
    await expect(page.locator('.segment').first()).toBeVisible({ timeout: 30000 })
    await page.waitForTimeout(1000)

    expect(await readingSpot(page)).toEqual(before)
  })
})
