# Performance Benchmarks

This directory contains performance benchmarks for the audiobook generator, focusing on TTS chunk latency and audio concatenation throughput.

## Running Benchmarks

### Run All Benchmarks

```bash
pnpm run bench
```

This runs both the Kokoro TTS latency and audio concatenation benchmarks using the test infrastructure (vitest).

### Quick Benchmark Run

```bash
pnpm run bench:quick
```

Runs benchmarks with verbose output showing detailed progress.

### Running Specific Benchmarks

You can also run individual benchmark tests using vitest:

```bash
# Run only concatenation benchmark
vitest run bench/run.test.ts -t "concatenation"

# Run only Kokoro benchmark
vitest run bench/run.test.ts -t "Kokoro"
```

## Benchmarks

### 1. Kokoro TTS Chunk Generation Latency

**File:** `kokoro-latency.ts`

Measures the time to generate audio from text chunks of varying sizes.

**Metrics:**

- Min/max/mean/median latency per text length
- Throughput in characters per second
- Average blob size

**Test Configuration:**

- Text lengths tested: 500-2000 characters
- Uses WASM backend for reproducibility
- Multiple iterations for statistical accuracy

### 2. Audio Concatenation Throughput

**File:** `concat-throughput.ts`

Measures the performance of `concatenateAudioChapters()` with varying numbers of audio chunks.

**Metrics:**

- Time to concatenate N chunks
- Throughput in bytes per second
- Output file size
- Scaling efficiency

**Test Configuration:**

- Chunk counts: 1, 2, 5 (for quick tests)
- Each chunk: 5 seconds of silent audio
- Format: WAV
- Multiple iterations for statistical accuracy

## Output Format

Benchmarks output results to the console with detailed metrics:

- **Kokoro Latency**: Shows timing stats for each text length
- **Concatenation Throughput**: Shows timing and throughput for different chunk counts
- **Scaling Analysis**: Efficiency metrics showing how performance scales with load

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

1. Create a new TypeScript file in `bench/` (e.g., `bench/my-benchmark.ts`)
2. Export benchmark functions that return results with proper typing
3. Add test cases to `bench/run.test.ts`
4. Ensure benchmarks work with the existing test infrastructure

Example structure:

```typescript
export interface MyBenchmarkResult {
  // Define result types
}

export async function runMyBenchmark(options = {}): Promise<MyBenchmarkResult[]> {
  // Setup
  const results: MyBenchmarkResult[] = []

  // Run tests
  // ...

  // Return results
  return results
}
```

Then add to `bench/run.test.ts`:

```typescript
it('should run my benchmark', async () => {
  const results = await runMyBenchmark()
  expect(results).toBeDefined()
  // Add assertions
}, 60000)
```
