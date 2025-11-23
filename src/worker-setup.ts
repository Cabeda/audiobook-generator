// Shim for ONNX Runtime Web on iOS to prevent crashes
// This must run before onnxruntime-web is initialized
if (typeof self !== 'undefined') {
  // @ts-expect-error: ensure self.ort exists
  self.ort = self.ort || {}
  // @ts-expect-error: initialize ort.env object
  self.ort.env = self.ort.env || {}
  // @ts-expect-error: initialize ort.env object
  self.ort.env.wasm = self.ort.env.wasm || {}

  // Force single-threaded execution to prevent WASM OOM/crashes on iOS
  // @ts-expect-error: set numThreads for ORT
  self.ort.env.wasm.numThreads = 1

  // Disable SIMD as it can cause issues on some iOS versions/devices
  // @ts-expect-error: disable SIMD for ORT
  self.ort.env.wasm.simd = false

  // Disable proxy to ensure main thread isn't involved in WASM execution
  // @ts-expect-error: disable proxy for ORT
  self.ort.env.wasm.proxy = false

  console.log('[Worker] Applied ONNX Runtime shim for iOS stability')
}
