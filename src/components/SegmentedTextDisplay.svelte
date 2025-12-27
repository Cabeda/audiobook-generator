<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { segmentProgress, type ChapterSegmentProgress } from '../stores/segmentProgressStore'
  import type { AudioSegment } from '../lib/types/audio'

  let {
    chapterId,
    content,
    onSegmentClick,
    isGenerating = false,
  } = $props<{
    chapterId: string
    content: string
    onSegmentClick?: (segmentIndex: number, segment: AudioSegment | undefined) => void
    isGenerating?: boolean
  }>()

  // Get segment progress for this chapter
  let progress = $derived($segmentProgress.get(chapterId))

  // Parse HTML content and identify segment spans
  let contentEl: HTMLDivElement | null = null

  // Apply visual states to segments based on generation progress
  $effect(() => {
    if (!contentEl || !progress) return

    const segmentEls = contentEl.querySelectorAll('span[id^="seg-"]')
    segmentEls.forEach((el) => {
      const segmentId = el.id
      const indexMatch = segmentId.match(/seg-(\d+)/)
      if (!indexMatch) return

      const index = parseInt(indexMatch[1], 10)
      const isGenerated = progress.generatedIndices.has(index)

      // Update classes for visual state
      el.classList.remove('segment-pending', 'segment-generated', 'segment-generating')

      if (isGenerated) {
        el.classList.add('segment-generated')
      } else if (isGenerating) {
        // Check if this is the next segment to be generated (for a pulsing effect)
        const lastGenerated = Math.max(...Array.from(progress.generatedIndices), -1)
        if (index === lastGenerated + 1) {
          el.classList.add('segment-generating')
        } else {
          el.classList.add('segment-pending')
        }
      } else {
        el.classList.add('segment-pending')
      }

      // Make generated segments clickable
      if (isGenerated) {
        el.setAttribute('role', 'button')
        el.setAttribute('tabindex', '0')
        el.setAttribute('aria-label', `Play segment ${index + 1}`)
      } else {
        el.removeAttribute('role')
        el.removeAttribute('tabindex')
        el.removeAttribute('aria-label')
      }
    })
  })

  function handleClick(event: MouseEvent) {
    const target = event.target as HTMLElement
    const segmentEl = target.closest('span[id^="seg-"]') as HTMLElement | null
    if (!segmentEl) return

    const indexMatch = segmentEl.id.match(/seg-(\d+)/)
    if (!indexMatch) return

    const index = parseInt(indexMatch[1], 10)

    // Only allow clicking on generated segments
    if (progress?.generatedIndices.has(index)) {
      const segment = progress.generatedSegments.get(index)
      onSegmentClick?.(index, segment)
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement
    if (!target.id.startsWith('seg-')) return

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const indexMatch = target.id.match(/seg-(\d+)/)
      if (!indexMatch) return

      const index = parseInt(indexMatch[1], 10)
      if (progress?.generatedIndices.has(index)) {
        const segment = progress.generatedSegments.get(index)
        onSegmentClick?.(index, segment)
      }
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="segmented-text-display"
  bind:this={contentEl}
  onclick={handleClick}
  onkeydown={handleKeyDown}
>
  {@html content}
</div>

<style>
  .segmented-text-display {
    line-height: 1.8;
  }

  /* Base segment styling */
  .segmented-text-display :global(span[id^='seg-']) {
    transition:
      background-color 0.3s ease,
      color 0.3s ease,
      opacity 0.3s ease;
    border-radius: 2px;
    padding: 1px 0;
  }

  /* Pending segments - muted appearance */
  .segmented-text-display :global(.segment-pending) {
    opacity: 0.5;
    color: var(--text-secondary, #666);
  }

  /* Currently generating segment - pulsing effect */
  .segmented-text-display :global(.segment-generating) {
    opacity: 0.7;
    animation: pulse 1.5s ease-in-out infinite;
    background-color: var(--accent-bg, rgba(59, 130, 246, 0.1));
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.5;
    }
    50% {
      opacity: 0.9;
    }
  }

  /* Generated segments - full appearance, clickable */
  .segmented-text-display :global(.segment-generated) {
    opacity: 1;
    color: var(--text-primary, inherit);
    cursor: pointer;
    position: relative;
  }

  .segmented-text-display :global(.segment-generated:hover) {
    background-color: var(--accent-bg, rgba(59, 130, 246, 0.15));
  }

  .segmented-text-display :global(.segment-generated:focus) {
    outline: 2px solid var(--accent-color, #3b82f6);
    outline-offset: 2px;
  }

  /* Active segment (currently playing) */
  .segmented-text-display :global(.segment-generated.active) {
    background-color: var(--accent-color, #3b82f6);
    color: white;
    padding: 2px 4px;
    margin: -2px -4px;
  }

  /* Progress indicator for generated text */
  .segmented-text-display :global(.segment-generated)::before {
    content: '';
    position: absolute;
    left: 0;
    bottom: -1px;
    width: 100%;
    height: 2px;
    background-color: var(--success-color, #22c55e);
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .segmented-text-display :global(.segment-generated:hover)::before {
    opacity: 0.5;
  }
</style>
