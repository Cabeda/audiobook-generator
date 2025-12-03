import { describe, it, expect, vi } from 'vitest'
import { retryWithBackoff } from './retryUtils'

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
})
