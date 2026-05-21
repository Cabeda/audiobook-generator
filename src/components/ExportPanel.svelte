<script lang="ts">
  import { EXPORT_FORMATS, type ExportFormat } from '../lib/exportFormats'

  let {
    selectedFormat = $bindable('mp3'),
    isGenerating = false,
    onExport,
  }: {
    selectedFormat: ExportFormat
    isGenerating: boolean
    onExport: () => void
  } = $props()

  let showFormatPicker = $state(false)
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<svelte:window onclick={() => (showFormatPicker = false)} />

<div class="export-split-btn">
  <button
    class="export-primary-btn export-main"
    onclick={onExport}
    disabled={isGenerating}
    title="Export as {selectedFormat.toUpperCase()}"
  >
    Export {selectedFormat.toUpperCase()}
  </button>
  <div class="export-dropdown-wrapper">
    <button
      class="export-primary-btn export-toggle"
      onclick={(e) => {
        e.stopPropagation()
        showFormatPicker = !showFormatPicker
      }}
      disabled={isGenerating}
      aria-label="Choose export format"
    >
      ▾
    </button>
    {#if showFormatPicker}
      <div class="export-format-menu" role="menu">
        {#each EXPORT_FORMATS as fmt}
          <button
            class="format-option"
            class:active={selectedFormat === fmt.value}
            role="menuitem"
            onclick={() => {
              selectedFormat = fmt.value
              showFormatPicker = false
            }}
          >
            {fmt.label}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .export-split-btn {
    display: flex;
    position: relative;
  }

  .export-primary-btn {
    background: var(--primary-color);
    color: var(--bg-color);
    border: none;
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
    transition:
      background-color 0.2s,
      box-shadow 0.2s;
  }

  .export-main {
    padding: 8px 16px;
    border-radius: 8px 0 0 8px;
    box-shadow: 0 2px 8px var(--shadow-color);
  }

  .export-dropdown-wrapper {
    position: relative;
  }

  .export-toggle {
    padding: 10px 10px;
    border-radius: 0 10px 10px 0;
    border-left: 1px solid rgba(255, 255, 255, 0.3);
    box-shadow: 0 4px 12px var(--shadow-color);
  }

  .export-primary-btn:hover:not(:disabled) {
    background: var(--primary-hover);
  }

  .export-main:hover:not(:disabled) {
    box-shadow: 0 6px 16px var(--shadow-color);
  }

  .export-primary-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
    filter: grayscale(0.5);
  }

  .export-format-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    box-shadow: 0 8px 24px var(--shadow-color);
    z-index: 20;
    min-width: 150px;
    overflow: hidden;
  }

  .format-option {
    display: block;
    width: 100%;
    padding: 10px 16px;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    font-size: 0.9rem;
    color: var(--text-color);
    transition: background-color 0.15s;
  }

  .format-option:hover {
    background: var(--hover-bg);
  }

  .format-option.active {
    font-weight: 600;
    color: var(--success-color, #22c55e);
  }

  @media (max-width: 768px) {
    .export-split-btn {
      flex: 1 1 0;
      min-width: 0;
    }

    .export-primary-btn {
      font-size: 0.85rem;
    }

    .export-main {
      flex: 1;
      min-width: 0;
      padding: 8px 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .export-toggle {
      padding: 8px 8px;
    }
  }
</style>
