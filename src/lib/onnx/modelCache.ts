// Simple model downloader + cache using the Cache API. Stores responses under a named cache.

const CACHE_NAME = 'kokoro-model-cache-v1'

export async function isCached(url: string): Promise<boolean> {
  try {
    const cache = await caches.open(CACHE_NAME)
    const res = await cache.match(url)
    return !!res
  } catch (e) {
    console.warn('Cache API unavailable', e)
    return false
  }
}

export async function cacheResponse(url: string, res: Response): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME)
    await cache.put(url, res.clone())
  } catch (e) {
    console.warn('Failed to cache response', e)
  }
}

export async function fetchAndCache(url: string, onprogress?: (loaded: number, total?: number) => void): Promise<Response> {
  const existing = await caches.open(CACHE_NAME).then(c => c.match(url)).catch(() => null)
  if (existing) return existing

  const res = await fetch(url)
  const contentLength = res.headers.get('content-length')
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)

  // Optionally report progress by streaming
  if (onprogress && res.body) {
    const reader = res.body.getReader()
    const total = contentLength ? parseInt(contentLength) : undefined
    let loaded = 0
    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        loaded += value.length
        onprogress(loaded, total)
      }
    }
  const parts = chunks.map(c => c.buffer)
  const blob = new Blob(parts)
    const response = new Response(blob, { headers: res.headers })
    await cacheResponse(url, response)
    return response
  }

  // Fast path: cache full response
  await cacheResponse(url, res)
  return res
}
