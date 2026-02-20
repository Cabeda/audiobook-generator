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
 * Always returns 0 so every device benefits from fast-start (instant Web Speech audio
 * while higher-quality audio is generated in the background).
 * The device tier only affects the upgrade ceiling via getTargetTier().
 */
export function getStartingTier(): 0 {
  return 0
}

/** Target (maximum) quality tier index for the current device. */
export function getTargetTier(): 1 | 2 | 3 {
  const tier = getDeviceTier()
  if (tier === 'weak') return 1
  if (tier === 'medium') return 2
  return 3
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
