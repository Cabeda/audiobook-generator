import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseBundle, parseVoiceSlice, parseVoicesBin } from './pocketAssets'

const bundleJson = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src/lib/pocket/fixtures/bundle.json'), 'utf-8')
)

describe('parseBundle', () => {
  it('reads the model configuration from the manifest', () => {
    const bundle = parseBundle(bundleJson)

    expect(bundle.model).toBe('english_18m_refl_2026-10')
    expect(bundle.sample_rate).toBe(24000)
    expect(bundle.frame_size).toBe(1920)
    expect(bundle.dims.latent).toBe(32)
    expect(bundle.flow.type).toBe('drifting')
    expect(bundle.temperature).toBe(0.3)
    expect(bundle.eos.threshold).toBe(-1)
    expect(bundle.eos.min_frames).toBe(6)
  })

  it('reads the flow and decoder state descriptions', () => {
    const bundle = parseBundle(bundleJson)

    expect(bundle.flowStates.map((s) => s.name)).toContain('state_cache_0')
    expect(bundle.flowStates.find((s) => s.name === 'state_cache_0')?.shape).toEqual([
      2, 1, -1, 8, 64,
    ])
    expect(bundle.decoderStates.map((s) => s.name)).toContain('state_window_0')
  })

  it('reads the voice byte ranges', () => {
    const bundle = parseBundle(bundleJson)

    expect(Object.keys(bundle.voices)).toEqual(bundle.predefined_voices)
    const alba = bundle.voices.alba
    expect(alba.end).toBeGreaterThan(alba.start)
  })

  it('rejects a manifest without graph states', () => {
    expect(() => parseBundle({})).toThrow(/bundle.json/)
  })
})

describe('voice bundle', () => {
  /** Build a PTVB1 buffer with one voice holding one float32 tensor. */
  function buildVoiceBundle(withHeader = true): ArrayBuffer {
    const encoder = new TextEncoder()
    const chunks: Uint8Array[] = []
    const push = (bytes: Uint8Array) => chunks.push(bytes)
    const pushU16 = (value: number) => {
      const b = new Uint8Array(2)
      new DataView(b.buffer).setUint16(0, value, true)
      push(b)
    }
    const pushU32 = (value: number) => {
      const b = new Uint8Array(4)
      new DataView(b.buffer).setUint32(0, value, true)
      push(b)
    }
    const pushString = (value: string) => {
      const bytes = encoder.encode(value)
      pushU16(bytes.length)
      push(bytes)
    }

    if (withHeader) {
      push(encoder.encode('PTVB1'))
      pushU32(1) // voice count
    }
    pushString('alba')
    pushU16(1) // tensor count
    pushString('state_offset')
    push(new Uint8Array([0])) // float32
    push(new Uint8Array([1])) // rank
    pushU32(1) // shape
    pushU32(4) // byte length
    push(new Uint8Array(new Float32Array([42]).buffer))

    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    return out.buffer
  }

  it('reads a voice bundle', () => {
    const voices = parseVoicesBin(buildVoiceBundle())

    expect(Object.keys(voices)).toEqual(['alba'])
    const record = voices.alba.tensors.state_offset
    expect(record.dtype).toBe('float32')
    expect(record.shape).toEqual([1])
  })

  it('reads a single voice slice', () => {
    // A range request over voices.bin starts at the voice, not at the header.
    const voice = parseVoiceSlice(buildVoiceBundle(false))
    expect(voice.name).toBe('alba')
    expect(voice.tensors.state_offset.shape).toEqual([1])
  })

  it('rejects a file that is not a voice bundle', () => {
    expect(() => parseVoicesBin(new ArrayBuffer(8))).toThrow(/PTVB1/)
  })
})
