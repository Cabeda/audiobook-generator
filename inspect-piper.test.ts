import { describe, it } from 'vitest'
import * as tts from '@diffusionstudio/vits-web'

describe('Inspect Piper', () => {
  it('should log exports', () => {
    console.log('Keys in vits-web:', Object.keys(tts))
    // @ts-expect-error: config is not defined
    if (tts.config) console.log('Config:', tts.config)
    // @ts-expect-error: init is not defined
    if (tts.init) console.log('Init:', tts.init)
  })
})
