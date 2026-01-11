/**
 * Mobile device detection and adaptive settings utilities
 *
 * Provides functions to detect mobile devices and recommend optimal
 * TTS settings based on device capabilities for better mobile UX.
 */

import type { Quantization, Device } from '../../stores/ttsStore'
import logger from './logger'

export type ThreadingMode = 'single-threaded' | 'multi-threaded'

export interface OptimalTTSSettings {
  // Kokoro-specific settings
  quantization: Quantization
  device: Device
  chunkSize: number
  parallelChunks: number
  // Piper-specific settings
  piper: {
    chunkSize: number
    threadingMode: ThreadingMode
  }
}

/**
 * Detect if the current device is a mobile device
 */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false

  // Check for mobile user agent
  const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i
  const isMobileUA = mobileRegex.test(navigator.userAgent)

  // Also check for touch capability as a secondary signal
  const hasTouch =
    (typeof window !== 'undefined' && 'ontouchstart' in window) || navigator.maxTouchPoints > 0

  // Check screen size (mobile typically < 768px width)
  const isSmallScreen = typeof window !== 'undefined' && window.innerWidth < 768

  return isMobileUA || (hasTouch && isSmallScreen)
}

/**
 * Get device memory in GB (if available)
 * Returns undefined if not supported
 */
export function getDeviceMemory(): number | undefined {
  if (typeof navigator === 'undefined') return undefined

  // deviceMemory is a non-standard API but widely supported
  const nav = navigator as Navigator & { deviceMemory?: number }
  return nav.deviceMemory
}

/**
 * Check if the device has limited resources (mobile or low memory)
 */
export function isLowResourceDevice(): boolean {
  const memory = getDeviceMemory()
  const mobile = isMobileDevice()

  // Consider low resource if:
  // - Device memory is 4GB or less
  // - Or it's a mobile device (which typically has less thermal headroom)
  if (memory !== undefined && memory <= 4) return true
  if (mobile) return true

  return false
}

/**
 * Get optimal TTS settings for the current device
 *
 * Mobile/low-resource devices get:
 * - Smaller quantization (q4 vs q8) - ~4x smaller model
 * - Smaller chunk sizes - faster time-to-first-audio
 * - Lower parallelism - reduces memory pressure
 */
export function getOptimalTTSSettings(): OptimalTTSSettings {
  const memory = getDeviceMemory()
  const mobile = isMobileDevice()
  const lowResource = isLowResourceDevice()

  logger.info('[MobileDetect] Device capabilities:', {
    memory,
    mobile,
    lowResource,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 100) : 'N/A',
  })

  // High-resource desktop: Full quality
  if (!lowResource && memory && memory >= 8) {
    return {
      quantization: 'q8',
      device: 'auto', // May use WebGPU if available
      chunkSize: 1000,
      parallelChunks: 2,
      piper: {
        chunkSize: 400,
        threadingMode: 'multi-threaded',
      },
    }
  }

  // Medium resource (4-8GB RAM, non-mobile)
  if (!mobile && memory && memory > 4) {
    return {
      quantization: 'q8',
      device: 'wasm',
      chunkSize: 800,
      parallelChunks: 1,
      piper: {
        chunkSize: 400,
        threadingMode: 'multi-threaded',
      },
    }
  }

  // Mobile or low resource: Optimized for speed
  return {
    quantization: 'q4', // ~25MB vs ~100MB for q8
    device: 'wasm',
    chunkSize: 400, // Faster first-audio time
    parallelChunks: 1,
    piper: {
      chunkSize: 300, // Even smaller chunks for mobile Piper
      threadingMode: 'single-threaded',
    },
  }
}

/**
 * Get recommended chunk size for the current device
 * Smaller chunks = faster time-to-first-audio on mobile
 */
export function getRecommendedChunkSize(): number {
  return getOptimalTTSSettings().chunkSize
}

/**
 * Get recommended quantization for the current device
 */
export function getRecommendedQuantization(): Quantization {
  return getOptimalTTSSettings().quantization
}

/**
 * Get recommended chunk size for Piper TTS based on device capabilities
 * Mobile devices get smaller chunks (300) for faster time-to-first-audio
 * Desktop devices get standard chunks (400)
 */
export function getPiperChunkSize(): number {
  return getOptimalTTSSettings().piper.chunkSize
}

/**
 * Get recommended threading mode for Piper TTS based on device capabilities
 * Mobile/low-resource devices get single-threaded to reduce memory pressure
 * Desktop devices can use multi-threaded for better performance
 */
export function getPiperThreadingMode(): ThreadingMode {
  return getOptimalTTSSettings().piper.threadingMode
}
