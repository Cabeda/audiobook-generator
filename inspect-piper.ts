import * as tts from '@diffusionstudio/vits-web'

console.log('Keys in vits-web:', Object.keys(tts))
try {
  // @ts-expect-error: config is not defined
  if (tts.config) console.log('Config:', tts.config)
  // @ts-expect-error: init is not defined
  if (tts.init) console.log('Init:', tts.init)
} catch (e) {
  console.error(e)
}
