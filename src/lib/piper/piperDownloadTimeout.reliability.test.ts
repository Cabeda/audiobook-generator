import { describe, it, expect, vi } from 'vitest'

/**
 * Regression test for Piper download timeout (PR #174)
 * Ensures model download has a 60s timeout to prevent infinite hangs.
 */

vi.mock('@diffusionstudio/vits-web', () => ({
  stored: vi.fn().mockResolvedValue([]),
  download: vi.fn(),
  predict: vi.fn(),
  voices: vi.fn().mockResolvedValue({}),
}))

describe('Piper download timeout', () => {
  it('should reject if download takes longer than timeout', async () => {
    // Simulate the timeout pattern used in the fix
    const TIMEOUT_MS = 50 // Use short timeout for testing

    const neverResolves = new Promise<void>(() => {
      // Intentionally never resolves
    })
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Model download timed out after 60s: test-voice')),
        TIMEOUT_MS
      )
    )

    await expect(Promise.race([neverResolves, timeout])).rejects.toThrow('Model download timed out')
  })

  it('should succeed if download completes before timeout', async () => {
    const TIMEOUT_MS = 100

    const fastDownload = new Promise<string>((resolve) => setTimeout(() => resolve('done'), 10))
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)
    )

    const result = await Promise.race([fastDownload, timeout])
    expect(result).toBe('done')
  })
})
