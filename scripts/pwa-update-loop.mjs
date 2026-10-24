/**
 * PWA update loop.
 *
 * Drives the flow the bug lives in: deploy a new version, click the
 * "update" banner, close the app and open it again. The banner must not come
 * back — the update has to stick.
 *
 *   node scripts/pwa-update-loop.mjs [--keep]
 *
 * Two real builds are made (A and B, marked in index.html), build A is served
 * like production, then the server's directory is swapped to build B to
 * simulate a deploy. --keep reuses previous builds (the drive is seconds; the
 * builds are the slow part).
 */

import { chromium, webkit } from '@playwright/test'
import { execSync } from 'node:child_process'
import { createServer } from 'node:http'
import {
  cpSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs'
import { extname, join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const work = resolve(root, '.pwa-loop')
const port = 4180
const url = `http://localhost:${port}/`
const keep = process.argv.includes('--keep')

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok })
  console.log(`${ok ? '  GREEN' : '  RED  '} ${name}${detail ? ` — ${detail}` : ''}`)
}

// ---- the two deploys -------------------------------------------------------

function build(version, outName) {
  const indexPath = resolve(root, 'index.html')
  const original = readFileSync(indexPath, 'utf-8')
  try {
    writeFileSync(
      indexPath,
      original.replace(
        '</head>',
        `    <meta name="loop-version" content="${version}" />\n  </head>`
      )
    )
    execSync('pnpm build', { cwd: root, stdio: 'pipe' })
    rmSync(resolve(work, outName), { recursive: true, force: true })
    renameSync(resolve(root, 'dist'), resolve(work, outName))
  } finally {
    writeFileSync(indexPath, original)
  }
}

mkdirSync(work, { recursive: true })
if (!(keep && existsSync(join(work, 'distA')) && existsSync(join(work, 'distB')))) {
  console.log('building version A…')
  build('A', 'distA')
  console.log('building version B…')
  build('B', 'distB')
}

// The live deploy starts at A and is swapped to B mid-run.
rmSync(join(work, 'dist'), { recursive: true, force: true })
cpSync(join(work, 'distA'), join(work, 'dist'), { recursive: true })

// ---- the server ------------------------------------------------------------

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.epub': 'application/epub+zip',
}

const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, url).pathname)
  let file = join(work, 'dist', pathname)
  if (pathname === '/' || !extname(pathname)) file = join(work, 'dist', 'index.html')
  try {
    const body = readFileSync(file)
    res.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      // No heuristic caching anywhere: an update check must see the new deploy.
      'Cache-Control': 'no-cache',
    })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
})
await new Promise((done) => server.listen(port, done))

// ---- the drive -------------------------------------------------------------

const browserName =
  process.argv.find((a) => a.startsWith('--browser='))?.split('=')[1] ?? 'chromium'
const engines = { chromium, webkit }

const browser = await engines[browserName].launch()
const context = await browser.newContext()
let page = await context.newPage()

const version = (p) =>
  p.evaluate(() => document.querySelector('meta[name="loop-version"]')?.content ?? null)
// What the update machinery looks like from the page: the banner can only
// recur on reopen if a worker is still stuck in `waiting`.
const swState = (p) =>
  p.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    return {
      installing: reg?.installing?.state ?? null,
      waiting: reg?.waiting?.state ?? null,
      active: reg?.active?.state ?? null,
      controlled: navigator.serviceWorker.controller != null,
    }
  })
// Polls across the automatic reloads an update causes (waitForFunction dies
// with the execution context on navigation).
async function waitFor(cond, ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      if (await cond()) return true
    } catch {
      // page mid-navigation
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}
const sawBanner = (p) => p.evaluate(() => Boolean(window.__sawBanner))

try {
  console.log(`engine: ${browserName}`)
  // The user's sequence: a new version is deployed, the app is closed and
  // opened again. Whatever happens, the new version must run and the update
  // banner must never come back.
  await context.addInitScript(() => {
    // Records whether the "New content available" banner was ever shown on
    // this page — the symptom is a recurring banner, so "never" is the bar.
    window.__sawBanner = false
    setInterval(() => {
      const el = document.querySelector('.pwa-toast')
      if (el && el.getBoundingClientRect().width > 0) window.__sawBanner = true
    }, 200)
  })

  // 1. First launch: version A installs and takes over.
  await page.goto(url)
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
    timeout: 30000,
  })
  await page.waitForFunction(
    () => document.querySelector('meta[name="loop-version"]')?.content === 'A'
  )
  check('first launch runs version A', (await version(page)) === 'A')

  // 2. A new version is deployed. The user closes the app and opens it again.
  rmSync(join(work, 'dist'), { recursive: true, force: true })
  cpSync(join(work, 'distB'), join(work, 'dist'), { recursive: true })
  await page.close()
  page = await context.newPage()
  await page.goto(url)
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
    timeout: 30000,
  })
  // The update applies by itself: poll through the reload that lands on B.
  const sawB = await waitFor(async () => (await version(page)) === 'B', 30000)
  await page.waitForTimeout(3000) // a recurring banner has time to appear
  console.log('  state after reopen:', JSON.stringify(await swState(page)))
  check('reopen runs the new version by itself', sawB)
  check('reopen shows no update banner', !(await sawBanner(page)))

  // 3. Opening again must not bring the banner back (the reported symptom).
  // The previous session is kept alive: iOS suspends a closed PWA's page
  // instead of destroying it, so its client keeps the old worker in control
  // and a pending update stays stuck in `waiting` forever.
  page = await context.newPage()
  await page.goto(url)
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
    timeout: 30000,
  })
  await page.waitForTimeout(3000)
  check('opening again still runs the new version', (await version(page)) === 'B')
  check('opening again shows no banner', !(await sawBanner(page)))
} catch (error) {
  check('the update flow completes', false, String(error).split('\n')[0])
} finally {
  await browser.close()
  server.close()
}

const failed = checks.filter((c) => !c.ok)
console.log(
  failed.length === 0
    ? '\nPASS: the update sticks'
    : `\nFAIL: ${failed.length} of ${checks.length} checks red`
)
process.exit(failed.length === 0 ? 0 : 1)
