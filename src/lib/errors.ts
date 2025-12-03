/**
 * Structured error classes for improved error handling
 * These classes help distinguish between transient (retryable) and permanent errors
 */

/**
 * Base class for all application errors
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = this.constructor.name
    // Restore prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype)
  }

  /**
   * Get a user-friendly message for display in UI
   */
  getUserMessage(): string {
    return this.message
  }
}

/**
 * Transient error - should be retried with backoff
 * Examples: network timeouts, temporary resource unavailability, rate limits
 */
export class TransientError extends AppError {
  constructor(
    message: string,
    public readonly originalError?: Error,
    code?: string,
    details?: unknown
  ) {
    super(message, code, details)
  }

  getUserMessage(): string {
    return `${this.message}. Retrying...`
  }
}

/**
 * Permanent error - should not be retried
 * Examples: invalid input, authentication failures, resource not found
 */
export class PermanentError extends AppError {
  constructor(
    message: string,
    public readonly originalError?: Error,
    code?: string,
    details?: unknown
  ) {
    super(message, code, details)
  }

  getUserMessage(): string {
    return `${this.message}. Please check your input and try again.`
  }
}

/**
 * Timeout error - operation took too long
 */
export class TimeoutError extends TransientError {
  constructor(
    message: string,
    public readonly timeoutMs: number,
    originalError?: Error
  ) {
    super(message, originalError, 'TIMEOUT')
  }

  getUserMessage(): string {
    return `${this.message} (timeout: ${this.timeoutMs}ms)`
  }
}

/**
 * Cancellation error - operation was cancelled by user
 */
export class CancellationError extends AppError {
  constructor(message: string = 'Operation cancelled by user') {
    super(message, 'CANCELLED')
  }

  getUserMessage(): string {
    return this.message
  }
}

/**
 * Model loading error - failure to load TTS model
 */
export class ModelLoadError extends AppError {
  constructor(
    message: string,
    public readonly modelType: string,
    public readonly isTransient: boolean = false,
    originalError?: Error
  ) {
    super(message, 'MODEL_LOAD_ERROR', { modelType, originalError })
  }

  getUserMessage(): string {
    if (this.isTransient) {
      return `Failed to load ${this.modelType} model. Retrying...`
    }
    return `Failed to load ${this.modelType} model. Please check your connection and try again.`
  }
}

/**
 * Audio generation error - failure during TTS generation
 */
export class AudioGenerationError extends AppError {
  constructor(
    message: string,
    public readonly isTransient: boolean = false,
    originalError?: Error
  ) {
    super(message, 'AUDIO_GENERATION_ERROR', { originalError })
  }

  getUserMessage(): string {
    if (this.isTransient) {
      return `${this.message}. Retrying...`
    }
    return `${this.message}. Please try again or use a different voice/model.`
  }
}

/**
 * FFmpeg error - failure during audio processing
 */
export class FFmpegError extends AppError {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly isTransient: boolean = false,
    originalError?: Error
  ) {
    super(message, 'FFMPEG_ERROR', { operation, originalError })
  }

  getUserMessage(): string {
    if (this.isTransient) {
      return `Audio processing failed (${this.operation}). Retrying...`
    }
    return `Audio processing failed (${this.operation}). Please try again.`
  }
}

/**
 * Default patterns that indicate a transient (retryable) error
 */
export const DEFAULT_TRANSIENT_PATTERNS = [
  'network',
  'timeout',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'rate limit',
  'too many requests',
  'service unavailable',
  'temporarily unavailable',
  'failed to allocate',
  "Can't create a session",
  'Out of memory',
  'Aborted()',
]

/**
 * Helper to determine if an error is retryable
 * @param error Error to check
 * @param additionalPatterns Additional patterns to consider transient (optional)
 */
export function isRetryableError(error: unknown, additionalPatterns?: string[]): boolean {
  if (error instanceof TransientError) {
    return true
  }

  if (error instanceof ModelLoadError && error.isTransient) {
    return true
  }

  if (error instanceof AudioGenerationError && error.isTransient) {
    return true
  }

  if (error instanceof FFmpegError && error.isTransient) {
    return true
  }

  if (error instanceof PermanentError || error instanceof CancellationError) {
    return false
  }

  // Check error message for known transient patterns
  const message = error instanceof Error ? error.message : String(error)
  const patterns = [...DEFAULT_TRANSIENT_PATTERNS, ...(additionalPatterns || [])]

  return patterns.some((pattern) => message.toLowerCase().includes(pattern.toLowerCase()))
}

/**
 * Helper to convert unknown errors to structured errors
 */
export function normalizeError(error: unknown, context?: string): AppError {
  // If already an AppError, return as-is
  if (error instanceof AppError) {
    return error
  }

  const message = error instanceof Error ? error.message : String(error)
  const contextPrefix = context ? `${context}: ` : ''

  // Check if it's a retryable error
  if (isRetryableError(error)) {
    return new TransientError(
      `${contextPrefix}${message}`,
      error instanceof Error ? error : undefined
    )
  }

  // Default to permanent error
  return new PermanentError(
    `${contextPrefix}${message}`,
    error instanceof Error ? error : undefined
  )
}
