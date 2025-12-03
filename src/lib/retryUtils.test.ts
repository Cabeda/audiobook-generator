import { describe, it, expect, vi } from 'vitest'
import { retryWithBackoff, withTimeout, isRetryableError } from './retryUtils'
import { TimeoutError, TransientError, PermanentError } from './errors'

describe('retryWithBackoff', () => {
  it('should return result on first successful attempt', async () => {
    const fn = vi.fn().mockResolvedValue('success')

    const result = await retryWithBackoff(fn, { initialDelay: 10 })

    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should retry on failure and eventually succeed', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('First failure'))
      .mockRejectedValueOnce(new Error('Second failure'))
      .mockResolvedValueOnce('success')

    const result = await retryWithBackoff(fn, { initialDelay: 10 })

    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('should throw error after max retries exceeded', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Persistent failure'))

    await expect(retryWithBackoff(fn, { maxRetries: 2, initialDelay: 10 })).rejects.toThrow(
      'Persistent failure'
    )
    expect(fn).toHaveBeenCalledTimes(3) // Initial + 2 retries
  })

  it('should use exponential backoff delays', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Failure'))
    const startTime = Date.now()

    await expect(
      retryWithBackoff(fn, {
        maxRetries: 2,
        initialDelay: 50,
        backoffMultiplier: 2,
      })
    ).rejects.toThrow('Failure')

    const elapsed = Date.now() - startTime
    // First retry: 50ms, Second retry: 100ms = 150ms total minimum
    expect(elapsed).toBeGreaterThanOrEqual(140) // Allow some margin
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('should respect maxDelay option', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Failure'))
    const startTime = Date.now()

    await expect(
      retryWithBackoff(fn, {
        maxRetries: 2,
        initialDelay: 50,
        backoffMultiplier: 10,
        maxDelay: 60,
      })
    ).rejects.toThrow('Failure')

    const elapsed = Date.now() - startTime
    // First retry: 50ms, Second retry: capped at 60ms (not 500ms) = 110ms total
    expect(elapsed).toBeGreaterThanOrEqual(100)
    expect(elapsed).toBeLessThan(200) // Should not take 500ms+
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('should respect shouldRetry option', async () => {
    const retryableError = new Error('Retryable error')
    const nonRetryableError = new Error('Non-retryable error')

    const fn = vi
      .fn()
      .mockRejectedValueOnce(retryableError)
      .mockRejectedValueOnce(nonRetryableError)
      .mockResolvedValueOnce('success')

    const shouldRetry = (error: Error) => error.message.includes('Retryable')

    await expect(
      retryWithBackoff(fn, {
        maxRetries: 3,
        initialDelay: 10,
        shouldRetry,
      })
    ).rejects.toThrow('Non-retryable error')
    expect(fn).toHaveBeenCalledTimes(2) // Initial + 1 retry (stops on non-retryable)
  })

  it('should handle non-Error exceptions', async () => {
    const fn = vi.fn().mockRejectedValue('String error')

    await expect(retryWithBackoff(fn, { maxRetries: 1, initialDelay: 10 })).rejects.toThrow(
      'String error'
    )
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('should use default options when none provided', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Failure'))

    await expect(retryWithBackoff(fn, { initialDelay: 10 })).rejects.toThrow('Failure')
    // Default maxRetries is 3, so should be called 4 times (initial + 3 retries)
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('should throw error when maxRetries is negative', async () => {
    const fn = vi.fn().mockResolvedValue('success')

    await expect(retryWithBackoff(fn, { maxRetries: -1 })).rejects.toThrow(
      'maxRetries must be a non-negative number'
    )
    expect(fn).toHaveBeenCalledTimes(0) // Should not call fn at all
  })

  it('should handle maxRetries of 0 (no retries)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Immediate failure'))

    await expect(retryWithBackoff(fn, { maxRetries: 0, initialDelay: 10 })).rejects.toThrow(
      'Immediate failure'
    )
    expect(fn).toHaveBeenCalledTimes(1) // Only initial attempt, no retries
  })

  it('should call onRetry callback on each retry', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Attempt 1'))
      .mockRejectedValueOnce(new Error('Attempt 2'))
      .mockResolvedValueOnce('success')

    const onRetry = vi.fn()

    const result = await retryWithBackoff(fn, {
      maxRetries: 3,
      initialDelay: 10,
      onRetry,
    })

    expect(result).toBe('success')
    expect(onRetry).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, 3, expect.any(Error))
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, 3, expect.any(Error))
  })

  it('should apply timeout when timeoutMs is specified', async () => {
    const fn = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve('success'), 200)
        })
    )

    await expect(
      retryWithBackoff(fn, {
        maxRetries: 0,
        timeoutMs: 50,
      })
    ).rejects.toThrow(TimeoutError)

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should succeed before timeout', async () => {
    const fn = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve('success'), 50)
        })
    )

    const result = await retryWithBackoff(fn, {
      maxRetries: 0,
      timeoutMs: 200,
    })

    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should use isRetryableError when explicitly provided as shouldRetry', async () => {
    const transientError = new TransientError('Network timeout')
    const permanentError = new PermanentError('Invalid input')

    // Should retry on transient error
    const fn1 = vi.fn().mockRejectedValueOnce(transientError).mockResolvedValueOnce('success')
    const result1 = await retryWithBackoff(fn1, {
      initialDelay: 10,
      shouldRetry: isRetryableError,
    })
    expect(result1).toBe('success')
    expect(fn1).toHaveBeenCalledTimes(2)

    // Should not retry on permanent error
    const fn2 = vi.fn().mockRejectedValue(permanentError)
    await expect(
      retryWithBackoff(fn2, { initialDelay: 10, shouldRetry: isRetryableError })
    ).rejects.toThrow(permanentError)
    expect(fn2).toHaveBeenCalledTimes(1)
  })
})

describe('withTimeout', () => {
  it('should resolve if promise completes before timeout', async () => {
    const promise = new Promise((resolve) => {
      setTimeout(() => resolve('success'), 50)
    })

    const result = await withTimeout(promise, 200)
    expect(result).toBe('success')
  })

  it('should reject with TimeoutError if promise takes too long', async () => {
    const promise = new Promise((resolve) => {
      setTimeout(() => resolve('success'), 200)
    })

    await expect(withTimeout(promise, 50)).rejects.toThrow(TimeoutError)
    await expect(withTimeout(promise, 50)).rejects.toThrow('Operation timed out after 50ms')
  })

  it('should reject with original error if promise rejects before timeout', async () => {
    const promise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Original error')), 50)
    })

    await expect(withTimeout(promise, 200)).rejects.toThrow('Original error')
  })

  it('should clear timeout on successful resolution', async () => {
    // This test verifies that the timeout is cleared and doesn't cause issues
    const promise = Promise.resolve('success')
    const result = await withTimeout(promise, 1000)
    expect(result).toBe('success')

    // Wait a bit to ensure no timeout fires
    await new Promise((resolve) => setTimeout(resolve, 50))
  })

  it('should clear timeout on rejection', async () => {
    const promise = Promise.reject(new Error('Test error'))

    await expect(withTimeout(promise, 1000)).rejects.toThrow('Test error')

    // Wait a bit to ensure no timeout fires
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
})
