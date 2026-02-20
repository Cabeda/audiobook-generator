import { describe, it, expect } from 'vitest'
import { VARIANT_CONFIG, type KittenVariant } from './kittenClient'
import { ADVANCED_SETTINGS_SCHEMA } from '../types/settings'

describe('KittenTTS variant config', () => {
  const variants: KittenVariant[] = ['nano', 'micro', 'mini']

  it.each(variants)('variant %s has valid modelUrl and voicesUrl', (variant) => {
    const cfg = VARIANT_CONFIG[variant]
    expect(cfg.modelUrl).toMatch(/^https:\/\/huggingface\.co\/KittenML\/kitten-tts/)
    expect(cfg.voicesUrl).toMatch(/voices\.npz$/)
    expect(cfg.sizeMb).toBeGreaterThan(0)
  })

  it('nano is smallest, mini is largest', () => {
    expect(VARIANT_CONFIG.nano.sizeMb).toBeLessThan(VARIANT_CONFIG.micro.sizeMb)
    expect(VARIANT_CONFIG.micro.sizeMb).toBeLessThan(VARIANT_CONFIG.mini.sizeMb)
  })

  it('each variant points to a different model file', () => {
    const urls = variants.map((v) => VARIANT_CONFIG[v].modelUrl)
    expect(new Set(urls).size).toBe(3)
  })
})

describe('ADVANCED_SETTINGS_SCHEMA kitten entry', () => {
  const kittenSettings = ADVANCED_SETTINGS_SCHEMA['kitten']

  it('has kitten settings defined', () => {
    expect(kittenSettings).toBeDefined()
    expect(kittenSettings.length).toBeGreaterThan(0)
  })

  it('has modelVariant select with nano/micro/mini options', () => {
    const variantSetting = kittenSettings.find((s) => s.key === 'modelVariant')
    expect(variantSetting).toBeDefined()
    expect(variantSetting!.type).toBe('select')
    expect(variantSetting!.defaultValue).toBe('micro')
    const values = variantSetting!.options!.map((o) => o.value)
    expect(values).toContain('nano')
    expect(values).toContain('micro')
    expect(values).toContain('mini')
  })

  it('has speed slider with valid range', () => {
    const speedSetting = kittenSettings.find((s) => s.key === 'speed')
    expect(speedSetting).toBeDefined()
    expect(speedSetting!.type).toBe('slider')
    expect(speedSetting!.min).toBeLessThan(1)
    expect(speedSetting!.max).toBeGreaterThan(1)
    expect(speedSetting!.defaultValue).toBe(1.0)
  })
})
