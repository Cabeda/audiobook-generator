/**
 * Adaptive Quality TTS Service
 *
 * Implements a two-pass strategy:
 *  Pass 1 (fast): generate all segments at the cheapest tier for the device.
 *  Pass 2 (upgrade): silently re-generate upcoming segments at higher tiers
 *                    while the user listens, swapping them in before playback.
 */

import type { AudioSegment } from '../types/audio'
import type { PiperVoice } from '../piper/piperClient'
import { isKokoroLanguageSupported, normalizeLanguageCode } from '../utils/voiceSelector'
import { getStartingTier, getTargetTier, canRunUpgrade } from '../utils/resourceMonitor'
import { updateSegmentQuality, getChapterSegmentProgress } from '../../stores/segmentProgressStore'
import logger from '../utils/logger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TierConfig {
  model: 'kokoro' | 'piper' | 'web_speech'
  voice: string
  quantization?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
  device?: 'auto' | 'wasm' | 'webgpu' | 'cpu'
}

interface TierLadder {
  tiers: Array<TierConfig | null> // index = tier number; null = tier not available
  maxAvailableTier: number
}

// ---------------------------------------------------------------------------
// Tier ladder resolution
// ---------------------------------------------------------------------------

/**
 * Build the tier ladder for a given language.
 * English uses Kokoro; other languages use Piper.
 * Tiers with no available voice are set to null.
 */
export function resolveTierLadder(language: string, piperVoices: PiperVoice[]): TierLadder {
  const useKokoro = isKokoroLanguageSupported(language)

  if (useKokoro) {
    return {
      tiers: [
        { model: 'web_speech', voice: '' }, // tier 0
        { model: 'kokoro', voice: 'af_heart', quantization: 'q4', device: 'wasm' }, // tier 1
        { model: 'kokoro', voice: 'af_heart', quantization: 'q8', device: 'wasm' }, // tier 2
        { model: 'kokoro', voice: 'af_heart', quantization: 'fp16', device: 'auto' }, // tier 3
      ],
      maxAvailableTier: 3,
    }
  }

  // Piper ladder — skip tiers with no available voice for this language
  const tierConfigs: Array<TierConfig | null> = [
    { model: 'web_speech', voice: '' }, // tier 0 always available
  ]

  let maxAvailableTier = 0

  const qualityForTier: Record<number, PiperVoice['quality']> = { 1: 'low', 2: 'medium', 3: 'high' }

  for (const piperTier of [1, 2, 3] as const) {
    const targetQuality = qualityForTier[piperTier]
    const langVoices = piperVoices.filter((v) => {
      return normalizeLanguageCode(v.language) === normalizeLanguageCode(language)
    })
    const exactMatch = langVoices.find((v) => v.quality === targetQuality)
    if (exactMatch) {
      tierConfigs.push({ model: 'piper', voice: exactMatch.key })
      maxAvailableTier = piperTier
    } else {
      tierConfigs.push(null)
    }
  }

  return { tiers: tierConfigs, maxAvailableTier }
}

/**
 * Get the generation config for a specific tier.
 * Returns null if the tier is not available.
 */
export function getTierConfig(
  tier: number,
  language: string,
  piperVoices: PiperVoice[]
): TierConfig | null {
  const ladder = resolveTierLadder(language, piperVoices)
  return ladder.tiers[tier] ?? null
}

// ---------------------------------------------------------------------------
// Upgrade loop state
// ---------------------------------------------------------------------------

const activeUpgrades = new Map<
  string,
  { cancelled: boolean; timer: ReturnType<typeof setTimeout> }
>()

// ---------------------------------------------------------------------------
// Fast pass
// ---------------------------------------------------------------------------

/**
 * Generate all segments at the starting tier for the device.
 * Calls onSegmentReady for each segment as it completes.
 */
export async function startFastPass(
  segments: Array<{ index: number; text: string; id: string; chapterId: string }>,
  language: string,
  piperVoices: PiperVoice[],
  onSegmentReady: (segment: AudioSegment) => void
): Promise<void> {
  const startingTier = getStartingTier()
  const ladder = resolveTierLadder(language, piperVoices)

  // If skipWebSpeech is handled by the caller, we still respect the ladder
  let effectiveTier = startingTier
  // Walk down to find the first available tier
  while (effectiveTier > 0 && !ladder.tiers[effectiveTier]) {
    effectiveTier--
  }

  const config = ladder.tiers[effectiveTier]
  if (!config) {
    logger.warn('[AdaptiveQuality] No tier config available for fast pass')
    return
  }

  logger.info(`[AdaptiveQuality] Fast pass at tier ${effectiveTier}`, { language, config })

  const { getTTSWorker } = await import('../ttsWorkerManager')
  const worker = getTTSWorker()

  for (const seg of segments) {
    try {
      const blob = await worker.generateVoice({
        text: seg.text,
        modelType: config.model === 'web_speech' ? 'kokoro' : config.model,
        voice: config.voice,
        dtype: config.quantization,
        device: config.device,
      })

      const audioSegment: AudioSegment = {
        id: seg.id,
        chapterId: seg.chapterId,
        index: seg.index,
        text: seg.text,
        audioBlob: blob,
        duration: 0,
        startTime: 0,
        qualityTier: effectiveTier,
      }

      updateSegmentQuality(seg.chapterId, seg.index, effectiveTier)
      onSegmentReady(audioSegment)
    } catch (err) {
      logger.error(`[AdaptiveQuality] Fast pass failed for segment ${seg.index}`, err)
    }
  }
}

// ---------------------------------------------------------------------------
// Upgrade pass
// ---------------------------------------------------------------------------

/**
 * Schedule a background upgrade loop for a chapter.
 * Runs one segment per tick (every 5 s), prioritising upcoming segments.
 */
export function scheduleUpgradePass(
  chapterId: string,
  bookId: number,
  language: string,
  piperVoices: PiperVoice[],
  getCurrentIndex: () => number,
  onSegmentUpgraded: (segment: AudioSegment) => void,
  upgradePlayedSegments = true
): void {
  // Cancel any existing upgrade for this chapter
  cancelUpgrade(chapterId)

  const targetTier = getTargetTier()
  const ladder = resolveTierLadder(language, piperVoices)

  // Find the actual max available tier
  let effectiveTarget = targetTier as number
  while (effectiveTarget > 0 && !ladder.tiers[effectiveTarget]) {
    effectiveTarget--
  }

  if (effectiveTarget === 0) {
    logger.info('[AdaptiveQuality] No upgrade possible — only Web Speech available')
    return
  }

  const state = { cancelled: false, timer: null as unknown as ReturnType<typeof setTimeout> }
  activeUpgrades.set(chapterId, state)

  const tick = async () => {
    if (state.cancelled) return

    const canUpgrade = await canRunUpgrade()
    if (!canUpgrade) {
      logger.debug('[AdaptiveQuality] Skipping upgrade tick — resources constrained')
      scheduleNext()
      return
    }

    const progress = getChapterSegmentProgress(chapterId)
    if (!progress) {
      scheduleNext()
      return
    }

    const currentIndex = getCurrentIndex()

    // Build candidate list: upcoming first, then played (if enabled)
    const upcoming: number[] = []
    const played: number[] = []

    for (const [idx, tier] of progress.segmentQuality.entries()) {
      if (tier >= effectiveTarget) continue // already at target
      if (idx > currentIndex && idx <= currentIndex + 10) {
        upcoming.push(idx)
      } else if (upgradePlayedSegments && idx < currentIndex) {
        played.push(idx)
      }
    }

    // Sort upcoming ascending, played descending (most recent first)
    upcoming.sort((a, b) => a - b)
    played.sort((a, b) => b - a)

    const candidates = [...upcoming, ...played]
    if (candidates.length === 0) {
      logger.info('[AdaptiveQuality] All segments at target tier — upgrade complete')
      return
    }

    const segIndex = candidates[0]
    const currentTier = progress.segmentQuality.get(segIndex) ?? 0
    const nextTier = currentTier + 1

    const config = ladder.tiers[nextTier]
    if (!config) {
      scheduleNext()
      return
    }

    logger.debug(
      `[AdaptiveQuality] Upgrading segment ${segIndex} from tier ${currentTier} → ${nextTier}`
    )

    try {
      const { getTTSWorker } = await import('../ttsWorkerManager')
      const worker = getTTSWorker()

      const segData = progress.generatedSegments.get(segIndex)
      if (!segData) {
        scheduleNext()
        return
      }

      const blob = await worker.generateVoice({
        text: segData.text,
        modelType: config.model === 'web_speech' ? 'kokoro' : config.model,
        voice: config.voice,
        dtype: config.quantization,
        device: config.device,
      })

      if (state.cancelled) return

      const upgraded: AudioSegment = {
        ...segData,
        audioBlob: blob,
        qualityTier: nextTier,
      }

      // Persist to DB
      await replaceSegmentInDB(bookId, chapterId, upgraded)

      // Update quality tracking
      updateSegmentQuality(chapterId, segIndex, nextTier)

      // Notify caller (audioPlaybackService will swap the blob)
      onSegmentUpgraded(upgraded)

      logger.info(`[AdaptiveQuality] Segment ${segIndex} upgraded to tier ${nextTier}`)
    } catch (err) {
      logger.warn(`[AdaptiveQuality] Failed to upgrade segment ${segIndex}`, err)
    }

    scheduleNext()
  }

  const scheduleNext = () => {
    if (!state.cancelled) {
      state.timer = setTimeout(tick, 5000)
    }
  }

  // Start first tick after a short delay to let fast pass settle
  state.timer = setTimeout(tick, 5000)
}

/**
 * Cancel the upgrade loop for a chapter.
 */
export function cancelUpgrade(chapterId: string): void {
  const state = activeUpgrades.get(chapterId)
  if (state) {
    state.cancelled = true
    clearTimeout(state.timer)
    activeUpgrades.delete(chapterId)
    logger.debug(`[AdaptiveQuality] Cancelled upgrade for chapter ${chapterId}`)
  }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/**
 * Overwrite a segment's blob in IndexedDB with a higher-quality version.
 */
export async function replaceSegmentInDB(
  bookId: number,
  chapterId: string,
  segment: AudioSegment
): Promise<void> {
  try {
    const { saveSegmentIndividually } = await import('../libraryDB')
    await saveSegmentIndividually(bookId, chapterId, segment)
    logger.debug(`[AdaptiveQuality] Replaced segment ${segment.index} in DB`)
  } catch (err) {
    logger.warn(`[AdaptiveQuality] Failed to replace segment ${segment.index} in DB`, err)
  }
}
