/**
 * The KittenTTS 0.8 voice catalogue.
 *
 * Each voice is a 400 x 256 float32 table of style vectors; the row is picked
 * by the chunk's character count, which is how upstream does it. Two extra
 * pieces of calibration travel with the table: a per-voice speed prior, and the
 * display name to internal id aliases from `config.json`.
 */

export const KITTEN_VOICES = [
  'Bella',
  'Jasper',
  'Luna',
  'Bruno',
  'Rosie',
  'Hugo',
  'Kiki',
  'Leo',
] as const

export type KittenVoice = (typeof KITTEN_VOICES)[number]

/** Display name to internal id, from the upstream `voice_aliases`. */
export const KITTEN_VOICE_IDS: Record<string, string> = {
  Bella: 'expr-voice-2-f',
  Jasper: 'expr-voice-2-m',
  Luna: 'expr-voice-3-f',
  Bruno: 'expr-voice-3-m',
  Rosie: 'expr-voice-4-f',
  Hugo: 'expr-voice-4-m',
  Kiki: 'expr-voice-5-f',
  Leo: 'expr-voice-5-m',
}

/** Per-voice speed multiplier, from the upstream `speed_priors`. */
export const KITTEN_SPEED_PRIORS: Record<string, number> = {
  'expr-voice-2-f': 0.8,
  'expr-voice-2-m': 0.8,
  'expr-voice-3-f': 0.8,
  'expr-voice-3-m': 0.8,
  'expr-voice-4-f': 0.8,
  'expr-voice-4-m': 0.9,
  'expr-voice-5-f': 0.8,
  'expr-voice-5-m': 0.8,
}

/** Style rows per voice in the shipped bundle. */
export const KITTEN_STYLE_ROWS = 400

/** Style width per row in the shipped bundle. */
export const KITTEN_STYLE_WIDTH = 256

/** The order the voices appear in `public/models/kitten/voices-v0.8.bin`. */
export const KITTEN_BUNDLE_ORDER = [
  'expr-voice-2-f',
  'expr-voice-2-m',
  'expr-voice-3-f',
  'expr-voice-3-m',
  'expr-voice-4-f',
  'expr-voice-4-m',
  'expr-voice-5-f',
  'expr-voice-5-m',
] as const

/** The internal id for a requested voice, or the first voice when unknown. */
export function resolveKittenVoice(voice: string | undefined): string {
  return (voice && KITTEN_VOICE_IDS[voice]) || KITTEN_VOICE_IDS[KITTEN_VOICES[0]]
}

/** Apply the voice's speed prior to the requested speed. */
export function kittenSpeed(voiceId: string, speed: number = 1): number {
  return speed * (KITTEN_SPEED_PRIORS[voiceId] ?? 1)
}

/** The style row for a chunk, by its character count, clamped to the table. */
export function styleRowIndex(textLength: number): number {
  return Math.min(textLength, KITTEN_STYLE_ROWS - 1)
}

/**
 * Slice one style vector out of the whole voice bundle. The bundle is every
 * voice laid out back to back, row-major, so the offset is arithmetic.
 */
export function voiceStyle(
  bundle: Float32Array,
  voiceId: string,
  textLength: number
): Float32Array {
  const voice = KITTEN_BUNDLE_ORDER.indexOf(voiceId as (typeof KITTEN_BUNDLE_ORDER)[number])
  const slot = (voice < 0 ? 0 : voice) * KITTEN_STYLE_ROWS + styleRowIndex(textLength)
  const start = slot * KITTEN_STYLE_WIDTH
  return bundle.subarray(start, start + KITTEN_STYLE_WIDTH)
}
