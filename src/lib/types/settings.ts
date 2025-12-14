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
      description:
        'Automatically merge short audio segments to avoid choppiness in long paragraphs.',
    },
    {
      key: 'textNormalization',
      label: 'Text Normalization',
      type: 'select',
      defaultValue: 'standard',
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
      description: 'Skip reading text inside <code> or <pre> blocks.',
    },
    {
      key: 'ignoreLinks',
      label: 'Skip Link Text',
      type: 'boolean',
      defaultValue: false,
      description: 'Do not read the text contained in anchor tags.',
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
      description: 'Controls the overall speed/length of the phonemes.',
    },
    {
      key: 'ignoreCodeBlocks',
      label: 'Ignore Code Blocks',
      type: 'boolean',
      defaultValue: false,
      description: 'Skip reading text inside <code> or <pre> blocks.',
    },
    {
      key: 'ignoreLinks',
      label: 'Skip Link Text',
      type: 'boolean',
      defaultValue: false,
      description: 'Do not read the text contained in anchor tags.',
    },
  ],
}
