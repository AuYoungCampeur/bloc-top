/** Same-tab lifecycle ordering. Cross-tab coordination remains a separate browser-storage boundary. */
const operations = new Map<string, Promise<unknown>>()
const downloads = new Map<string, Set<AbortController>>()

export function throwIfOfflineAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Cancelled', 'AbortError')
}

export async function withOfflineCragOperation<T>(cragId: string, kind: 'download' | 'delete', work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  if (kind === 'delete') {
    for (const pending of downloads.get(cragId) ?? []) pending.abort(new DOMException('Cancelled by deletion', 'AbortError'))
  } else {
    const pending = downloads.get(cragId) ?? new Set<AbortController>()
    pending.add(controller); downloads.set(cragId, pending)
  }
  const previous = operations.get(cragId) ?? Promise.resolve()
  const run = previous.catch(() => {}).then(() => { throwIfOfflineAborted(controller.signal); return work(controller.signal) })
  operations.set(cragId, run)
  try { return await run } finally {
    downloads.get(cragId)?.delete(controller)
    if (downloads.get(cragId)?.size === 0) downloads.delete(cragId)
    if (operations.get(cragId) === run) operations.delete(cragId)
  }
}

/** Covers response bodies/decoding as well as headers, and settles even if a mock ignores abort. */
export async function withOfflineRequest<T>(work: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort(parent?.reason ?? new DOMException('Cancelled', 'AbortError'))
  const cancelled = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
  })
  parent?.addEventListener('abort', abort, { once: true })
  if (parent?.aborted) abort()
  const timer = setTimeout(() => controller.abort(new DOMException('Offline request timed out', 'TimeoutError')), timeoutMs)
  try {
    const request = Promise.resolve().then(() => { throwIfOfflineAborted(controller.signal); return work(controller.signal) })
    return await Promise.race([request, cancelled])
  } finally { clearTimeout(timer); parent?.removeEventListener('abort', abort) }
}
