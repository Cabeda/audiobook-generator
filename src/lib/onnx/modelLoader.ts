import { getOnnxRuntime } from './getOnnxRuntime.ts'
import { fetchAndCache } from './modelCache.ts'

/**
 * Downloads (with caching) an ONNX model from `modelUrl` and creates an
 * onnxruntime-web InferenceSession. Returns { ort, session }.
 *
 * Note: The caller must ensure `onnxruntime-web` is available (via
 * getOnnxRuntime). For large models this will download a potentially
 * large binary and cache it using the Cache API.
 */
export async function loadOnnxModel(modelUrl: string, onprogress?: (loaded: number, total?: number) => void) {
  const ort = await getOnnxRuntime()

  // fetch & cache via our modelCache utility
  const res = await fetchAndCache(modelUrl, onprogress)
  const arrayBuffer = await res.arrayBuffer()

  // Create session from raw buffer. onnxruntime-web accepts ArrayBuffer/Uint8Array
  // Optionally configure execution providers or wasm paths before creating the session.
  try {
    // If wasmPaths needs to be set, user can set ort.env.wasm.wasmPaths before calling this function.
    const session = await ort.InferenceSession.create(new Uint8Array(arrayBuffer), {
      executionProviders: ['wasm']
    })
    return { ort, session }
  } catch (e) {
    console.error('Failed to create ONNX session', e)
    throw e
  }
}

/**
 * Example usage (not executed here):
 *
 * const { ort, session } = await loadOnnxModel('/models/kokoro.onnx')
 * // Prepare input tensors (model-specific) and run:
 * // const input = new ort.Tensor('int64', Int32Array.from([...]), [1, seqLen])
 * // const outputs = await session.run({ input_name: input })
 */
