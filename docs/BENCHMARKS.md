# Performance Benchmarks

This document describes the performance benchmarks available in this project and how to interpret their results.

## Overview

The audiobook generator includes automated performance benchmarks that measure:

1. **Kokoro TTS Chunk Generation Latency** - Time to generate audio from text
2. **Audio Concatenation Throughput** - Performance of combining audio chapters

These benchmarks help detect performance regressions and guide optimization efforts.

## Running Benchmarks

### Local Development

```bash
# Run all benchmarks
pnpm run bench

# Run with verbose output
pnpm run bench:quick
```

### Continuous Integration

Benchmarks automatically run on CI when code is merged to the `main` branch. Results are displayed in the workflow summary.

## Benchmark Details

### Kokoro TTS Chunk Generation Latency

**Purpose:** Measures how quickly the TTS engine can convert text to speech.

**Test Configuration:**

- Multiple text samples of varying lengths (500-2000 characters)
- Uses WASM backend for reproducibility
- Multiple iterations for statistical accuracy

**Metrics:**

- **Latency**: Time to generate audio (min, max, mean, median)
- **Throughput**: Characters processed per second
- **Blob Size**: Size of generated audio data

**Expected Results:**

- Latency increases with text length
- Throughput (chars/sec) should remain relatively stable
- Variations between runs indicate system load

**Example Output:**

```
Text Length | Min      | Max      | Mean     | Median   | Throughput
---------------------------------------------------------------------------
500         | 150.2ms  | 165.8ms  | 158.4ms  | 159.1ms  | 3156 chars/s
1000        | 290.1ms  | 310.5ms  | 301.2ms  | 302.0ms  | 3320 chars/s
```

### Audio Concatenation Throughput

**Purpose:** Measures how efficiently the system can combine multiple audio chapters.

**Test Configuration:**

- Tests with 1, 2, and 5 audio chunks
- Each chunk is 5 seconds of silent audio
- WAV format (most efficient)
- Multiple iterations for statistical accuracy

**Metrics:**

- **Timing**: Time to concatenate (min, max, mean, median)
- **Throughput**: Bytes processed per second
- **Output Size**: Final combined audio size
- **Scaling Efficiency**: How performance scales with more chunks

**Expected Results:**

- Time increases with more chunks
- Throughput (MB/s) should remain relatively stable
- Efficiency > 100% indicates better-than-linear scaling (good!)
- Efficiency < 100% indicates worse-than-linear scaling

**Example Output:**

```
Chunks | Mean Time | Median Time | Throughput (mean) | Output Size
---------------------------------------------------------------------------
1      | 2.16ms    | 2.87ms      | 219.03 MB/s       | 430.71 KB
2      | 2.19ms    | 2.33ms      | 385.30 MB/s       | 861.37 KB
5      | 4.87ms    | 5.64ms      | 443.07 MB/s       | 2.10 MB

SCALING ANALYSIS
------------------------------------------------------------
Time increase: 2.26x for 5x more chunks
Efficiency: 221.5% (100% = perfect linear scaling)
```

In this example, efficiency is 221.5%, meaning the system handles 5 chunks much more efficiently than would be expected from linear scaling. This is excellent performance!

## Interpreting Results

### Good Performance Indicators

- ✅ Consistent latency across iterations
- ✅ Stable throughput as data size increases
- ✅ Scaling efficiency > 80%
- ✅ Low variance in measurements

### Performance Regression Indicators

- ⚠️ Latency increased significantly from previous runs
- ⚠️ Throughput decreased noticeably
- ⚠️ Scaling efficiency dropped below 50%
- ⚠️ High variance between iterations

### Environmental Factors

Benchmark results can be affected by:

- System CPU load
- Available memory
- Browser/Node.js version
- Network conditions (for model downloads)
- Temperature/thermal throttling

For reproducible results, run benchmarks on a consistent environment with minimal background processes.

## Benchmark Implementation

The benchmarks are implemented as vitest tests in `bench/run.test.ts`. They use:

- **TypeScript** for type safety
- **Vitest** for test infrastructure
- **Mock AudioContext** for reproducible audio processing
- **Statistical analysis** (min/max/mean/median) for reliable metrics

See `bench/README.md` for implementation details and how to add new benchmarks.

## Performance Goals

### Target Metrics (Guidance)

| Metric                       | Target     | Notes                        |
| ---------------------------- | ---------- | ---------------------------- |
| Kokoro Latency (500 chars)   | < 200ms    | Fast response for short text |
| Kokoro Latency (2000 chars)  | < 800ms    | Acceptable for longer text   |
| Concat Throughput (5 chunks) | > 200 MB/s | Efficient audio processing   |
| Scaling Efficiency           | > 80%      | Good parallelization         |

These targets are guidelines and may vary based on hardware and configuration.

## Contributing

When making changes that might affect performance:

1. Run benchmarks before and after your changes
2. Document any significant performance impacts in your PR
3. Consider adding new benchmarks for new features
4. Review CI benchmark results to catch regressions

## References

- [Kokoro TTS Documentation](https://github.com/thewh1teagle/kokoro-js)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)
