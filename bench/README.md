# Performance Benchmarks

This directory contains performance benchmarks for the audiobook generator, focusing on TTS chunk latency and audio concatenation throughput.

## Running Benchmarks

### Run All Benchmarks

```bash
pnpm run bench
```

### Run Individual Benchmarks

```bash
# Kokoro TTS chunk generation latency
pnpm run bench:kokoro

# Audio concatenation throughput
pnpm run bench:concat
```

## Benchmark Options

The main runner (`bench/run.js`) supports various options:

```bash
node bench/run.js [options]

Options:
  -i, --iterations <n>     Number of iterations per test (default: 3)
  -c, --max-chunks <n>     Maximum number of chunks for concat test (default: 20)
  -f, --format <format>    Audio format for concat test (default: wav)
  -o, --output <file>      Write results to JSON file
  --skip-kokoro            Skip Kokoro latency benchmark
  --skip-concat            Skip concatenation throughput benchmark
  -h, --help               Show this help message
```

### Examples

```bash
# Run with more iterations for better accuracy
pnpm run bench -- --iterations 5

# Test only concatenation with MP3 format
pnpm run bench -- --skip-kokoro --format mp3

# Save results to a file
pnpm run bench -- --output benchmark-results.json

# Quick test with fewer chunks
pnpm run bench -- --max-chunks 10 --iterations 2
```

## Benchmarks

### 1. Kokoro TTS Chunk Generation Latency

**File:** `kokoro-latency.js`

Measures the time to generate audio from text chunks of varying sizes (500-2000 characters).

**Metrics:**
- Min/max/mean/median latency per text length
- Throughput in characters per second
- Average blob size

**Test Samples:**
- 500 characters
- 1000 characters
- 1500 characters
- 2000 characters

### 2. Audio Concatenation Throughput

**File:** `concat-throughput.js`

Measures the performance of `concatenateAudioChapters()` with varying numbers of audio chunks (1-20).

**Metrics:**
- Time to concatenate N chunks
- Throughput in bytes per second
- Output file size
- Scaling efficiency

**Test Configurations:**
- Chunk counts: 1, 2, 5, 10, 15, 20
- Each chunk: 5 seconds of audio
- Format: WAV (or configurable)

## Output Format

When using `--output`, results are saved as JSON:

```json
{
  "timestamp": "2024-01-01T12:00:00.000Z",
  "platform": {
    "node": "v20.x.x",
    "arch": "x64",
    "platform": "linux"
  },
  "benchmarks": {
    "kokoro": {
      "name": "Kokoro TTS Chunk Generation Latency",
      "results": [
        {
          "textLength": 500,
          "iterations": 3,
          "latencyMs": {
            "min": 150.2,
            "max": 165.8,
            "mean": 158.4,
            "median": 159.1
          },
          "avgBlobSize": 44100,
          "throughputCharsPerSec": 3156.5
        }
      ]
    },
    "concat": {
      "name": "Audio Concatenation Throughput",
      "results": [
        {
          "chunkCount": 5,
          "iterations": 3,
          "timingMs": {
            "min": 45.2,
            "max": 52.1,
            "mean": 48.6,
            "median": 48.5
          },
          "throughputBytesPerSec": {
            "min": 1250000,
            "max": 1450000,
            "mean": 1350000,
            "median": 1340000
          },
          "avgOutputSize": 2205044
        }
      ]
    }
  }
}
```

## CI Integration

Benchmarks are automatically run on CI when merging to the main branch. Results are stored as artifacts for tracking performance over time.

See `.github/workflows/benchmark.yml` for CI configuration.

## Interpreting Results

### Kokoro Latency

- **Lower is better** for latency values
- **Higher is better** for throughput (chars/s)
- Expect latency to increase with text length, but throughput should remain relatively stable
- Large variations between iterations may indicate system load issues

### Concatenation Throughput

- **Lower is better** for timing values
- **Higher is better** for throughput (bytes/s)
- Efficiency metric shows scaling behavior (100% = perfect linear scaling)
- Throughput should remain relatively constant as chunk count increases

## Troubleshooting

### High Latency

- Check system resources (CPU, memory)
- Ensure no other heavy processes are running
- Try increasing iterations for more stable results

### Failed Benchmarks

- Ensure all dependencies are installed: `pnpm install`
- Check that Node.js version is compatible (v20+)
- For Kokoro benchmarks, ensure sufficient memory (model loading)

## Development

To add new benchmarks:

1. Create a new file in `bench/` (e.g., `bench/my-benchmark.js`)
2. Export a main function that returns benchmark results
3. Add to `bench/run.js` to include in the main runner
4. Add a script to `package.json` for standalone execution

Example structure:

```javascript
export async function runMyBenchmark(options = {}) {
  // Setup
  const results = []
  
  // Run tests
  // ...
  
  // Return results
  return results
}

// Allow standalone execution
if (import.meta.url === `file://${process.argv[1]}`) {
  runMyBenchmark()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err)
      process.exit(1)
    })
}
```
