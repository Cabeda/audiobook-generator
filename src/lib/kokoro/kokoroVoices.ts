// Lightweight voice metadata — no heavy dependencies
// Extracted from kokoroClient.ts so consumers that only need voice lists
// don't pull in kokoro-js (~2.9 MB)

export type VoiceId =
  | 'af_heart'
  | 'af_alloy'
  | 'af_aoede'
  | 'af_bella'
  | 'af_jessica'
  | 'af_kore'
  | 'af_nicole'
  | 'af_nova'
  | 'af_river'
  | 'af_sarah'
  | 'af_sky'
  | 'am_adam'
  | 'am_echo'
  | 'am_eric'
  | 'am_liam'
  | 'am_michael'
  | 'am_onyx'
  | 'am_puck'
  | 'am_santa'
  | 'bf_emma'
  | 'bf_isabella'
  | 'bm_george'
  | 'bm_lewis'
  | 'bf_alice'
  | 'bf_lily'
  | 'bm_daniel'
  | 'bm_fable'

const VOICES: VoiceId[] = [
  'af_heart',
  'af_alloy',
  'af_aoede',
  'af_bella',
  'af_jessica',
  'af_kore',
  'af_nicole',
  'af_nova',
  'af_river',
  'af_sarah',
  'af_sky',
  'am_adam',
  'am_echo',
  'am_eric',
  'am_liam',
  'am_michael',
  'am_onyx',
  'am_puck',
  'am_santa',
  'bf_emma',
  'bf_isabella',
  'bm_george',
  'bm_lewis',
  'bf_alice',
  'bf_lily',
  'bm_daniel',
  'bm_fable',
]

export function listVoices(): VoiceId[] {
  return VOICES
}

/** What each Kokoro voice is called in the pickers. */
export const voiceLabels: Record<string, string> = {
  af_heart: '❤️ Heart (Female American)',
  af_alloy: '🎵 Alloy (Female American)',
  af_aoede: '🎭 Aoede (Female American)',
  af_bella: '💫 Bella (Female American)',
  af_jessica: '🌸 Jessica (Female American)',
  af_kore: '🌺 Kore (Female American)',
  af_nicole: '✨ Nicole (Female American)',
  af_nova: '⭐ Nova (Female American)',
  af_river: '🌊 River (Female American)',
  af_sarah: '🌹 Sarah (Female American)',
  af_sky: '☁️ Sky (Female American)',
  am_adam: '👨 Adam (Male American)',
  am_echo: '📢 Echo (Male American)',
  am_eric: '🎤 Eric (Male American)',
  am_liam: '🎸 Liam (Male American)',
  am_michael: '🎩 Michael (Male American)',
  am_onyx: '💎 Onyx (Male American)',
  am_puck: '🎭 Puck (Male American)',
  am_santa: '🎅 Santa (Male American)',
  bf_emma: '🇬🇧 Emma (Female British)',
  bf_isabella: '🇬🇧 Isabella (Female British)',
  bf_alice: '🇬🇧 Alice (Female British)',
  bf_lily: '🇬🇧 Lily (Female British)',
  bm_george: '🇬🇧 George (Male British)',
  bm_lewis: '🇬🇧 Lewis (Male British)',
  bm_daniel: '🇬🇧 Daniel (Male British)',
  bm_fable: '🇬🇧 Fable (Male British)',
}
