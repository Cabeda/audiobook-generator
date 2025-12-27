/**
 * Benchmark: Kokoro TTS chunk generation latency
 *
 * Measures the time to generate N chunks of 500-2000 characters
 * Reports: min, max, mean, median latency and throughput
 */

import { generateVoice, type GenerateParams } from '../src/lib/kokoro/kokoroClient'

// Test text samples of varying lengths
const TEXT_SAMPLES = [
  // 500 chars
  'The quick brown fox jumps over the lazy dog. ' +
    'This is a test of the text-to-speech system with approximately five hundred characters. ' +
    'We need to ensure that the benchmark captures realistic performance metrics. ' +
    'The system should handle various types of content including dialogue, descriptions, and narrative text. ' +
    'Performance measurements help us identify bottlenecks and optimize the generation pipeline for better user experience. ' +
    'This sample text is designed to be long enough to trigger chunking logic while remaining manageable for quick testing.',

  // 1000 chars
  'In the beginning, there was only darkness and silence. Then came the first spark of consciousness, ' +
    'a tiny flicker of awareness in the vast emptiness of space. This consciousness grew and evolved, ' +
    'learning to perceive the world around it through senses it did not yet fully understand. ' +
    'Time passed differently in those early days, stretching and compressing in ways that defied comprehension. ' +
    'The entity that would later be known as humanity took its first tentative steps into existence, ' +
    'driven by curiosity and the innate desire to survive and thrive. Knowledge accumulated slowly at first, ' +
    'then with increasing speed as each generation built upon the discoveries of those who came before. ' +
    'Language emerged as a tool for sharing these discoveries, allowing ideas to spread beyond the limitations ' +
    'of individual experience. Writing preserved knowledge across time, creating a bridge between past and future. ' +
    'Technology amplified human capabilities, extending reach and enabling feats once thought impossible.',

  // 1500 chars
  'The ancient library stood at the heart of the city, its towering walls a testament to centuries of accumulated wisdom. ' +
    'Within its halls, countless volumes lined the shelves, their spines bearing titles in dozens of languages, ' +
    'some long forgotten by the modern world. Scholars from distant lands made pilgrimages to study here, ' +
    'seeking answers to questions that had puzzled humanity for generations. The head librarian, a woman of ' +
    'remarkable intellect and patience, guided visitors through the labyrinthine collections, her knowledge ' +
    'of the catalog system bordering on supernatural. Each section of the library held its own treasures: ' +
    'ancient manuscripts detailing lost civilizations, scientific treatises that revolutionized understanding, ' +
    'philosophical works that challenged conventional thinking, and literary masterpieces that captured the ' +
    'human experience across all its dimensions. The building itself was a work of art, with soaring ceilings ' +
    'adorned with frescoes depicting scenes from myth and history. Natural light filtered through stained glass ' +
    'windows, casting colorful patterns across reading tables where students and researchers bent over their work. ' +
    'The scent of old paper and leather bindings filled the air, a perfume that lovers of books found intoxicating. ' +
    'In the digital age, this physical repository of knowledge represented something more than mere information storage; ' +
    'it embodied the tactile, sensory experience of learning and discovery.',

  // 2000 chars
  'The expedition had been planning for months, gathering supplies and assembling a team of experts from various ' +
    'fields of study. Their destination was a remote valley, hidden deep within an uncharted mountain range, ' +
    'where satellite imagery had revealed unusual geological formations that defied easy explanation. ' +
    'As they made their way through increasingly difficult terrain, the team encountered challenges that tested ' +
    'their resolve and ingenuity. Harsh weather conditions, equipment failures, and the sheer physical demands ' +
    'of the journey pushed everyone to their limits. Yet they pressed on, driven by scientific curiosity and ' +
    'the promise of groundbreaking discoveries. When they finally reached the valley, what they found exceeded ' +
    'their wildest expectations. Structures of obvious artificial origin rose from the valley floor, their design ' +
    'unlike anything in the historical record. The architectural style suggested an advanced understanding of ' +
    'engineering principles, with load-bearing elements positioned with mathematical precision. More intriguing ' +
    'still were the inscriptions covering many surfaces, a writing system that bore no resemblance to any known ' +
    'language, ancient or modern. The archaeologists on the team immediately began documenting everything, ' +
    'taking photographs and measurements while the linguists attempted to discern patterns in the mysterious script. ' +
    'Carbon dating samples would later reveal that these structures were far older than any previously known ' +
    'civilization, raising profound questions about human history and development. The discovery would spark ' +
    'heated debates in academic circles, with some hailing it as evidence of a lost chapter in human evolution, ' +
    'while skeptics demanded more rigorous proof. News of the find eventually reached the public, capturing ' +
    'imaginations worldwide and inspiring a new generation of explorers and researchers. The valley itself became ' +
    'a protected site, with ongoing excavations revealing new mysteries year after year, each answer generating ' +
    'a dozen more questions about who built these structures, why they were abandoned, and what happened to their creators.',
]

export interface BenchmarkStats {
  min: number
  max: number
  mean: number
  median: number
}

export interface KokoroLatencyResult {
  textLength: number
  iterations: number
  latency: BenchmarkStats
  avgBlobSize: number
  throughput: number
}

/**
 * Calculate statistics from an array of numbers
 */
function calculateStats(values: number[]): BenchmarkStats {
  const sorted = [...values].sort((a, b) => a - b)
  const sum = values.reduce((acc, val) => acc + val, 0)
  const mean = sum / values.length
  let median: number
  if (sorted.length % 2 === 0) {
    const mid1 = sorted.length / 2 - 1
    const mid2 = sorted.length / 2
    median = (sorted[mid1] + sorted[mid2]) / 2
  } else {
    median = sorted[Math.floor(sorted.length / 2)]
  }
  const min = sorted[0]
  const max = sorted[sorted.length - 1]

  return { min, max, mean, median }
}

/**
 * Format time in milliseconds
 */
function formatMs(ms: number): string {
  return `${ms.toFixed(2)}ms`
}

/**
 * Run benchmark for a single text sample
 * @param text - Text to generate audio from
 * @param iterations - Number of iterations to run (default: 3)
 * @returns Object containing arrays of latencies (ms) and blob sizes (bytes)
 */
async function benchmarkSample(
  text: string,
  iterations: number = 3
): Promise<{ latencies: number[]; sizes: number[] }> {
  const latencies: number[] = []
  const sizes: number[] = []

  console.log(`\n  Testing ${text.length} char text (${iterations} iterations)...`)

  for (let i = 0; i < iterations; i++) {
    const start = performance.now()

    try {
      const params: GenerateParams = {
        text,
        voice: 'af_heart',
        speed: 1.0,
        device: 'wasm', // Use WASM for reproducible benchmarks
      }
      const audioBlob = await generateVoice(params)

      const end = performance.now()
      const latency = end - start

      latencies.push(latency)
      sizes.push(audioBlob.size)

      console.log(`    Iteration ${i + 1}: ${formatMs(latency)} (${audioBlob.size} bytes)`)
    } catch (error) {
      console.error(`    Iteration ${i + 1} failed:`, (error as Error).message)
      throw error
    }
  }

  return { latencies, sizes }
}

/**
 * Main benchmark function for Kokoro TTS latency measurement
 * @param options - Benchmark configuration options
 * @param options.iterations - Number of iterations per sample (default: 3)
 * @param options.samples - Array of text samples to test (default: TEXT_SAMPLES)
 * @returns Array of benchmark results with latency statistics and throughput
 */
export async function runKokoroLatencyBenchmark(
  options: {
    iterations?: number
    samples?: string[]
  } = {}
): Promise<KokoroLatencyResult[]> {
  const { iterations = 3, samples = TEXT_SAMPLES } = options

  console.log('='.repeat(60))
  console.log('Kokoro TTS Chunk Generation Latency Benchmark')
  console.log('='.repeat(60))
  console.log(`Iterations per sample: ${iterations}`)
  console.log(`Text samples: ${samples.length}`)
  console.log(`Device: WASM (for reproducibility)`)

  const results: KokoroLatencyResult[] = []

  for (const text of samples) {
    const { latencies, sizes } = await benchmarkSample(text, iterations)
    const stats = calculateStats(latencies)
    const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length
    const throughput = text.length / (stats.mean / 1000) // chars per second

    results.push({
      textLength: text.length,
      iterations,
      latency: stats,
      avgBlobSize: avgSize,
      throughput,
    })
  }

  // Print summary
  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log()
  console.log('Text Length | Min      | Max      | Mean     | Median   | Throughput')
  console.log('-'.repeat(75))

  for (const result of results) {
    const { textLength, latency, throughput } = result
    console.log(
      `${String(textLength).padEnd(11)} | ` +
        `${formatMs(latency.min).padEnd(8)} | ` +
        `${formatMs(latency.max).padEnd(8)} | ` +
        `${formatMs(latency.mean).padEnd(8)} | ` +
        `${formatMs(latency.median).padEnd(8)} | ` +
        `${throughput.toFixed(0)} chars/s`
    )
  }

  console.log()

  return results
}
