/**
 * Helper to read text from File, with fallback for Node.js environment
 */
export async function readFileAsText(file: File): Promise<string> {
  // Try the standard File API text() method first
  if (typeof file.text === 'function') {
    return await file.text()
  }

  // Fallback for Node.js environment (tests)
  // @ts-expect-error - accessing internal buffer in Node polyfill
  if (file[Symbol.toStringTag] === 'File' && file.constructor.name === 'File') {
    // In Node/vitest environment, File is a Buffer-like object
    const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = reject
      reader.readAsArrayBuffer(file)
    })
    const decoder = new TextDecoder()
    return decoder.decode(arrayBuffer)
  }

  throw new Error('Unable to read file as text')
}
