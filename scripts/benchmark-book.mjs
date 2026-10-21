/**
 * Book benchmark.
 *
 * Processes a whole book with each speech engine and writes how long each one
 * took. The engines run in a real browser page — they use onnxruntime-web —
 * but the harness drives the modules directly, so nothing here depends on the
 * user interface.
 *
 *   node scripts/benchmark-book.mjs [--book path.epub] [--models kokoro,piper,pocket]
 *                                   [--max-chapters N] [--max-segments N] [--out dir]
 */

import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const args = {
    book: 'books/arthur-conan-doyle_the-sign-of-the-four_advanced.epub',
    models: ['kokoro', 'piper', 'pocket'],
    maxChapters: undefined,
    maxSegments: undefined,
    budgetSeconds: undefined,
    encodeFormats: false,
    out: 'benchmark',
    baseUrl: process.env.BENCHMARK_BASE_URL ?? 'http://localhost:5173',
  }

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    switch (flag) {
      case '--book':
        args.book = value
        i++
        break
      case '--models':
        args.models = value
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean)
        i++
        break
      case '--max-chapters':
        args.maxChapters = Number(value)
        i++
        break
      case '--max-segments':
        args.maxSegments = Number(value)
        i++
        break
      case '--budget-seconds':
        args.budgetSeconds = Number(value)
        i++
        break
      case '--encode':
        args.encodeFormats = true
        break
      case '--out':
        args.out = value
        i++
        break
      case '--base-url':
        args.baseUrl = value
        i++
        break
      default:
        break
    }
  }

  return args
}

async function isReachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return response.ok
  } catch {
    return false
  }
}

async function startDevServer() {
  const server = spawn('npx', ['vite', '--port', '5173'], {
    cwd: root,
    stdio: 'ignore',
    detached: false,
  })
  server.unref?.()

  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((r) => setTimeout(r, 500))
    if (await isReachable('http://localhost:5173/')) return server
  }

  server.kill()
  throw new Error('The dev server did not come up')
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${rest}s`
}

function reportToMarkdown(report) {
  const lines = [
    `# Book benchmark — ${report.book}`,
    '',
    `Started: ${report.startedAt}`,
    `Total wall clock: ${formatDuration(report.totalSeconds)}`,
    '',
    '| Engine | Voice | Chapters | Segments | Audio | Generation | Encode | Faster than real time | Whole book | MP3 | M4B |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]

  for (const model of report.models) {
    if (model.error) {
      lines.push(`| ${model.model} | ${model.voice} | — | — | — | — | — | — | — | — | — |`)
      lines.push('')
      lines.push(`> **${model.model} failed:** ${model.error}`)
      continue
    }
    const whole = model.complete
      ? formatDuration(model.estimatedTotalSeconds)
      : `~${formatDuration(model.estimatedTotalSeconds)} (estimated)`
    lines.push(
      `| ${model.model} | ${model.voice} | ${model.chapters} | ${model.segments} | ` +
        `${formatDuration(model.audioSeconds)} | ${formatDuration(model.generationSeconds)} | ` +
        `${formatDuration(model.exportSeconds)} | ${model.realTimeFactor.toFixed(1)}x | ${whole} | ` +
        `${(model.mp3Bytes / 1e6).toFixed(1)} MB | ${(model.m4bBytes / 1e6).toFixed(1)} MB |`
    )
    const failures = model.chapterErrors ?? []
    if (failures.length > 0) {
      lines.push('')
      lines.push(
        `> **${model.model} could not speak ${failures.length} of the chapters.** ` +
          'The first failure was: ' +
          failures[0].error.split('\n')[0]
      )
    }
  }

  lines.push('')
  lines.push(
    '"Faster than real time" is the length of the generated audio per second of generation.'
  )
  lines.push('"Whole book" is the time the whole book takes, measured or estimated from the run.')
  lines.push('')
  return lines.join('\n')
}

const args = parseArgs(process.argv.slice(2))
const bookPath = resolve(root, args.book)

if (!existsSync(bookPath)) {
  console.error(`No such book: ${bookPath}`)
  process.exit(1)
}

let server = null
if (!(await isReachable(args.baseUrl))) {
  console.log('Starting the dev server...')
  server = await startDevServer()
}

console.log(`Benchmarking ${args.book} with: ${args.models.join(', ')}`)

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('console', (message) => {
  const text = message.text()
  if (message.type() === 'error') console.error(`  [page] ${text.slice(0, 200)}`)
  else if (text.startsWith('  ')) console.log(text)
})

await page.goto(args.baseUrl)

// The dev server serves the books folder, so the page can fetch the book
// itself instead of shipping a megabyte of bytes through the protocol.
const bookUrl = `/${args.book.replace(/^\//, '')}`

const report = await page.evaluate(
  async ({ url, name, models, maxChapters, maxSegments, budgetSeconds, encodeFormats }) => {
    const harness = await import('/src/lib/benchmark/harness.ts')
    const response = await fetch(url)
    const book = await response.arrayBuffer()
    return harness.benchmarkBook({
      book,
      name,
      models,
      maxChapters,
      maxSegments,
      budgetSeconds,
      encodeFormats,
      onProgress: (progress) => {
        console.log(
          `  ${progress.model} ${progress.phase} ${progress.done}/${progress.total}` +
            (progress.chapter ? ` ${progress.chapter}` : '')
        )
      },
    })
  },
  {
    url: bookUrl,
    name: args.book.split('/').pop(),
    models: args.models,
    maxChapters: args.maxChapters,
    maxSegments: args.maxSegments,
    budgetSeconds: args.budgetSeconds,
    encodeFormats: args.encodeFormats,
  }
)

await browser.close()
server?.kill()

const outDir = resolve(root, args.out)
await mkdir(outDir, { recursive: true })
const stamp = report.startedAt.replace(/[:.]/g, '-')
await writeFile(resolve(outDir, `book-benchmark-${stamp}.json`), JSON.stringify(report, null, 2))
await writeFile(resolve(outDir, 'latest.json'), JSON.stringify(report, null, 2))
await writeFile(resolve(outDir, 'latest.md'), reportToMarkdown(report))

console.log('')
console.log(reportToMarkdown(report))
console.log(`Report written to ${resolve(outDir, 'latest.md')}`)

// The dev server we started keeps the process alive; leave cleanly.
process.exit(0)
