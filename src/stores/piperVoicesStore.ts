import { writable, get } from 'svelte/store'
import type { PiperVoice } from '../lib/piper/piperClient'

export const piperVoices = writable<PiperVoice[]>([])

let loaded = false

export async function loadPiperVoices(): Promise<PiperVoice[]> {
  if (loaded) {
    return get(piperVoices)
  }
  try {
    const { PiperClient } = await import('../lib/piper/piperClient')
    const voices = await PiperClient.getInstance().getVoices()
    piperVoices.set(voices)
    loaded = true
    return voices
  } catch (e) {
    console.error('Failed to load Piper voices:', e)
    return []
  }
}
