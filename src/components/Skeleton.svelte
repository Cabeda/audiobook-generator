<script lang="ts">
  let {
    width = '100%',
    height = '1em',
    lines = 1,
    variant = 'text',
  }: {
    width?: string
    height?: string
    lines?: number
    variant?: 'text' | 'rect' | 'circle'
  } = $props()
</script>

{#if variant === 'text' && lines > 1}
  <div class="skeleton-lines">
    {#each Array(lines) as _, i}
      <div
        class="skeleton skeleton-text"
        style:width={i === lines - 1 ? '60%' : width}
        style:height
      ></div>
    {/each}
  </div>
{:else}
  <div
    class="skeleton"
    class:skeleton-text={variant === 'text'}
    class:skeleton-rect={variant === 'rect'}
    class:skeleton-circle={variant === 'circle'}
    style:width={variant === 'circle' ? height : width}
    style:height
  ></div>
{/if}

<style>
  .skeleton {
    background: var(--surface-color, #2a2a2a);
    border-radius: 4px;
    position: relative;
    overflow: hidden;
  }

  .skeleton::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent,
      var(--shadow-color, rgba(255, 255, 255, 0.05)),
      transparent
    );
    animation: shimmer 1.5s infinite;
  }

  .skeleton-circle {
    border-radius: 50%;
  }

  .skeleton-lines {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  @keyframes shimmer {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }
</style>
