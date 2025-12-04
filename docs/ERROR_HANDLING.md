# Error Handling & Retry Logic Documentation

This document describes the error handling and retry improvements made to the audiobook-generator application.

## Overview

The application now includes structured error handling with automatic retry logic for transient failures. This improves reliability for long-running operations like model loading, audio generation, and ffmpeg processing.

## Structured Error Classes

All errors in the application inherit from a base `AppError` class, which provides:

- User-friendly error messages via `getUserMessage()`
- Error codes for programmatic handling
- Additional error details for debugging

### Error Hierarchy

```
AppError (base)
├── TransientError (retryable)
│   ├── TimeoutError
│   └── ModelLoadError (when isTransient=true)
├── PermanentError (not retryable)
│   ├── CancellationError
│   ├── ModelLoadError (when isTransient=false)
│   ├── AudioGenerationError (when isTransient=false)
│   └── FFmpegError (when isTransient=false)
```

### Error Types

#### TransientError

Errors that should be automatically retried with exponential backoff.

**Examples:**

- Network timeouts
- Temporary resource unavailability
- Rate limits
- Memory allocation failures (after worker restart)

```typescript
throw new TransientError('Network timeout occurred', originalError)
```

#### PermanentError

Errors that should not be retried.

**Examples:**

- Invalid input
- Authentication failures
- Resource not found

```typescript
throw new PermanentError('Invalid voice parameter', originalError)
```

#### TimeoutError

Operation exceeded the specified timeout.

```typescript
throw new TimeoutError('Model loading timed out', 30000)
```

#### CancellationError

Operation was cancelled by the user.

```typescript
throw new CancellationError('Audio generation cancelled')
```

#### ModelLoadError

Failure during TTS model loading. Can be transient or permanent.

```typescript
// Transient - will be retried
throw new ModelLoadError('Failed to download model', 'kokoro', true, originalError)

// Permanent - will not be retried
throw new ModelLoadError('Model not found', 'kokoro', false, originalError)
```

#### AudioGenerationError

Failure during audio generation. Can be transient or permanent.

```typescript
// Transient - will be retried
throw new AudioGenerationError('Memory allocation failed', true, originalError)

// Permanent - will not be retried
throw new AudioGenerationError('Invalid voice parameter', false, originalError)
```

#### FFmpegError

Failure during FFmpeg audio processing. Can be transient or permanent.

```typescript
// Transient - will be retried
throw new FFmpegError('Temporary resource unavailable', 'encoding', true, originalError)

// Permanent - will not be retried
throw new FFmpegError('Invalid codec', 'encoding', false, originalError)
```

## Retry Logic

### retryWithBackoff

The `retryWithBackoff` utility function provides automatic retry with exponential backoff.

**Features:**

- Configurable retry attempts (default: 3)
- Exponential backoff (default: 2x multiplier)
- Maximum delay cap (default: 10 seconds)
- Per-operation timeout support
- Retry callbacks for progress updates
- Smart error classification

**Usage:**

```typescript
import { retryWithBackoff, isRetryableError } from './lib/retryUtils'

// Basic usage
const result = await retryWithBackoff(
  async () => {
    return await someOperation()
  },
  {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
  }
)

// With timeout
const result = await retryWithBackoff(
  async () => {
    return await loadModel()
  },
  {
    maxRetries: 2,
    initialDelay: 2000,
    timeoutMs: 30000, // 30 second timeout per attempt
    shouldRetry: isRetryableError,
    onRetry: (attempt, maxRetries, error) => {
      console.log(`Retry ${attempt}/${maxRetries}: ${error.message}`)
    },
  }
)
```

### Timeout Support

The `withTimeout` utility wraps promises with a timeout:

```typescript
import { withTimeout } from './lib/retryUtils'

// Timeout after 5 seconds
const result = await withTimeout(fetch('https://api.example.com/data'), 5000)
```

### isRetryableError

Helper function to determine if an error should be retried:

```typescript
import { isRetryableError } from './lib/retryUtils'

try {
  await someOperation()
} catch (error) {
  if (isRetryableError(error)) {
    console.log('This error can be retried')
  } else {
    console.log('This error should not be retried')
  }
}
```

The function checks:

1. If the error is an instance of `TransientError`
2. If it's a specialized error with `isTransient=true`
3. If the error message contains known transient patterns

## Integration Points

### TTS Worker Manager

The `TTSWorkerManager` now includes:

- Automatic retry for memory errors with worker restart
- Progress callbacks with retry notifications
- Structured error messages propagated to UI

```typescript
const manager = getTTSWorker()

await manager.generateVoice({
  text: 'Hello world',
  modelType: 'kokoro',
  onProgress: (message) => {
    console.log(message) // Will show retry messages
  },
})
```

**Retry behavior:**

- Automatically retries memory allocation errors after restarting the worker
- Retries up to 2 times with exponential backoff
- Propagates retry progress through `onProgress` callback

### Kokoro Client

The `kokoroClient` includes:

- Automatic retry for model loading failures
- Structured error conversion
- Progress updates during retries

```typescript
import { generateVoice } from './lib/kokoro/kokoroClient'

await generateVoice(
  {
    text: 'Hello world',
    voice: 'af_heart',
  },
  (current, total) => {
    // Chunk progress
  },
  (status) => {
    console.log(status) // Will show retry messages
  }
)
```

**Retry behavior:**

- Model loading: 2 retries with 2-10 second delays
- Transient generation errors: Converted to `AudioGenerationError`

### FFmpeg Operations

FFmpeg operations now include:

- Automatic retry for loading failures
- Structured error reporting
- Better error classification

```typescript
// FFmpeg loading is automatically retried
const blob = await concatenateAudioChapters(chapters, { format: 'mp3' }, (progress) => {
  console.log(progress.message)
})
```

**Retry behavior:**

- FFmpeg loading: 2 retries with 1-5 second delays
- Transient errors are automatically retried

## Progress & Error Callbacks

All major operations support progress callbacks that receive retry notifications:

```typescript
await manager.generateVoice({
  text: 'Sample text',
  onProgress: (message) => {
    // Receives messages like:
    // - "Loading model..."
    // - "Retrying... (attempt 1/2)"
    // - "Generation failed. Retrying..."
  },
  onChunkProgress: (current, total) => {
    // Track chunk generation progress
  },
})
```

## Error Classification Patterns

The `isRetryableError` function recognizes these patterns as transient:

- "network", "timeout"
- "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"
- "rate limit", "too many requests"
- "service unavailable", "temporarily unavailable"
- "failed to allocate", "Can't create a session"
- "Out of memory", "Aborted()"

## Best Practices

### 1. Always use structured errors

```typescript
// Good
throw new TransientError('Network timeout', originalError)

// Avoid
throw new Error('Network timeout')
```

### 2. Set appropriate timeouts

```typescript
// Model loading (slow)
retryWithBackoff(loadModel, { timeoutMs: 30000 })

// API calls (fast)
retryWithBackoff(apiCall, { timeoutMs: 5000 })
```

### 3. Provide user feedback

```typescript
await operation({
  onProgress: (message) => {
    // Show message in UI
    showToast(message)
  },
})
```

### 4. Handle cancellation gracefully

```typescript
try {
  await manager.generateVoice({ text })
} catch (error) {
  if (error instanceof CancellationError) {
    // User cancelled - don't show error
    return
  }
  // Show error to user
  showError(error.getUserMessage())
}
```

## Testing

The error handling system includes comprehensive tests:

- **Unit tests** (`errors.test.ts`, `retryUtils.test.ts`): 52 tests
- **Integration tests** (`retry.integration.test.ts`): 15 tests covering:
  - Network failures with backoff
  - Permanent vs transient error handling
  - Timeout scenarios
  - Model loading errors
  - Audio generation errors
  - FFmpeg operation errors
  - Cancellation handling
  - Exponential backoff behavior

Run tests:

```bash
pnpm test
```

## Configuration

### Default Retry Settings

| Operation        | Max Retries | Initial Delay | Max Delay | Timeout |
| ---------------- | ----------- | ------------- | --------- | ------- |
| Model Loading    | 2           | 2000ms        | 10000ms   | None    |
| Audio Generation | 2           | 1000ms        | 5000ms    | None    |
| FFmpeg Loading   | 2           | 1000ms        | 5000ms    | None    |

### Customizing Retry Behavior

You can customize retry behavior by passing options:

```typescript
await retryWithBackoff(operation, {
  maxRetries: 5,
  initialDelay: 500,
  maxDelay: 20000,
  backoffMultiplier: 3,
  timeoutMs: 60000,
  shouldRetry: (error) => {
    // Custom retry logic
    return error.message.includes('retry-me')
  },
  onRetry: (attempt, max, error) => {
    console.log(`Retry ${attempt}/${max}: ${error.message}`)
  },
})
```

## Monitoring & Debugging

### Logging

All retry attempts are logged with context:

```
[TTSWorkerManager] Retry attempt 1/2: Memory allocation failed
[KokoroClient] Model load retry 1/2: Network timeout
[FFmpeg] Load retry 1/2: ECONNREFUSED
```

### Error Details

Structured errors include:

- `message`: Human-readable error description
- `code`: Machine-readable error code
- `details`: Additional context (model type, operation, etc.)
- `originalError`: The underlying error that caused this error

```typescript
try {
  await operation()
} catch (error) {
  if (error instanceof AppError) {
    console.log('Error code:', error.code)
    console.log('Details:', error.details)
    console.log('Original:', error.originalError)
  }
}
```

## Future Enhancements

Potential improvements:

1. Configurable retry policies per operation type
2. Circuit breaker pattern for repeated failures
3. Error reporting/telemetry
4. Retry queue with prioritization
5. Adaptive backoff based on error types
