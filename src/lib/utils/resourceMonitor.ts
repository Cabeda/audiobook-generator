/**
 * Resource monitor for adaptive quality TTS.
 * Determines device tier and whether background upgrade passes can run.
 */

import { isMobileDevice, getDeviceMemory } from './mobileDetect'

export type DeviceTier = 'weak' | 'medium' | 'strong'

/**
 * Classify the device into a tier based on mobile status and RAM.
 * - weak:   mobile OR ≤4 GB RAM
 * - medium: non-mobile, 4–8 GB RAM
 * - strong: non-mobile, ≥8 GB RAM
 */
export function getDeviceTier(): DeviceTier {
  const mobile = isMobileDevice()
  const memory = getDeviceMemory()

  if (mobile || (memory !== undefined && memory <= 4)) return 'weak'
  if (memory !== undefined && memory >= 8) return 'strong'
  return 'medium'
}

/**
 * Starting quality tier index.
 * Always returns 0 so every device starts at the cheapest generating tier and
 * upgrades in the background. The device tier only affects the upgrade ceiling
 * via getTargetTier().
 */
export function getStartingTier(): 0 {
  return 0
}

/** Target (maximum) quality tier index for the current device. */
export function getTargetTier(): 0 | 1 | 2 {
  const tier = getDeviceTier()
  if (tier === 'weak') return 0
  if (tier === 'medium') return 1
  return 2
}

/**
 * Check whether a background upgrade pass is safe to run right now.
 * Returns false when:
 *  - Battery is below 20 % and not charging (Battery Status API)
 *  - JS heap usage exceeds 80 % (performance.memory)
 *  - deviceMemory is ≤ 2 GB
 */
export async function canRunUpgrade(): Promise<boolean> {
  // Hard block on very low memory devices
  const memory = getDeviceMemory()
  if (memory !== undefined && memory <= 2) return false

  // Battery check (optional API)
  try {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number; charging: boolean }>
    }
    if (nav.getBattery) {
      const battery = await nav.getBattery()
      if (!battery.charging && battery.level < 0.2) return false
    }
  } catch {
    // API not available — ignore
  }

  // Heap check (Chrome-only non-standard API)
  try {
    const perf = performance as Performance & {
      memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number }
    }
    if (perf.memory) {
      const ratio = perf.memory.usedJSHeapSize / perf.memory.jsHeapSizeLimit
      if (ratio > 0.8) return false
    }
  } catch {
    // API not available — ignore
  }

  return true
}

/**
 * Restart the TTS worker once the whole agent cluster passes this. The WASM heap
 * that actually grows during generation is invisible to `performance.memory`,
 * which only sees the main-thread JS heap.
 */
export const WORKER_RESTART_MEMORY_LIMIT_BYTES = 2 * 1024 ** 3

type MemoryPerformance = Performance & {
  measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>
  memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number }
}

/**
 * Check whether the TTS worker should be restarted due to memory pressure.
 * Returns true when:
 *  - the agent cluster (page + TTS worker + its WASM heap) exceeds the budget
 *  - or, where that API is unavailable, JS heap usage exceeds 70% of the limit
 *  - otherwise false (Firefox, Safari)
 *
 * This is a proactive check — restart the worker BEFORE OOM rather than after.
 */
export async function shouldRestartWorkerForMemory(): Promise<boolean> {
  const perf = performance as MemoryPerformance

  if (perf.measureUserAgentSpecificMemory) {
    try {
      const { bytes } = await perf.measureUserAgentSpecificMemory()
      return bytes > WORKER_RESTART_MEMORY_LIMIT_BYTES
    } catch {
      // Not cross-origin isolated, or too many contexts — fall through.
    }
  }

  try {
    if (perf.memory) {
      const ratio = perf.memory.usedJSHeapSize / perf.memory.jsHeapSizeLimit
      if (ratio > 0.7) return true
    }
  } catch {
    // API not available — ignore
  }

  return false
}
