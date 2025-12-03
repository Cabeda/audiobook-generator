/**
 * Centralized logging utility for the audiobook generator
 * Provides configurable logging with levels and optional remote logging
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LoggerConfig {
  /** Minimum log level to display */
  level: LogLevel
  /** Whether to send error logs to remote backend */
  sendToBackend: boolean
  /** Whether to silence all logs (useful for tests) */
  silent: boolean
  /** Backend endpoint for remote logging */
  backendUrl?: string
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

class Logger {
  private config: LoggerConfig = {
    level: 'info',
    sendToBackend: false,
    silent: false,
  }

  constructor() {
    // Detect test environment and silence logs by default
    const isTestEnv =
      process.env.NODE_ENV === 'test' ||
      (globalThis as { __vitest__?: boolean }).__vitest__ === true

    if (isTestEnv) {
      this.config.silent = true
    }
  }

  /**
   * Configure the logger
   */
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current configuration
   */
  getConfig(): LoggerConfig {
    return { ...this.config }
  }

  private shouldLog(level: LogLevel): boolean {
    if (this.config.silent) return false
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level]
  }

  private formatMessage(level: LogLevel, prefix: string, ...args: unknown[]): string {
    const timestamp = new Date().toISOString()
    const levelStr = level.toUpperCase().padEnd(5)
    return `[${timestamp}] ${levelStr} ${prefix} ${args.map((a) => String(a)).join(' ')}`
  }

  private async sendToBackend(level: LogLevel, message: string, ...args: unknown[]): Promise<void> {
    if (!this.config.sendToBackend || !this.config.backendUrl) return

    // Only send warnings and errors to backend
    if (level !== 'warn' && level !== 'error') return

    try {
      await fetch(this.config.backendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          level,
          message,
          args: args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))),
          timestamp: new Date().toISOString(),
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        }),
      })
    } catch {
      // Fail silently - don't want remote logging to break the app or create infinite loops
    }
  }

  /**
   * Log a debug message
   */
  debug(prefix: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', prefix, ...args))
    }
  }

  /**
   * Log an info message
   */
  info(prefix: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', prefix, ...args))
    }
  }

  /**
   * Log a warning message
   */
  warn(prefix: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', prefix, ...args))
    }
    // Send to backend asynchronously (fire and forget)
    void this.sendToBackend('warn', prefix, ...args)
  }

  /**
   * Log an error message
   */
  error(prefix: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', prefix, ...args))
    }
    // Send to backend asynchronously (fire and forget)
    void this.sendToBackend('error', prefix, ...args)
  }

  /**
   * Log a simple message (maps to info by default)
   */
  log(prefix: string, ...args: unknown[]): void {
    this.info(prefix, ...args)
  }
}

// Singleton instance
const logger = new Logger()

export default logger
