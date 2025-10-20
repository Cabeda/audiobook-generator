// Returns the onnxruntime-web package (dynamically imported) and initializes wasm paths if needed.

export async function getOnnxRuntime(): Promise<typeof import('onnxruntime-web')> {
  // Dynamically import to avoid bundling on servers where not needed
  const ort = await import('onnxruntime-web')
  // Optionally set wasm paths (CDN) if required by your setup.
  // ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/'
  return ort
}
