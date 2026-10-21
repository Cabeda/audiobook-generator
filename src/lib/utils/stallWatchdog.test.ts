import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StallWatchdog } from './stallWatchdog'

describe('StallWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports a stall when nothing touches it for the limit', () => {
    const onStall = vi.fn()
    const watchdog = new StallWatchdog({ limitMs: 60_000, intervalMs: 10_000, onStall })

    watchdog.start()
    vi.advanceTimersByTime(59_000)
    expect(onStall).not.toHaveBeenCalled()

    vi.advanceTimersByTime(11_000)
    expect(onStall).toHaveBeenCalledTimes(1)
  })

  it('stays quiet while progress keeps arriving', () => {
    const onStall = vi.fn()
    const watchdog = new StallWatchdog({ limitMs: 60_000, intervalMs: 10_000, onStall })

    watchdog.start()
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(30_000)
      watchdog.touch()
    }

    expect(onStall).not.toHaveBeenCalled()
  })

  it('reports a stall only once', () => {
    const onStall = vi.fn()
    const watchdog = new StallWatchdog({ limitMs: 10_000, intervalMs: 5_000, onStall })

    watchdog.start()
    vi.advanceTimersByTime(100_000)

    expect(onStall).toHaveBeenCalledTimes(1)
  })

  it('does nothing after stop', () => {
    const onStall = vi.fn()
    const watchdog = new StallWatchdog({ limitMs: 10_000, intervalMs: 5_000, onStall })

    watchdog.start()
    watchdog.stop()
    vi.advanceTimersByTime(100_000)

    expect(onStall).not.toHaveBeenCalled()
  })
})
