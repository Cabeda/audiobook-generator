type StallWatchdogOptions = {
  /** No progress for this long counts as a stall. */
  limitMs: number
  onStall: () => void
  /** How often to check. */
  intervalMs?: number
}

/**
 * Calls `onStall` once when nothing has reported progress for `limitMs`.
 *
 * A chapter of TTS is minutes of work behind a single await, so a worker that
 * stops answering looks identical to a slow one. This turns that into an error
 * the generation loop can recover from.
 */
export class StallWatchdog {
  private readonly limitMs: number
  private readonly intervalMs: number
  private readonly onStall: () => void
  private lastProgressAt = Date.now()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(options: StallWatchdogOptions) {
    this.limitMs = options.limitMs
    this.intervalMs = options.intervalMs ?? 30_000
    this.onStall = options.onStall
  }

  touch(): void {
    this.lastProgressAt = Date.now()
  }

  start(): void {
    if (this.timer) return
    this.lastProgressAt = Date.now()
    this.timer = setInterval(() => {
      if (Date.now() - this.lastProgressAt < this.limitMs) return
      this.stop()
      this.onStall()
    }, this.intervalMs)
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }
}
