import { TimeoutError, isRetryableError } from './errors'

// Re-export for convenience
export { isRetryableError } from './errors'

/**
 * Configuration options for retry behavior
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number
  /** Initial delay in milliseconds (default: 1000) */
  initialDelay?: number
  /** Maximum delay in milliseconds (default: 10000) */
  maxDelay?: number
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number
  /** Function to determine if error is retryable (default: uses isRetryableError) */
  shouldRetry?: (error: Error) => boolean
  /** Timeout in milliseconds for each attempt (default: no timeout) */
  timeoutMs?: number
  /** Callback for retry attempts (useful for logging or UI updates) */
  onRetry?: (attempt: number, maxRetries: number, error: Error) => void
}

/**
 * Retry a function with exponential backoff
 *
 * @param fn Function to retry
 * @param options Retry configuration options
 * @returns Promise that resolves with the function result
 * @throws Error if all retry attempts fail
 *
 * @example
 * const result = await retryWithBackoff(
 *   () => fetch('https://api.example.com/data'),
 *   { maxRetries: 3, initialDelay: 1000, timeoutMs: 5000 }
 * );
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2,
    shouldRetry = () => true, // Default to always retry for backward compatibility
    timeoutMs,
    onRetry,
  } = options

  // Validate maxRetries is non-negative
  if (maxRetries < 0) {
    throw new Error('maxRetries must be a non-negative number')
  }

  let lastError: Error | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Apply timeout if specified
      const result = timeoutMs ? await withTimeout(fn(), timeoutMs) : await fn()
      return result
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Don't retry if this is the last attempt or if error is not retryable
      if (attempt === maxRetries || !shouldRetry(lastError)) {
        throw lastError
      }

      // Notify caller about retry
      if (onRetry) {
        onRetry(attempt + 1, maxRetries, lastError)
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(initialDelay * Math.pow(backoffMultiplier, attempt), maxDelay)

      // Wait before next retry
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  // This should never be reached due to loop logic, but TypeScript needs it
  throw lastError!
}

/**
 * Wrap a promise with a timeout
 *
 * @param promise Promise to wrap
 * @param timeoutMs Timeout in milliseconds
 * @returns Promise that resolves with the original promise or rejects with TimeoutError
 *
 * @example
 * const result = await withTimeout(
 *   fetch('https://api.example.com/data'),
 *   5000
 * );
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(`Operation timed out after ${timeoutMs}ms`, timeoutMs))
    }, timeoutMs)

    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}
