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
  /** Function to determine if error is retryable (default: always retry) */
  shouldRetry?: (error: Error) => boolean
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
 *   { maxRetries: 3, initialDelay: 1000 }
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
    shouldRetry = () => true,
  } = options

  let lastError: Error

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Don't retry if this is the last attempt or if error is not retryable
      if (attempt === maxRetries || !shouldRetry(lastError)) {
        throw lastError
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(initialDelay * Math.pow(backoffMultiplier, attempt), maxDelay)

      console.log(
        `Attempt ${attempt + 1}/${maxRetries + 1} failed: ${lastError.message}. Retrying in ${delay}ms...`
      )

      // Wait before next retry
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError!
}
