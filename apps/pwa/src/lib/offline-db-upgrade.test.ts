import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { DB_NAME, DB_VERSION, STORE_NAME, closeDB, getCragOffline, OfflineDBBlockedError, openDB } from './offline-storage'
const originalIndexedDB = globalThis.indexedDB
let factory: IDBFactory
beforeEach(() => { closeDB(); factory = new IDBFactory(); vi.stubGlobal('indexedDB', factory) })
afterEach(() => { closeDB(); globalThis.indexedDB = originalIndexedDB; vi.restoreAllMocks() })

function legacyConnection(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'cragId' }).put({ cragId: 'legacy', crag: { name: '旧岩场' }, routes: [], version: 'old', imageCount: 0, downloadedAt: '2026-01-01' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

describe('offline DB upgrade lifecycle', () => {
  it('rejects a blocked upgrade, closes its late successful connection and allows a fresh retry without losing legacy data', async () => {
    const legacy = await legacyConnection()
    const originalOpen = factory.open.bind(factory)
    const closed: ReturnType<typeof vi.spyOn>[] = []
    vi.spyOn(factory, 'open').mockImplementation((...args: Parameters<IDBFactory['open']>) => {
      const request = originalOpen(...args)
      const index = closed.length
      closed.push(undefined as unknown as ReturnType<typeof vi.spyOn>)
      request.addEventListener('success', () => { closed[index] = vi.spyOn(request.result, 'close') })
      return request
    })
    await expect(openDB()).rejects.toBeInstanceOf(OfflineDBBlockedError)
    // Queue a retry before releasing the legacy connection. The abandoned first open must not clear it.
    const retry = openDB()
    legacy.close()
    const upgraded = await retry
    expect(upgraded.version).toBe(DB_VERSION)
    expect(upgraded.objectStoreNames.contains('image-cleanup')).toBe(true)
    expect(closed[0]).toHaveBeenCalledOnce()
    expect(await openDB()).toBe(upgraded)
    expect((await getCragOffline('legacy'))?.crag.name).toBe('旧岩场')
  })
  it('closes an open connection on versionchange and discards the cached connection', async () => {
    const current = await openDB()
    const close = vi.spyOn(current, 'close')
    await new Promise<void>((resolve, reject) => {
      const request = factory.deleteDatabase(DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    expect(close).toHaveBeenCalledOnce()
    const fresh = await openDB()
    expect(fresh).not.toBe(current)
    expect(fresh.version).toBe(DB_VERSION)
  })
  it('retries after a synchronous browser open failure rather than caching a rejected promise', async () => {
    const originalOpen = factory.open.bind(factory)
    vi.spyOn(factory, 'open').mockImplementationOnce(() => { throw new DOMException('blocked', 'SecurityError') }).mockImplementation(originalOpen)
    await expect(openDB()).rejects.toMatchObject({ name: 'SecurityError' })
    expect((await openDB()).version).toBe(DB_VERSION)
    expect(factory.open).toHaveBeenCalledTimes(2)
  })
})
