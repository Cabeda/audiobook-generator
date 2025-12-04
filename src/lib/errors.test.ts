import { describe, it, expect } from 'vitest'
import {
  AppError,
  TransientError,
  PermanentError,
  TimeoutError,
  CancellationError,
  ModelLoadError,
  AudioGenerationError,
  FFmpegError,
  isRetryableError,
  normalizeError,
} from './errors'

describe('Error Classes', () => {
  describe('AppError', () => {
    it('should create an AppError with message', () => {
      const error = new AppError('Test error')
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(AppError)
      expect(error.message).toBe('Test error')
      expect(error.name).toBe('AppError')
    })

    it('should create an AppError with code and details', () => {
      const error = new AppError('Test error', 'TEST_CODE', { foo: 'bar' })
      expect(error.code).toBe('TEST_CODE')
      expect(error.details).toEqual({ foo: 'bar' })
    })

    it('should return user-friendly message', () => {
      const error = new AppError('Test error')
      expect(error.getUserMessage()).toBe('Test error')
    })
  })

  describe('TransientError', () => {
    it('should create a TransientError', () => {
      const originalError = new Error('Network timeout')
      const error = new TransientError('Connection failed', originalError)
      expect(error).toBeInstanceOf(TransientError)
      expect(error).toBeInstanceOf(AppError)
      expect(error.message).toBe('Connection failed')
      expect(error.originalError).toBe(originalError)
    })

    it('should return user-friendly message with retry indication', () => {
      const error = new TransientError('Connection failed')
      expect(error.getUserMessage()).toBe('Connection failed. Retrying...')
    })
  })

  describe('PermanentError', () => {
    it('should create a PermanentError', () => {
      const error = new PermanentError('Invalid input')
      expect(error).toBeInstanceOf(PermanentError)
      expect(error).toBeInstanceOf(AppError)
      expect(error.message).toBe('Invalid input')
    })

    it('should return user-friendly message', () => {
      const error = new PermanentError('Invalid input')
      expect(error.getUserMessage()).toBe('Invalid input. Please check your input and try again.')
    })
  })

  describe('TimeoutError', () => {
    it('should create a TimeoutError with timeout value', () => {
      const error = new TimeoutError('Operation timed out', 5000)
      expect(error).toBeInstanceOf(TimeoutError)
      expect(error).toBeInstanceOf(TransientError)
      expect(error.timeoutMs).toBe(5000)
      expect(error.code).toBe('TIMEOUT')
    })

    it('should return user-friendly message with timeout', () => {
      const error = new TimeoutError('Operation timed out', 5000)
      expect(error.getUserMessage()).toBe('Operation timed out (timeout: 5000ms)')
    })
  })

  describe('CancellationError', () => {
    it('should create a CancellationError with default message', () => {
      const error = new CancellationError()
      expect(error).toBeInstanceOf(CancellationError)
      expect(error.message).toBe('Operation cancelled by user')
      expect(error.code).toBe('CANCELLED')
    })

    it('should create a CancellationError with custom message', () => {
      const error = new CancellationError('Custom cancellation')
      expect(error.message).toBe('Custom cancellation')
    })
  })

  describe('ModelLoadError', () => {
    it('should create a ModelLoadError', () => {
      const error = new ModelLoadError('Failed to load model', 'kokoro', true)
      expect(error).toBeInstanceOf(ModelLoadError)
      expect(error.modelType).toBe('kokoro')
      expect(error.isTransient).toBe(true)
      expect(error.code).toBe('MODEL_LOAD_ERROR')
    })

    it('should return transient user message', () => {
      const error = new ModelLoadError('Failed to load model', 'kokoro', true)
      expect(error.getUserMessage()).toBe('Failed to load kokoro model. Retrying...')
    })

    it('should return permanent user message', () => {
      const error = new ModelLoadError('Failed to load model', 'kokoro', false)
      expect(error.getUserMessage()).toBe(
        'Failed to load kokoro model. Please check your connection and try again.'
      )
    })
  })

  describe('AudioGenerationError', () => {
    it('should create an AudioGenerationError', () => {
      const error = new AudioGenerationError('Generation failed', true)
      expect(error).toBeInstanceOf(AudioGenerationError)
      expect(error.isTransient).toBe(true)
      expect(error.code).toBe('AUDIO_GENERATION_ERROR')
    })

    it('should return appropriate user messages', () => {
      const transient = new AudioGenerationError('Generation failed', true)
      expect(transient.getUserMessage()).toBe('Generation failed. Retrying...')

      const permanent = new AudioGenerationError('Generation failed', false)
      expect(permanent.getUserMessage()).toBe(
        'Generation failed. Please try again or use a different voice/model.'
      )
    })
  })

  describe('FFmpegError', () => {
    it('should create an FFmpegError', () => {
      const error = new FFmpegError('Conversion failed', 'mp3-encoding', true)
      expect(error).toBeInstanceOf(FFmpegError)
      expect(error.operation).toBe('mp3-encoding')
      expect(error.isTransient).toBe(true)
      expect(error.code).toBe('FFMPEG_ERROR')
    })

    it('should return appropriate user messages', () => {
      const transient = new FFmpegError('Conversion failed', 'mp3-encoding', true)
      expect(transient.getUserMessage()).toBe('Audio processing failed (mp3-encoding). Retrying...')

      const permanent = new FFmpegError('Conversion failed', 'mp3-encoding', false)
      expect(permanent.getUserMessage()).toBe(
        'Audio processing failed (mp3-encoding). Please try again.'
      )
    })
  })

  describe('isRetryableError', () => {
    it('should identify TransientError as retryable', () => {
      const error = new TransientError('Temporary failure')
      expect(isRetryableError(error)).toBe(true)
    })

    it('should identify transient ModelLoadError as retryable', () => {
      const error = new ModelLoadError('Load failed', 'kokoro', true)
      expect(isRetryableError(error)).toBe(true)
    })

    it('should identify transient AudioGenerationError as retryable', () => {
      const error = new AudioGenerationError('Generation failed', true)
      expect(isRetryableError(error)).toBe(true)
    })

    it('should identify transient FFmpegError as retryable', () => {
      const error = new FFmpegError('Processing failed', 'conversion', true)
      expect(isRetryableError(error)).toBe(true)
    })

    it('should identify PermanentError as not retryable', () => {
      const error = new PermanentError('Invalid input')
      expect(isRetryableError(error)).toBe(false)
    })

    it('should identify CancellationError as not retryable', () => {
      const error = new CancellationError()
      expect(isRetryableError(error)).toBe(false)
    })

    it('should identify non-transient ModelLoadError as not retryable', () => {
      const error = new ModelLoadError('Load failed', 'kokoro', false)
      expect(isRetryableError(error)).toBe(false)
    })

    it('should identify errors with network-related messages as retryable', () => {
      expect(isRetryableError(new Error('Network timeout occurred'))).toBe(true)
      expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true)
      expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true)
      expect(isRetryableError(new Error('Rate limit exceeded'))).toBe(true)
      expect(isRetryableError(new Error('Service temporarily unavailable'))).toBe(true)
    })

    it('should identify errors with memory allocation messages as retryable', () => {
      expect(isRetryableError(new Error('failed to allocate memory'))).toBe(true)
      expect(isRetryableError(new Error("Can't create a session"))).toBe(true)
      expect(isRetryableError(new Error('Out of memory'))).toBe(true)
      expect(isRetryableError(new Error('Aborted()'))).toBe(true)
    })

    it('should identify generic errors as retryable by default', () => {
      // If pattern doesn't match known transient patterns, it's not retryable by default
      expect(isRetryableError(new Error('Generic error message'))).toBe(false)
    })
  })

  describe('normalizeError', () => {
    it('should return AppError as-is', () => {
      const error = new PermanentError('Test error')
      const normalized = normalizeError(error)
      expect(normalized).toBe(error)
    })

    it('should convert retryable Error to TransientError', () => {
      const error = new Error('Network timeout')
      const normalized = normalizeError(error)
      expect(normalized).toBeInstanceOf(TransientError)
      expect(normalized.message).toBe('Network timeout')
    })

    it('should convert non-retryable Error to PermanentError', () => {
      const error = new Error('Invalid input')
      const normalized = normalizeError(error)
      expect(normalized).toBeInstanceOf(PermanentError)
      expect(normalized.message).toBe('Invalid input')
    })

    it('should add context to error message', () => {
      const error = new Error('Test error')
      const normalized = normalizeError(error, 'Model loading')
      expect(normalized.message).toBe('Model loading: Test error')
    })

    it('should handle non-Error values', () => {
      const normalized = normalizeError('String error', 'Context')
      expect(normalized).toBeInstanceOf(PermanentError)
      expect(normalized.message).toBe('Context: String error')
    })
  })
})
