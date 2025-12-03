import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import logger from './logger'

describe('Logger', () => {
  // Store original console methods
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  }

  // Mock console methods
  beforeEach(() => {
    console.log = vi.fn()
    console.warn = vi.fn()
    console.error = vi.fn()
    console.debug = vi.fn()

    // Reset logger config before each test
    logger.configure({
      level: 'info',
      sendToBackend: false,
      silent: false,
    })
  })

  afterEach(() => {
    // Restore original console methods
    console.log = originalConsole.log
    console.warn = originalConsole.warn
    console.error = originalConsole.error
    console.debug = originalConsole.debug
  })

  describe('configuration', () => {
    it('should have default configuration', () => {
      const config = logger.getConfig()
      expect(config.level).toBeDefined()
      expect(config.sendToBackend).toBe(false)
      expect(config.backendUrl).toBeUndefined()
    })

    it('should allow updating configuration', () => {
      logger.configure({
        level: 'debug',
        sendToBackend: true,
        backendUrl: 'https://example.com/logs',
      })

      const config = logger.getConfig()
      expect(config.level).toBe('debug')
      expect(config.sendToBackend).toBe(true)
      expect(config.backendUrl).toBe('https://example.com/logs')
    })

    it('should partially update configuration', () => {
      logger.configure({ level: 'debug' })
      const config = logger.getConfig()
      expect(config.level).toBe('debug')
      expect(config.sendToBackend).toBe(false)
    })
  })

  describe('log levels', () => {
    it('should log info messages when level is info', () => {
      logger.configure({ level: 'info', silent: false })
      logger.info('[Test]', 'test message')
      expect(console.log).toHaveBeenCalled()
    })

    it('should log warn messages when level is info', () => {
      logger.configure({ level: 'info', silent: false })
      logger.warn('[Test]', 'warning message')
      expect(console.warn).toHaveBeenCalled()
    })

    it('should log error messages when level is info', () => {
      logger.configure({ level: 'info', silent: false })
      logger.error('[Test]', 'error message')
      expect(console.error).toHaveBeenCalled()
    })

    it('should not log debug messages when level is info', () => {
      logger.configure({ level: 'info', silent: false })
      logger.debug('[Test]', 'debug message')
      expect(console.debug).not.toHaveBeenCalled()
    })

    it('should log debug messages when level is debug', () => {
      logger.configure({ level: 'debug', silent: false })
      logger.debug('[Test]', 'debug message')
      expect(console.debug).toHaveBeenCalled()
    })

    it('should not log info messages when level is warn', () => {
      logger.configure({ level: 'warn', silent: false })
      logger.info('[Test]', 'info message')
      expect(console.log).not.toHaveBeenCalled()
    })

    it('should only log errors when level is error', () => {
      logger.configure({ level: 'error', silent: false })
      logger.info('[Test]', 'info message')
      logger.warn('[Test]', 'warning message')
      logger.error('[Test]', 'error message')

      expect(console.log).not.toHaveBeenCalled()
      expect(console.warn).not.toHaveBeenCalled()
      expect(console.error).toHaveBeenCalled()
    })
  })

  describe('silent mode', () => {
    it('should not log anything when silent is true', () => {
      logger.configure({ silent: true })
      logger.debug('[Test]', 'debug')
      logger.info('[Test]', 'info')
      logger.warn('[Test]', 'warn')
      logger.error('[Test]', 'error')

      expect(console.debug).not.toHaveBeenCalled()
      expect(console.log).not.toHaveBeenCalled()
      expect(console.warn).not.toHaveBeenCalled()
      expect(console.error).not.toHaveBeenCalled()
    })
  })

  describe('message formatting', () => {
    it('should format messages with prefix', () => {
      logger.configure({ level: 'info', silent: false })
      logger.info('[Test]', 'message')

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[Test]'))
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('message'))
    })

    it('should format messages with multiple arguments', () => {
      logger.configure({ level: 'info', silent: false })
      logger.info('[Test]', 'arg1', 'arg2', 123)

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('arg1'))
    })
  })

  describe('log alias', () => {
    it('should map log() to info()', () => {
      logger.configure({ level: 'info', silent: false })
      logger.log('[Test]', 'message')
      expect(console.log).toHaveBeenCalled()
    })
  })
})
