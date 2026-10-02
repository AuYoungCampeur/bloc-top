/** Web Locks coordinate cooperating tabs; older browsers retain the same-tab queue. */
const operations = new Map<string, Promise<unknown>>()
const downloads = new Map<string, Set<AbortController>>()
let channel: BroadcastChannel | null = null

function cancelDownloads(cragId: string) {
  for (const pending of downloads.get(cragId) ?? []) pending.abort(new DOMException('Cancelled by deletion', 'AbortError'))
}

function operationChannel() {
  if (!channel && typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    try {
      channel = new BroadcastChannel('bloctop-offline-operations')
      channel.onmessage = event => {
        if (event.data?.type === 'delete' && typeof event.data.cragId === 'string') cancelDownloads(event.data.cragId)
      }
    } catch { /* Storage policies may forbid notifications; the queue/lock still works. */ }
  }
  return channel
}

export function throwIfOfflineAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Cancelled', 'AbortError')
}

export async function withOfflineCragOperation<T>(cragId: string, kind: 'download' | 'delete' | 'cleanup', work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const notifications = operationChannel()
  if (kind === 'delete') {
    cancelDownloads(cragId)
    try { notifications?.postMessage({ type: 'delete', cragId }) } catch { /* Notifications are advisory, not the lock. */ }
  } else if (kind === 'download') {
    const pending = downloads.get(cragId) ?? new Set<AbortController>()
    pending.add(controller); downloads.set(cragId, pending)
  }
  const previous = operations.get(cragId) ?? Promise.resolve()
  const run = previous.catch(() => {}).then(async () => {
    throwIfOfflineAborted(controller.signal)
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request(`bloctop-offline:${cragId}`, { mode: 'exclusive', signal: controller.signal }, () => work(controller.signal))
    }
    return await work(controller.signal)
  })
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
