import type { DownloadProgress } from '@/types'
import type { OfflineSnapshot } from './offline-manifest'
import { throwIfOfflineAborted, withOfflineCragOperation, withOfflineRequest } from './offline-lifecycle'
import { prefetchImages, saveCragOffline, isOfflineQuotaError, OfflineDBBlockedError, type OfflineCragData, type ImagePrefetchResult } from './offline-storage'

export interface OfflineDownloadProgress extends DownloadProgress { routeCount?: number; failedImages?: number }
export class OfflineDownloadError extends Error {
  constructor(public reason: 'snapshot' | 'images' | 'storage' | 'quota' | 'cancelled' | 'db-blocked', public result?: ImagePrefetchResult) {
    super(reason)
  }
}

export async function downloadOfflineSnapshot(cragId: string, onProgress: (result: ImagePrefetchResult) => void): Promise<OfflineCragData> {
  try { return await withOfflineCragOperation(cragId, 'download', signal => performDownload(cragId, onProgress, signal)) }
  catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new OfflineDownloadError('cancelled')
    throw error
  }
}

async function performDownload(cragId: string, onProgress: (result: ImagePrefetchResult) => void, signal: AbortSignal): Promise<OfflineCragData> {
  let snapshot: OfflineSnapshot
  try {
    const body = await withOfflineRequest(async requestSignal => {
      const response = await fetch(`/api/crags/${encodeURIComponent(cragId)}/offline`, { cache: 'no-store', signal: requestSignal })
      if (!response.ok) throw new Error('Snapshot unavailable')
      const payload = await response.json()
      throwIfOfflineAborted(requestSignal)
      return payload
    }, signal)
    snapshot = body.snapshot
    if (!body.success || snapshot?.schemaVersion !== 2 || snapshot.crag?.id !== cragId || !snapshot.revision || !Array.isArray(snapshot.routes) || !Array.isArray(snapshot.images)) {
      throw new Error('Invalid snapshot')
    }
  } catch { throw new OfflineDownloadError(signal.aborted ? 'cancelled' : 'snapshot') }
  let result: ImagePrefetchResult
  try { result = await prefetchImages(snapshot.images.map(image => image.cacheUrl), onProgress, signal) }
  catch (error) { throw new OfflineDownloadError(signal.aborted ? 'cancelled' : isOfflineQuotaError(error) ? 'quota' : 'storage') }
  if (result.failedUrls.length) throw new OfflineDownloadError(result.storageFull ? 'quota' : 'images', result)
  throwIfOfflineAborted(signal)
  const data: OfflineCragData = {
    cragId, crag: snapshot.crag, routes: snapshot.routes, schemaVersion: 2,
    version: snapshot.revision, images: snapshot.images,
    imageCount: result.cached, downloadedAt: new Date().toISOString(),
  }
  try { await saveCragOffline(data) } catch (error) { throw new OfflineDownloadError(isOfflineQuotaError(error) ? 'quota' : error instanceof OfflineDBBlockedError ? 'db-blocked' : 'storage', result) }
  return data
}
