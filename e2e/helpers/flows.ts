/**
 * UI flows for the "option A" reader shell (App.svelte + src/ui/*).
 *
 * The app opens straight into the reader (or its empty state); everything else
 * is an overlay. These helpers walk the real user paths: import a book, open
 * the Aa settings panel, the books overlay, the export sheet and the activity
 * centre. The old landing page selectors live nowhere any more.
 */

import { expect } from '@playwright/test'
import type { Download, Locator, Page } from '@playwright/test'

type FilePayload = Parameters<Locator['setInputFiles']>[0]

/** Clears IndexedDB and web storage so the app starts with an empty library. */
export async function clearAppStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const databases = await indexedDB.databases()
    await Promise.all(
      databases.map(
        (database) =>
          new Promise<void>((resolve) => {
            if (!database.name) return resolve()
            const request = indexedDB.deleteDatabase(database.name as string)
            request.onsuccess = () => resolve()
            request.onerror = () => resolve()
            request.onblocked = () => resolve()
          })
      )
    )
    localStorage.clear()
    sessionStorage.clear()
  })
}

/** The ImportPanel ("Add a book"). */
export function importPanel(page: Page): Locator {
  return page.locator('[role="dialog"][aria-label="Add a book"]')
}

/** Opens the import panel from the empty state or the chapter TOC. */
export async function openImportPanel(page: Page): Promise<void> {
  const panel = importPanel(page)
  if (await panel.isVisible().catch(() => false)) return

  // Wait for the shell to render: isVisible does not retry, and a choice made
  // before the app mounts walks into the wrong branch and auto-waits forever.
  const emptyCta = page.locator('.empty-cta')
  const tocButton = page.locator('button[aria-label="Table of contents"]')
  await expect(emptyCta.or(tocButton).first()).toBeVisible({ timeout: 15000 })

  if (await emptyCta.isVisible().catch(() => false)) {
    await emptyCta.click()
  } else {
    await tocButton.click()
    await page.locator('.import-chip').click()
  }
  await expect(panel).toBeVisible()
}

/**
 * Imports a book through the import panel. The imported book opens in the
 * reader straight away.
 */
export async function importBookFile(page: Page, file: FilePayload): Promise<void> {
  await openImportPanel(page)
  await importPanel(page).locator('.drop input[type="file"]').setInputFiles(file)
}

/** Imports a book and waits for it to be open on the reading surface. */
export async function importAndOpen(page: Page, file: FilePayload, title: RegExp): Promise<void> {
  await importBookFile(page, file)
  await expect(page.locator('.book-title')).toContainText(title, { timeout: 30000 })
  await expect(page.locator('.segment').first()).toBeVisible({ timeout: 15000 })
}

/** The reader's Aa settings panel (per-book: model, voice, generate, export). */
export function settingsPanel(page: Page): Locator {
  return page.locator('aside.settings')
}

/** Opens the Aa settings panel from the reader top bar. */
export async function openSettingsPanel(page: Page): Promise<void> {
  if (
    await settingsPanel(page)
      .isVisible()
      .catch(() => false)
  )
    return
  await page.locator('button[aria-label="Settings"]').click()
  await expect(settingsPanel(page)).toBeVisible()
}

/** Closes the Aa settings panel. */
export async function closeOverlay(page: Page): Promise<void> {
  const close = page.locator('[aria-label="Close"]:visible').first()
  if (await close.isVisible().catch(() => false)) await close.click()
}

/** Picks a TTS model in the Aa settings panel (options come from MODEL_OPTIONS). */
export async function setTtsModel(page: Page, model: string): Promise<void> {
  await openSettingsPanel(page)
  await settingsPanel(page).locator('label.field:has-text("Model") select').selectOption(model)
  await closeOverlay(page)
}

/** The Books overlay ("Your books"), reachable from the title button. */
export function booksOverlay(page: Page): Locator {
  return page.locator('section[aria-label="Books"]')
}

export async function openBooksOverlay(page: Page): Promise<void> {
  const emptyBooks = page.locator('.empty-link', { hasText: 'Your books' })
  if (await emptyBooks.isVisible().catch(() => false)) {
    await emptyBooks.click()
  } else {
    await page.locator('button[aria-label="Books"]').click()
  }
  await expect(booksOverlay(page)).toBeVisible()
}

/** The activity centre (QueueCenter). */
export function queueCenter(page: Page): Locator {
  return page.locator('section[aria-label="Generation activity"]')
}

export async function openQueueCenter(page: Page): Promise<void> {
  const prep = page.locator('.prep')
  if (await prep.isVisible().catch(() => false)) {
    await prep.click()
  } else {
    await openBooksOverlay(page)
    await page.locator('button[aria-label="Generation activity"]').click()
  }
  await expect(queueCenter(page)).toBeVisible()
}

/** The ExportSheet, opened from the Aa panel ("Export audiobook…"). */
export function exportSheet(page: Page): Locator {
  return page.locator('[role="dialog"][aria-label="Export audiobook"]')
}

export async function openExportSheet(page: Page): Promise<void> {
  const sheet = exportSheet(page)
  if (await sheet.isVisible().catch(() => false)) return
  await openSettingsPanel(page)
  await settingsPanel(page).locator('button:has-text("Export audiobook")').click()
  await expect(sheet).toBeVisible()
}

/**
 * Chooses a format in the export sheet and exports, resolving with the
 * download that the export triggers.
 */
export async function exportAs(
  page: Page,
  format: 'mp3' | 'm4b' | 'mp4' | 'wav' | 'epub'
): Promise<{ filename: string; download: Download }> {
  const sheet = exportSheet(page)
  await sheet.locator('label.field:has-text("Format") select').selectOption(format)
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 300000 }),
    sheet.locator('button.go').click(),
  ])
  await expect(sheet.locator('.done')).toBeVisible({ timeout: 300000 })
  return { filename: download.suggestedFilename(), download }
}

/** Waits until no chapter is generating any more (the prep strip is gone). */
export async function waitForGenerationIdle(page: Page): Promise<void> {
  await expect(page.locator('.prep')).toBeHidden({ timeout: 3600000 })
}
