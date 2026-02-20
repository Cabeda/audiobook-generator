export type KittenVoiceId =
  | 'Bella'
  | 'Jasper'
  | 'Luna'
  | 'Bruno'
  | 'Rosie'
  | 'Hugo'
  | 'Kiki'
  | 'Leo'

export const KITTEN_VOICE_ALIASES: Record<KittenVoiceId, string> = {
  Bella: 'expr-voice-2-f',
  Jasper: 'expr-voice-2-m',
  Luna: 'expr-voice-3-f',
  Bruno: 'expr-voice-3-m',
  Rosie: 'expr-voice-4-f',
  Hugo: 'expr-voice-4-m',
  Kiki: 'expr-voice-5-f',
  Leo: 'expr-voice-5-m',
}

const VOICES: KittenVoiceId[] = ['Bella', 'Jasper', 'Luna', 'Bruno', 'Rosie', 'Hugo', 'Kiki', 'Leo']

export function listVoices(): KittenVoiceId[] {
  return VOICES
}
