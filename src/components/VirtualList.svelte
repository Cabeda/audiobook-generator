<script lang="ts">
  import { onMount } from 'svelte'

  /**
   * Lightweight virtual list for rendering large lists efficiently.
   * Only renders items visible in the viewport plus a configurable buffer.
   */
  let {
    items,
    itemHeight = 80,
    buffer = 5,
    children,
  }: {
    items: any[]
    itemHeight?: number
    buffer?: number
    children: any
  } = $props()

  let container = $state<HTMLElement | null>(null)
  let scrollTop = $state(0)
  let containerHeight = $state(600)

  let totalHeight = $derived(items.length * itemHeight)
  let startIndex = $derived(Math.max(0, Math.floor(scrollTop / itemHeight) - buffer))
  let endIndex = $derived(
    Math.min(items.length, Math.ceil((scrollTop + containerHeight) / itemHeight) + buffer)
  )
  let visibleItems = $derived(
    items.slice(startIndex, endIndex).map((item, i) => ({
      item,
      index: startIndex + i,
    }))
  )
  let offsetY = $derived(startIndex * itemHeight)

  function handleScroll() {
    if (container) {
      scrollTop = container.scrollTop
    }
  }

  onMount(() => {
    if (container) {
      containerHeight = container.clientHeight
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          containerHeight = entry.contentRect.height
        }
      })
      observer.observe(container)
      return () => observer.disconnect()
    }
  })
</script>

<div class="virtual-list" bind:this={container} onscroll={handleScroll}>
  <div class="virtual-list-spacer" style="height: {totalHeight}px">
    <div class="virtual-list-content" style="transform: translateY({offsetY}px)">
      {@render children(visibleItems)}
    </div>
  </div>
</div>

<style>
  .virtual-list {
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .virtual-list-spacer {
    position: relative;
  }

  .virtual-list-content {
    will-change: transform;
  }
</style>
