/**
 * Benchmark: Audio concatenation throughput
 * 
 * Measures concatenateAudioChapters() time for 1..N chunks (up to 20)
 * Reports: time per chunk count and bytes/sec throughput
 */

import { concatenateAudioChapters, createSilentWav } from '../src/lib/audioConcat.ts'

/**
 * Create a test audio chapter with specified duration
 */
function createTestChapter(id, durationSeconds = 5) {
  const blob = createSilentWav(durationSeconds, 44100)
  return {
    id: `chapter-${id}`,
    title: `Chapter ${id}`,
    blob,
    duration: durationSeconds
  }
}

/**
 * Calculate statistics from timing data
 */
function calculateStats(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const sum = values.reduce((acc, val) => acc + val, 0)
  const mean = sum / values.length
  const median = sorted[Math.floor(sorted.length / 2)]
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  
  return { min, max, mean, median }
}

/**
 * Format time in milliseconds
 */
function formatMs(ms) {
  if (ms < 1000) return `${ms.toFixed(2)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/**
 * Format bytes
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/**
 * Format bytes per second
 */
function formatBytesPerSec(bytesPerSec) {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(2)} B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(2)} KB/s`
  return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`
}

/**
 * Run benchmark for a specific number of chunks
 */
async function benchmarkChunkCount(chunkCount, iterations = 3, format = 'wav') {
  const timings = []
  const throughputs = []
  let avgOutputSize = 0
  
  console.log(`\n  Testing ${chunkCount} chunk(s) (${iterations} iterations, format: ${format})...`)
  
  for (let i = 0; i < iterations; i++) {
    // Create test chapters
    const chapters = []
    for (let j = 0; j < chunkCount; j++) {
      chapters.push(createTestChapter(j + 1, 5)) // 5 second chunks
    }
    
    const totalInputSize = chapters.reduce((sum, ch) => sum + ch.blob.size, 0)
    
    const start = performance.now()
    
    try {
      const result = await concatenateAudioChapters(chapters, { format })
      
      const end = performance.now()
      const duration = end - start
      const throughput = totalInputSize / (duration / 1000) // bytes per second
      
      timings.push(duration)
      throughputs.push(throughput)
      avgOutputSize += result.size
      
      console.log(
        `    Iteration ${i + 1}: ${formatMs(duration)} ` +
        `(${formatBytes(totalInputSize)} input → ${formatBytes(result.size)} output, ` +
        `${formatBytesPerSec(throughput)})`
      )
    } catch (error) {
      console.error(`    Iteration ${i + 1} failed:`, error.message)
      throw error
    }
  }
  
  avgOutputSize /= iterations
  
  return {
    chunkCount,
    iterations,
    timingStats: calculateStats(timings),
    throughputStats: calculateStats(throughputs),
    avgOutputSize
  }
}

/**
 * Main benchmark function
 */
export async function runConcatThroughputBenchmark(options = {}) {
  const {
    maxChunks = 20,
    iterations = 3,
    format = 'wav',
    chunkCounts = null // Allow custom chunk counts for testing
  } = options
  
  console.log('='.repeat(60))
  console.log('Audio Concatenation Throughput Benchmark')
  console.log('='.repeat(60))
  console.log(`Format: ${format.toUpperCase()}`)
  console.log(`Iterations per chunk count: ${iterations}`)
  console.log(`Chunk duration: 5 seconds each`)
  
  const testCounts = chunkCounts || [1, 2, 5, 10, 15, 20].filter(n => n <= maxChunks)
  console.log(`Testing chunk counts: ${testCounts.join(', ')}`)
  
  const results = []
  
  for (const count of testCounts) {
    const result = await benchmarkChunkCount(count, iterations, format)
    results.push(result)
  }
  
  // Print summary
  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log()
  console.log('Chunks | Mean Time | Median Time | Throughput (mean) | Output Size')
  console.log('-'.repeat(75))
  
  for (const result of results) {
    const { chunkCount, timingStats, throughputStats, avgOutputSize } = result
    console.log(
      `${String(chunkCount).padEnd(6)} | ` +
      `${formatMs(timingStats.mean).padEnd(9)} | ` +
      `${formatMs(timingStats.median).padEnd(11)} | ` +
      `${formatBytesPerSec(throughputStats.mean).padEnd(17)} | ` +
      `${formatBytes(avgOutputSize)}`
    )
  }
  
  console.log()
  
  // Calculate scaling metrics
  if (results.length > 1) {
    console.log('SCALING ANALYSIS')
    console.log('-'.repeat(60))
    const firstResult = results[0]
    const lastResult = results[results.length - 1]
    
    const timeRatio = lastResult.timingStats.mean / firstResult.timingStats.mean
    const chunkRatio = lastResult.chunkCount / firstResult.chunkCount
    const efficiency = (chunkRatio / timeRatio) * 100
    
    console.log(`Time increase: ${timeRatio.toFixed(2)}x for ${chunkRatio.toFixed(0)}x more chunks`)
    console.log(`Efficiency: ${efficiency.toFixed(1)}% (100% = perfect linear scaling)`)
    console.log()
  }
  
  return results
}

// Allow running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runConcatThroughputBenchmark()
    .then(() => {
      console.log('\n✓ Benchmark completed successfully')
      process.exit(0)
    })
    .catch((error) => {
      console.error('\n✗ Benchmark failed:', error)
      process.exit(1)
    })
}
