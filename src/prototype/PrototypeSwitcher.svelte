<script lang="ts">
  // PROTOTYPE (throwaway): floating variant switcher. Deliberately loud so it is
  // never mistaken for part of the design being evaluated.
  let {
    variants,
    current,
    stateSummary,
    onChange,
  }: {
    variants: Array<{ key: string; name: string }>
    current: string
    stateSummary: string
    onChange: (key: string) => void
  } = $props()

  function cycle(dir: 1 | -1) {
    const i = variants.findIndex((v) => v.key === current)
    const next = variants[(i + dir + variants.length) % variants.length]
    onChange(next.key)
  }

  function onKeydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    if (e.key === 'ArrowLeft') cycle(-1)
    else if (e.key === 'ArrowRight') cycle(1)
  }

  let label = $derived(variants.find((v) => v.key === current))
</script>

<svelte:window onkeydown={onKeydown} />

<div class="switcher" role="group" aria-label="Prototype variant switcher">
  <button class="arrow" onclick={() => cycle(-1)} aria-label="Previous variant">←</button>
  <div class="label">
    <strong>{label?.key}</strong>
    {label?.name}
    <span class="state">{stateSummary}</span>
  </div>
  <button class="arrow" onclick={() => cycle(1)} aria-label="Next variant">→</button>
</div>

<style>
  .switcher {
    position: fixed;
    bottom: calc(12px + env(safe-area-inset-bottom));
    left: 50%;
    transform: translateX(-50%);
    z-index: 9999;
    display: flex;
    align-items: center;
    gap: 2px;
    background: #111;
    color: #fff;
    border: 1px solid #333;
    border-radius: 999px;
    padding: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    font-family: system-ui, sans-serif;
    font-size: 12px;
    user-select: none;
  }

  .arrow {
    background: #262626;
    color: #fff;
    border: none;
    border-radius: 999px;
    width: 30px;
    height: 30px;
    font-size: 15px;
    cursor: pointer;
  }

  .arrow:hover {
    background: #f59e0b;
    color: #111;
  }

  .label {
    padding: 0 12px;
    white-space: nowrap;
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .label strong {
    color: #f59e0b;
  }

  .state {
    color: #9ca3af;
    margin-left: 8px;
    font-variant-numeric: tabular-nums;
  }
</style>
