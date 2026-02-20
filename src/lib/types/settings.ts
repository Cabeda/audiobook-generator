export interface ModelSettingOption {
  value: string | number | boolean
  label: string
}

export interface ModelSettingSchema {
  key: string
  label: string
  type: 'select' | 'slider' | 'number' | 'boolean' | 'text'
  description?: string
  defaultValue: any
  options?: ModelSettingOption[] // For select
  min?: number // For slider/number
  max?: number // For slider/number
  step?: number // For slider/number
  group?: string // UI grouping
  conditional?: {
    // Simple dependency logic
    key: string
    value: any // Only show if key equals value
  }
}

export interface ModelAdvancedSettings {
  [modelId: string]: ModelSettingSchema[]
}

// Global definition of available advanced settings per model
export const ADVANCED_SETTINGS_SCHEMA: ModelAdvancedSettings = {
  kokoro: [
    {
      key: 'stitchLongSentences',
      label: 'Stitch Long Sentences',
      type: 'boolean',
      defaultValue: true,
      group: 'Text Processing',
      description:
        'Automatically merge short audio segments to avoid choppiness in long paragraphs.',
    },
    {
      key: 'textNormalization',
      label: 'Text Normalization',
      type: 'select',
      defaultValue: 'standard',
      group: 'Text Processing',
      options: [
        { value: 'standard', label: 'Standard (Expand numbers/abbr)' },
        { value: 'none', label: 'None (Raw text)' },
      ],
      description: 'How to handle numbers and abbreviations.',
    },
    {
      key: 'ignoreCodeBlocks',
      label: 'Ignore Code Blocks',
      type: 'boolean',
      defaultValue: false,
      group: 'Text Processing',
      description: 'Skip reading text inside <code> or <pre> blocks.',
    },
    {
      key: 'ignoreLinks',
      label: 'Skip Link Text',
      type: 'boolean',
      defaultValue: false,
      group: 'Text Processing',
      description: 'Do not read the text contained in anchor tags.',
    },
    {
      key: 'parallelChunks',
      label: 'Parallel Chunk Generation',
      type: 'slider',
      min: 1,
      max: 8,
      step: 1,
      defaultValue: 1,
      group: 'Performance',
      description:
        'Number of text segments to generate audio for simultaneously. Higher values speed up generation but use more memory.',
    },
  ],
  piper: [
    {
      key: 'noiseScale',
      label: 'Noise Scale',
      type: 'slider',
      min: 0,
      max: 1.0,
      step: 0.05,
      defaultValue: 0.667,
      group: 'Audio Characteristics',
      description: 'Controls the variability of the speech (higher = more random).',
    },
    {
      key: 'lengthScale',
      label: 'Length Scale (Pacing)',
      type: 'slider',
      min: 0.5,
      max: 2.0,
      step: 0.1,
      defaultValue: 1.0,
      group: 'Audio Characteristics',
      description: 'Controls the overall speed/length of the phonemes.',
    },
    {
      key: 'ignoreCodeBlocks',
      label: 'Ignore Code Blocks',
      type: 'boolean',
      defaultValue: false,
      group: 'Text Processing',
      description: 'Skip reading text inside <code> or <pre> blocks.',
    },
    {
      key: 'ignoreLinks',
      label: 'Skip Link Text',
      type: 'boolean',
      defaultValue: false,
      group: 'Text Processing',
      description: 'Do not read the text contained in anchor tags.',
    },
    {
      key: 'parallelChunks',
      label: 'Parallel Chunk Generation',
      type: 'slider',
      min: 1,
      max: 8,
      step: 1,
      defaultValue: 1,
      group: 'Performance',
      description:
        'Number of text segments to generate audio for simultaneously. Higher values speed up generation but use more memory.',
    },
  ],
  kitten: [
    {
      key: 'modelVariant',
      label: 'Model Variant',
      type: 'select',
      defaultValue: 'micro',
      group: 'Model',
      description: 'nano (~24MB, fastest) · micro (~41MB, balanced) · mini (~166MB, best quality)',
      options: [
        { value: 'nano', label: 'Nano (~24MB, fastest)' },
        { value: 'micro', label: 'Micro (~41MB, balanced)' },
        { value: 'mini', label: 'Mini (~166MB, best quality)' },
      ],
    },
    {
      key: 'speed',
      label: 'Speed',
      type: 'slider',
      min: 0.5,
      max: 2.0,
      step: 0.1,
      defaultValue: 1.0,
      group: 'Audio Characteristics',
      description: 'Speech rate multiplier.',
    },
  ],
  global: [
    {
      key: 'parallelChapters',
      label: 'Parallel Chapter Generation',
      type: 'slider',
      min: 1,
      max: 4,
      step: 1,
      defaultValue: 1,
      group: 'Performance',
      description:
        'Number of chapters to generate simultaneously. Use with caution - higher values require more memory.',
    },
  ],
}
