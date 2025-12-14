/**
 * Test file for running benchmarks
 * This allows benchmarks to run using the existing test infrastructure
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { runConcatThroughputBenchmark } from './concat-throughput'
import { runKokoroLatencyBenchmark } from './kokoro-latency'

// Mock AudioContext for testing (same as audioConcat.test.ts)
class MockAudioContext {
  sampleRate = 44100

  createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
    const buffer = {
      numberOfChannels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: (_channel: number) => new Float32Array(length),
    }
    return buffer as AudioBuffer
  }

  decodeAudioData(arrayBuffer: ArrayBuffer) {
    // Create a simple mock buffer
    const length = Math.floor(arrayBuffer.byteLength / 4) // Assume 16-bit stereo
    return Promise.resolve(this.createBuffer(2, length, this.sampleRate))
  }

  async close() {
    // Mock close
  }
}

describe('Performance Benchmarks', () => {
  beforeAll(() => {
    // Mock AudioContext globally
    ;(globalThis as unknown as { AudioContext: typeof MockAudioContext }).AudioContext =
      MockAudioContext

    // Add arrayBuffer method to Blob prototype if not present
    if (!Blob.prototype.arrayBuffer) {
      Blob.prototype.arrayBuffer = function () {
        return new Promise((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => {
            resolve(reader.result as ArrayBuffer)
          }
          reader.readAsArrayBuffer(this)
        })
      }
    }
  })

  // These tests actually run benchmarks but with minimal iterations
  // They serve as smoke tests to ensure benchmarks work correctly

  it('should run concatenation throughput benchmark', async () => {
    const results = await runConcatThroughputBenchmark({
      maxChunks: 10,
      iterations: 2,
      chunkCounts: [1, 2, 5],
    })

    expect(results).toBeDefined()
    expect(results.length).toBe(3)

    for (const result of results) {
      expect(result.chunkCount).toBeGreaterThan(0)
      expect(result.timingStats.mean).toBeGreaterThan(0)
      expect(result.throughputStats.mean).toBeGreaterThan(0)
      expect(result.avgOutputSize).toBeGreaterThan(0)
    }

    // Verify results are in ascending chunk order
    for (let i = 1; i < results.length; i++) {
      expect(results[i].chunkCount).toBeGreaterThan(results[i - 1].chunkCount)
    }
  }, 60000) // 60 second timeout

  it('should run Kokoro latency benchmark with short text', async () => {
    // Use a shorter text sample for faster test
    const shortSamples = [
      'This is a short test sample that is long enough to generate speech but quick to process. ' +
        'It should complete in a reasonable time for testing purposes.',
    ]

    const results = await runKokoroLatencyBenchmark({
      iterations: 2,
      samples: shortSamples,
    })

    expect(results).toBeDefined()
    expect(results.length).toBe(1)

    const result = results[0]
    expect(result.textLength).toBeGreaterThan(0)
    expect(result.latency.mean).toBeGreaterThan(0)
    expect(result.avgBlobSize).toBeGreaterThan(0)
    expect(result.throughput).toBeGreaterThan(0)
  }, 120000) // 120 second timeout (Kokoro model loading can be slow)
})
