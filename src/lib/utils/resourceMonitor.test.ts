import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getDeviceTier, getStartingTier, getTargetTier, canRunUpgrade } from './resourceMonitor'

// Mock mobileDetect utilities
vi.mock('./mobileDetect', () => ({
  isMobileDevice: vi.fn(() => false),
  getDeviceMemory: vi.fn(() => undefined),
}))

import { isMobileDevice, getDeviceMemory } from './mobileDetect'

const mockMobile = isMobileDevice as ReturnType<typeof vi.fn>
const mockMemory = getDeviceMemory as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockMobile.mockReturnValue(false)
  mockMemory.mockReturnValue(undefined)
})

describe('getDeviceTier', () => {
  it('returns weak for mobile device', () => {
    mockMobile.mockReturnValue(true)
    expect(getDeviceTier()).toBe('weak')
  })

  it('returns weak when memory <= 4 GB', () => {
    mockMemory.mockReturnValue(4)
    expect(getDeviceTier()).toBe('weak')
  })

  it('returns strong when memory >= 8 GB and non-mobile', () => {
    mockMemory.mockReturnValue(8)
    expect(getDeviceTier()).toBe('strong')
  })

  it('returns medium when memory is between 4 and 8 GB and non-mobile', () => {
    mockMemory.mockReturnValue(6)
    expect(getDeviceTier()).toBe('medium')
  })

  it('returns medium when memory is unknown and non-mobile', () => {
    mockMemory.mockReturnValue(undefined)
    expect(getDeviceTier()).toBe('medium')
  })
})

describe('getStartingTier', () => {
  it('always returns 0 regardless of device tier (fast-start for all devices)', () => {
    mockMobile.mockReturnValue(true)
    expect(getStartingTier()).toBe(0)
  })

  it('returns 0 for medium device', () => {
    mockMemory.mockReturnValue(6)
    expect(getStartingTier()).toBe(0)
  })

  it('returns 0 for strong device', () => {
    mockMemory.mockReturnValue(16)
    expect(getStartingTier()).toBe(0)
  })
})

describe('getTargetTier', () => {
  it('returns 1 for weak device', () => {
    mockMobile.mockReturnValue(true)
    expect(getTargetTier()).toBe(1)
  })

  it('returns 2 for medium device', () => {
    mockMemory.mockReturnValue(6)
    expect(getTargetTier()).toBe(2)
  })

  it('returns 3 for strong device', () => {
    mockMemory.mockReturnValue(16)
    expect(getTargetTier()).toBe(3)
  })
})

describe('canRunUpgrade', () => {
  it('returns false when deviceMemory <= 2 GB', async () => {
    mockMemory.mockReturnValue(2)
    expect(await canRunUpgrade()).toBe(false)
  })

  it('returns true when deviceMemory > 2 GB and no battery/heap APIs', async () => {
    mockMemory.mockReturnValue(4)
    expect(await canRunUpgrade()).toBe(true)
  })

  it('returns false when battery is low and not charging', async () => {
    mockMemory.mockReturnValue(8)
    const nav = navigator as Navigator & { getBattery?: () => Promise<unknown> }
    nav.getBattery = vi.fn().mockResolvedValue({ level: 0.1, charging: false })
    expect(await canRunUpgrade()).toBe(false)
    delete nav.getBattery
  })

  it('returns true when battery is low but charging', async () => {
    mockMemory.mockReturnValue(8)
    const nav = navigator as Navigator & { getBattery?: () => Promise<unknown> }
    nav.getBattery = vi.fn().mockResolvedValue({ level: 0.1, charging: true })
    expect(await canRunUpgrade()).toBe(true)
    delete nav.getBattery
  })
})
