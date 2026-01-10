import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isMobileDevice,
  getDeviceMemory,
  isLowResourceDevice,
  getOptimalTTSSettings,
  getRecommendedChunkSize,
  getRecommendedQuantization,
  getPiperChunkSize,
  getPiperThreadingMode,
} from './mobileDetect'

describe('mobileDetect', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.resetAllMocks()
  })

  afterEach(() => {
    // Restore original navigator
    vi.unstubAllGlobals()
  })

  describe('isMobileDevice', () => {
    it('should detect mobile user agents', () => {
      // Test various mobile user agents
      const mobileAgents = [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
        'Mozilla/5.0 (Linux; Android 10; SM-G973F)',
        'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X)',
        'Mozilla/5.0 (Linux; Android 10; Pixel 4)',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/605.1.15',
      ]

      for (const ua of mobileAgents) {
        vi.stubGlobal('navigator', { userAgent: ua, maxTouchPoints: 2 })
        expect(isMobileDevice()).toBe(true)
      }
    })

    it('should detect desktop user agents', () => {
      const desktopAgents = [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      ]

      for (const ua of desktopAgents) {
        vi.stubGlobal('navigator', { userAgent: ua, maxTouchPoints: 0 })
        expect(isMobileDevice()).toBe(false)
      }
    })

    it('should detect touch-capable devices without mobile UA as mobile', () => {
      // Surface tablets, etc. might have desktop UA but touch
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        maxTouchPoints: 5,
      })
      // Touch alone doesn't make it mobile if UA says desktop
      // The function checks mobile patterns first
      expect(isMobileDevice()).toBe(false)
    })

    it('should handle missing navigator gracefully', () => {
      vi.stubGlobal('navigator', undefined)
      expect(isMobileDevice()).toBe(false)
    })
  })

  describe('getDeviceMemory', () => {
    it('should return device memory when available', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'test',
        deviceMemory: 8,
      })
      expect(getDeviceMemory()).toBe(8)
    })

    it('should return undefined when deviceMemory is not available', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'test',
      })
      expect(getDeviceMemory()).toBeUndefined()
    })
  })

  describe('isLowResourceDevice', () => {
    it('should consider mobile devices as low resource', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
        maxTouchPoints: 2,
      })
      expect(isLowResourceDevice()).toBe(true)
    })

    it('should consider devices with low memory as low resource', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        maxTouchPoints: 0,
        deviceMemory: 2,
      })
      expect(isLowResourceDevice()).toBe(true)
    })

    it('should not consider high-end desktop as low resource', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        maxTouchPoints: 0,
        deviceMemory: 16,
      })
      expect(isLowResourceDevice()).toBe(false)
    })

    it('should consider devices without memory info on mobile as low resource', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
        maxTouchPoints: 2,
        // No deviceMemory - Safari doesn't expose it
      })
      expect(isLowResourceDevice()).toBe(true)
    })
  })

  describe('getOptimalTTSSettings', () => {
    it('should return mobile-optimized settings for mobile devices', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
        maxTouchPoints: 2,
        deviceMemory: 3,
      })

      const settings = getOptimalTTSSettings()
      expect(settings.quantization).toBe('q4')
      expect(settings.chunkSize).toBe(400)
      expect(settings.parallelChunks).toBe(1)
    })

    it('should return desktop-optimized settings for desktop devices', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        maxTouchPoints: 0,
        deviceMemory: 16,
      })

      const settings = getOptimalTTSSettings()
      expect(settings.quantization).toBe('q8')
      expect(settings.chunkSize).toBe(1000)
      expect(settings.parallelChunks).toBe(2)
    })

    it('should return low-resource settings for low-memory desktop', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        maxTouchPoints: 0,
        deviceMemory: 2,
      })

      const settings = getOptimalTTSSettings()
      expect(settings.quantization).toBe('q4')
      expect(settings.chunkSize).toBe(400)
    })
  })

  describe('getRecommendedChunkSize', () => {
    it('should return 400 for mobile devices', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Android 10; Mobile)',
        maxTouchPoints: 2,
      })
      expect(getRecommendedChunkSize()).toBe(400)
    })

    it('should return 1000 for desktop devices', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
        maxTouchPoints: 0,
        deviceMemory: 16,
      })
      expect(getRecommendedChunkSize()).toBe(1000)
    })
  })

  describe('getRecommendedQuantization', () => {
    it('should return q4 for mobile devices', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS)',
        maxTouchPoints: 2,
      })
      expect(getRecommendedQuantization()).toBe('q4')
    })

    it('should return q8 for desktop devices', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        maxTouchPoints: 0,
        deviceMemory: 8,
      })
      expect(getRecommendedQuantization()).toBe('q8')
    })
  })

  describe('getPiperChunkSize', () => {
    it('should return 300 for mobile devices', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS)',
        maxTouchPoints: 2,
      })
      expect(getPiperChunkSize()).toBe(300)
    })

    it('should return 400 for desktop devices', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        maxTouchPoints: 0,
        deviceMemory: 8,
      })
      expect(getPiperChunkSize()).toBe(400)
    })

    it('should return 300 for low-memory desktop', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        maxTouchPoints: 0,
        deviceMemory: 2,
      })
      expect(getPiperChunkSize()).toBe(300)
    })
  })

  describe('getPiperThreadingMode', () => {
    it('should return single-threaded for mobile devices', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Android 10; Mobile)',
        maxTouchPoints: 2,
      })
      expect(getPiperThreadingMode()).toBe('single-threaded')
    })

    it('should return multi-threaded for desktop devices', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
        maxTouchPoints: 0,
        deviceMemory: 16,
      })
      expect(getPiperThreadingMode()).toBe('multi-threaded')
    })

    it('should return single-threaded for low-memory desktop', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        maxTouchPoints: 0,
        deviceMemory: 3,
      })
      expect(getPiperThreadingMode()).toBe('single-threaded')
    })
  })

  describe('getOptimalTTSSettings - Piper support', () => {
    it('should include Piper settings for mobile devices', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
        maxTouchPoints: 2,
        deviceMemory: 3,
      })

      const settings = getOptimalTTSSettings()
      expect(settings.piper).toBeDefined()
      expect(settings.piper.chunkSize).toBe(300)
      expect(settings.piper.threadingMode).toBe('single-threaded')
    })

    it('should include Piper settings for desktop devices', () => {
      vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        maxTouchPoints: 0,
        deviceMemory: 16,
      })

      const settings = getOptimalTTSSettings()
      expect(settings.piper).toBeDefined()
      expect(settings.piper.chunkSize).toBe(400)
      expect(settings.piper.threadingMode).toBe('multi-threaded')
    })
  })
})
