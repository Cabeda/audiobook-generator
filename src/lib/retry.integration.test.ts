import { describe, it, expect } from 'vitest'
import { retryWithBackoff, isRetryableError, withTimeout } from './retryUtils'
import {
  TransientError,
  PermanentError,
  TimeoutError,
  CancellationError,
  ModelLoadError,
  AudioGenerationError,
  FFmpegError,
} from './errors'

describe('Retry Integration Tests', () => {
  describe('Real-world retry scenarios', () => {
    it('should retry network failures with exponential backoff', async () => {
      let attempts = 0
      const networkCall = async () => {
        attempts++
        if (attempts < 3) {
          throw new Error('Network timeout')
        }
        return 'success'
      }

      const result = await retryWithBackoff(networkCall, {
        maxRetries: 3,
        initialDelay: 50,
        shouldRetry: isRetryableError,
      })

      expect(result).toBe('success')
      expect(attempts).toBe(3)
    })

    it('should not retry permanent errors', async () => {
      let attempts = 0
      const failingCall = async () => {
        attempts++
        throw new PermanentError('Invalid input')
      }

      await expect(
        retryWithBackoff(failingCall, {
          maxRetries: 3,
          initialDelay: 10,
          shouldRetry: isRetryableError,
        })
      ).rejects.toThrow(PermanentError)

      expect(attempts).toBe(1) // Should not retry
    })

    it('should handle timeout during retry', async () => {
      let attempts = 0
      const slowCall = async () => {
        attempts++
        await new Promise((resolve) => setTimeout(resolve, 200))
        return 'success'
      }

      await expect(
        retryWithBackoff(slowCall, {
          maxRetries: 2,
          initialDelay: 10,
          timeoutMs: 50,
        })
      ).rejects.toThrow(TimeoutError)

      expect(attempts).toBe(3) // Initial + 2 retries, all timing out
    })

    it('should succeed if operation completes before timeout', async () => {
      const fastCall = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return 'success'
      }

      const result = await retryWithBackoff(fastCall, {
        maxRetries: 2,
        initialDelay: 10,
        timeoutMs: 200,
      })

      expect(result).toBe('success')
    })
  })

  describe('Model loading scenarios', () => {
    it('should retry transient model load errors', async () => {
      let attempts = 0
      const loadModel = async () => {
        attempts++
        if (attempts < 2) {
          throw new ModelLoadError('Network timeout', 'kokoro', true)
        }
        return 'model-loaded'
      }

      const result = await retryWithBackoff(loadModel, {
        maxRetries: 3,
        initialDelay: 10,
        shouldRetry: isRetryableError,
      })

      expect(result).toBe('model-loaded')
      expect(attempts).toBe(2)
    })

    it('should not retry permanent model load errors', async () => {
      let attempts = 0
      const loadModel = async () => {
        attempts++
        throw new ModelLoadError('Model not found', 'kokoro', false)
      }

      await expect(
        retryWithBackoff(loadModel, {
          maxRetries: 3,
          initialDelay: 10,
          shouldRetry: isRetryableError,
        })
      ).rejects.toThrow(ModelLoadError)

      expect(attempts).toBe(1)
    })
  })

  describe('Audio generation scenarios', () => {
    it('should retry transient audio generation errors', async () => {
      let attempts = 0
      const generateAudio = async () => {
        attempts++
        if (attempts < 2) {
          throw new AudioGenerationError('Memory allocation failed', true)
        }
        return new Blob(['audio'], { type: 'audio/wav' })
      }

      const result = await retryWithBackoff(generateAudio, {
        maxRetries: 3,
        initialDelay: 10,
        shouldRetry: isRetryableError,
      })

      expect(result).toBeInstanceOf(Blob)
      expect(attempts).toBe(2)
    })

    it('should not retry permanent audio generation errors', async () => {
      let attempts = 0
      const generateAudio = async () => {
        attempts++
        throw new AudioGenerationError('Invalid voice parameter', false)
      }

      await expect(
        retryWithBackoff(generateAudio, {
          maxRetries: 3,
          initialDelay: 10,
          shouldRetry: isRetryableError,
        })
      ).rejects.toThrow(AudioGenerationError)

      expect(attempts).toBe(1)
    })
  })

  describe('FFmpeg operation scenarios', () => {
    it('should retry transient FFmpeg errors', async () => {
      let attempts = 0
      const ffmpegOp = async () => {
        attempts++
        if (attempts < 2) {
          throw new FFmpegError('Temporary resource unavailable', 'encoding', true)
        }
        return new Blob(['audio'], { type: 'audio/mp3' })
      }

      const result = await retryWithBackoff(ffmpegOp, {
        maxRetries: 3,
        initialDelay: 10,
        shouldRetry: isRetryableError,
      })

      expect(result).toBeInstanceOf(Blob)
      expect(attempts).toBe(2)
    })

    it('should not retry permanent FFmpeg errors', async () => {
      let attempts = 0
      const ffmpegOp = async () => {
        attempts++
        throw new FFmpegError('Invalid codec', 'encoding', false)
      }

      await expect(
        retryWithBackoff(ffmpegOp, {
          maxRetries: 3,
          initialDelay: 10,
          shouldRetry: isRetryableError,
        })
      ).rejects.toThrow(FFmpegError)

      expect(attempts).toBe(1)
    })
  })

  describe('Cancellation scenarios', () => {
    it('should not retry cancellation errors', async () => {
      let attempts = 0
      const cancellableOp = async () => {
        attempts++
        throw new CancellationError()
      }

      await expect(
        retryWithBackoff(cancellableOp, {
          maxRetries: 3,
          initialDelay: 10,
          shouldRetry: isRetryableError,
        })
      ).rejects.toThrow(CancellationError)

      expect(attempts).toBe(1) // Should not retry
    })
  })

  describe('Combined timeout and retry scenarios', () => {
    it('should retry on timeout up to maxRetries', async () => {
      let attempts = 0
      const slowOp = async () => {
        attempts++
        await new Promise((resolve) => setTimeout(resolve, 100))
        return 'success'
      }

      await expect(
        retryWithBackoff(slowOp, {
          maxRetries: 2,
          initialDelay: 10,
          timeoutMs: 50,
          shouldRetry: isRetryableError,
        })
      ).rejects.toThrow(TimeoutError)

      expect(attempts).toBe(3) // Initial + 2 retries
    })

    it('should succeed on retry after initial timeout', async () => {
      let attempts = 0
      const variableSpeedOp = async () => {
        attempts++
        const delay = attempts === 1 ? 100 : 30 // First attempt slow, second fast
        await new Promise((resolve) => setTimeout(resolve, delay))
        return 'success'
      }

      const result = await retryWithBackoff(variableSpeedOp, {
        maxRetries: 2,
        initialDelay: 10,
        timeoutMs: 80,
      })

      expect(result).toBe('success')
      expect(attempts).toBe(2)
    })
  })

  describe('Backoff behavior', () => {
    it('should apply exponential backoff between retries', async () => {
      const delays: number[] = []
      let attempts = 0

      const failingOp = async () => {
        attempts++
        if (attempts <= 3) {
          throw new TransientError('Temporary failure')
        }
        return 'success'
      }

      const startTime = Date.now()
      const result = await retryWithBackoff(failingOp, {
        maxRetries: 3,
        initialDelay: 50,
        backoffMultiplier: 2,
        shouldRetry: isRetryableError,
      })
      const elapsed = Date.now() - startTime

      expect(result).toBe('success')
      expect(attempts).toBe(4)
      // First retry: 50ms, Second: 100ms, Third: 200ms = 350ms minimum
      expect(elapsed).toBeGreaterThanOrEqual(330)
    })

    it('should cap delay at maxDelay', async () => {
      let attempts = 0
      const failingOp = async () => {
        attempts++
        if (attempts <= 3) {
          throw new TransientError('Temporary failure')
        }
        return 'success'
      }

      const startTime = Date.now()
      const result = await retryWithBackoff(failingOp, {
        maxRetries: 3,
        initialDelay: 50,
        backoffMultiplier: 10,
        maxDelay: 100,
        shouldRetry: isRetryableError,
      })
      const elapsed = Date.now() - startTime

      expect(result).toBe('success')
      // All delays should be capped at 100ms: 50 + 100 + 100 = 250ms
      expect(elapsed).toBeGreaterThanOrEqual(230)
      expect(elapsed).toBeLessThan(500) // Shouldn't reach 50 + 500 + 5000
    })
  })
})
