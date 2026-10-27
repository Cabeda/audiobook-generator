import { test, expect } from '@playwright/test'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { importAndOpen } from '../helpers/flows'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STRUCTURE_HTML = path.join(__dirname, '..', '..', 'example', 'structure.html')

test.describe('Document structure survives import', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('renders the headings, lists, table and picture of an HTML book', async ({ page }) => {
    await importAndOpen(page, STRUCTURE_HTML, /The Lantern Makers/)

    const first = page.locator('section[data-section="0"]')

    // Headings kept inside the chapter, and the title not shown twice.
    await expect(first.locator('h2:not(.chapter-mark)')).toHaveText([
      'Tools of the trade',
      'A week of work',
    ])
    await expect(first.locator('h1')).toHaveCount(0)

    // Real lists, not lines of text.
    await expect(first.locator('ul > li')).toHaveCount(3)
    await expect(first.locator('ol > li')).toHaveCount(3)

    // The table keeps its header and its rows.
    await expect(first.locator('table th')).toHaveText(['Lantern', 'Glass panes', 'Hours'])
    await expect(first.locator('table tbody tr')).toHaveCount(3)

    // The picture is inlined and its caption is shown.
    const image = first.locator('figure img')
    await expect(image).toHaveAttribute('src', /^data:image\/png;base64,/)
    await expect(first.locator('figcaption')).toHaveText('A finished lantern, ready to hang.')

    await expect(first.locator('blockquote')).toContainText('nobody notices is lit')
  })

  test('splits the page at its top-level headings', async ({ page }) => {
    await importAndOpen(page, STRUCTURE_HTML, /The Lantern Makers/)

    await expect(page.locator('section[data-section="1"]')).toContainText(
      'sent back a smaller number'
    )
    await expect(page.locator('section[data-section="1"] h1')).toHaveCount(0)
  })
})
