#!/usr/bin/env node
/**
 * Main benchmark runner
 * 
 * Runs all performance benchmarks and generates a summary report
 */

import { runKokoroLatencyBenchmark } from './kokoro-latency.js'
import { runConcatThroughputBenchmark } from './concat-throughput.js'
import { writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    iterations: 3,
    maxChunks: 20,
    format: 'wav',
    outputFile: null,
    skipKokoro: false,
    skipConcat: false
  }
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    
    switch (arg) {
      case '--iterations':
      case '-i':
        options.iterations = parseInt(args[++i], 10)
        break
      case '--max-chunks':
      case '-c':
        options.maxChunks = parseInt(args[++i], 10)
        break
      case '--format':
      case '-f':
        options.format = args[++i]
        break
      case '--output':
      case '-o':
        options.outputFile = args[++i]
        break
      case '--skip-kokoro':
        options.skipKokoro = true
        break
      case '--skip-concat':
        options.skipConcat = true
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
        break
      default:
        console.error(`Unknown option: ${arg}`)
        printHelp()
        process.exit(1)
    }
  }
  
  return options
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
Usage: node bench/run.js [options]

Options:
  -i, --iterations <n>     Number of iterations per test (default: 3)
  -c, --max-chunks <n>     Maximum number of chunks for concat test (default: 20)
  -f, --format <format>    Audio format for concat test (default: wav)
  -o, --output <file>      Write results to JSON file
  --skip-kokoro            Skip Kokoro latency benchmark
  --skip-concat            Skip concatenation throughput benchmark
  -h, --help               Show this help message

Examples:
  node bench/run.js
  node bench/run.js --iterations 5 --max-chunks 10
  node bench/run.js --output results.json
  node bench/run.js --skip-kokoro
`)
}

/**
 * Format benchmark results as JSON
 */
function formatResults(kokoroResults, concatResults) {
  return {
    timestamp: new Date().toISOString(),
    platform: {
      node: process.version,
      arch: process.arch,
      platform: process.platform
    },
    benchmarks: {
      kokoro: kokoroResults ? {
        name: 'Kokoro TTS Chunk Generation Latency',
        results: kokoroResults.map(r => ({
          textLength: r.textLength,
          iterations: r.iterations,
          latencyMs: {
            min: r.latency.min,
            max: r.latency.max,
            mean: r.latency.mean,
            median: r.latency.median
          },
          avgBlobSize: r.avgBlobSize,
          throughputCharsPerSec: r.throughput
        }))
      } : null,
      concat: concatResults ? {
        name: 'Audio Concatenation Throughput',
        results: concatResults.map(r => ({
          chunkCount: r.chunkCount,
          iterations: r.iterations,
          timingMs: {
            min: r.timingStats.min,
            max: r.timingStats.max,
            mean: r.timingStats.mean,
            median: r.timingStats.median
          },
          throughputBytesPerSec: {
            min: r.throughputStats.min,
            max: r.throughputStats.max,
            mean: r.throughputStats.mean,
            median: r.throughputStats.median
          },
          avgOutputSize: r.avgOutputSize
        }))
      } : null
    }
  }
}

/**
 * Main function
 */
async function main() {
  const options = parseArgs()
  
  console.log('\n' + '='.repeat(60))
  console.log('AUDIOBOOK GENERATOR - PERFORMANCE BENCHMARKS')
  console.log('='.repeat(60))
  console.log(`Started: ${new Date().toLocaleString()}`)
  console.log(`Node.js: ${process.version}`)
  console.log(`Platform: ${process.platform} ${process.arch}`)
  console.log('='.repeat(60))
  
  let kokoroResults = null
  let concatResults = null
  
  try {
    // Run Kokoro latency benchmark
    if (!options.skipKokoro) {
      console.log('\n\n📊 Running Kokoro TTS latency benchmark...\n')
      kokoroResults = await runKokoroLatencyBenchmark({
        iterations: options.iterations
      })
    } else {
      console.log('\n\n⏭️  Skipping Kokoro latency benchmark')
    }
    
    // Run concatenation throughput benchmark
    if (!options.skipConcat) {
      console.log('\n\n📊 Running concatenation throughput benchmark...\n')
      concatResults = await runConcatThroughputBenchmark({
        maxChunks: options.maxChunks,
        iterations: options.iterations,
        format: options.format
      })
    } else {
      console.log('\n\n⏭️  Skipping concatenation throughput benchmark')
    }
    
    // Save results if output file specified
    if (options.outputFile) {
      const results = formatResults(kokoroResults, concatResults)
      const outputPath = join(process.cwd(), options.outputFile)
      writeFileSync(outputPath, JSON.stringify(results, null, 2))
      console.log(`\n📄 Results saved to: ${outputPath}`)
    }
    
    console.log('\n' + '='.repeat(60))
    console.log('✓ ALL BENCHMARKS COMPLETED SUCCESSFULLY')
    console.log('='.repeat(60))
    console.log(`Completed: ${new Date().toLocaleString()}`)
    console.log()
    
    process.exit(0)
  } catch (error) {
    console.error('\n' + '='.repeat(60))
    console.error('✗ BENCHMARK FAILED')
    console.error('='.repeat(60))
    console.error(error)
    console.error()
    process.exit(1)
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

export { main }
