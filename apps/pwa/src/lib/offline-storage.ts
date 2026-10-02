/**
 * 离线存储层
 *
 * 使用 IndexedDB 存储岩场和线路数据，用于离线访问
 * 配合 Service Worker Cache API 存储图片
 *
 * 存储架构:
 * - IndexedDB: 结构化数据 (岩场、线路)
 * - Cache API: 图片资源 (由 SW 管理)
 * - localStorage: 状态元数据 (快速同步访问)
 */

import type { Crag, Route } from '@/types'
import { throwIfOfflineAborted, withOfflineCragOperation, withOfflineRequest } from './offline-lifecycle'
import { collectOfflineImageUrls, type OfflineImage } from './offline-manifest'

// ==================== 常量定义 ====================

export const DB_NAME = 'offline-crags'
export const DB_VERSION = 2
const CLEANUP_STORE = 'image-cleanup'
export const STORE_NAME = 'crags'
export const META_STORAGE_KEY = 'offline-crags-meta'
export const OFFLINE_META_EVENT = 'offline-meta-changed'

function notifyMetaChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OFFLINE_META_EVENT))
}

// ==================== 类型定义 ====================

/**
 * IndexedDB 中存储的岩场离线数据
 */
export interface OfflineCragData {
  cragId: string
  crag: Crag
  routes: Route[]
  downloadedAt: string    // ISO timestamp
  version: string         // 用于检测更新
  imageCount: number      // 已缓存图片数量
  schemaVersion?: 2
  images?: OfflineImage[]
}

/**
 * localStorage 中存储的元数据 (用于快速状态检查)
 */
export interface OfflineCragsMeta {
  crags: {
    [cragId: string]: {
      cragName: string
      routeCount: number
      downloadedAt: string
      imageCount: number
      revision?: string
      serverRevision?: string
      serverRouteCount?: number  // 上次检查时服务端的线路数
      lastChecked?: string       // 上次检查时间 (ISO)
    }
  }
  lastUpdated: string
}

// ==================== IndexedDB 操作 ====================

let dbPromise: Promise<IDBDatabase> | null = null
let volatileMeta: OfflineCragsMeta | null = null
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === META_STORAGE_KEY || event.key === null) volatileMeta = null
  })
}

/**
 * 打开/创建 IndexedDB 数据库
 * 使用单例模式避免重复连接
 */
export class OfflineDBBlockedError extends Error {
  constructor() {
    super('Offline database upgrade is blocked. Close other BlocTop tabs and retry.')
    this.name = 'OfflineDBBlockedError'
  }
}

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is not supported in this browser'))

  const pending: Promise<IDBDatabase> = new Promise((resolve, reject) => {
    let abandoned = false
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onblocked = () => {
      abandoned = true
      if (dbPromise === pending) dbPromise = null
      reject(new OfflineDBBlockedError())
    }
    request.onerror = () => {
      if (dbPromise === pending) dbPromise = null
      reject(new Error(`Failed to open database: ${request.error?.message}`))
    }
    request.onsuccess = () => {
      const db = request.result
      if (abandoned) { db.close(); return }
      db.onversionchange = () => {
        db.close()
        if (dbPromise === pending) dbPromise = null
      }
      resolve(db)
    }
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'cragId' })
        store.createIndex('downloadedAt', 'downloadedAt', { unique: false })
      }
      if (!db.objectStoreNames.contains(CLEANUP_STORE)) db.createObjectStore(CLEANUP_STORE, { keyPath: 'cragId' })
    }
  })
  dbPromise = pending
  void pending.catch(() => { if (dbPromise === pending) dbPromise = null })
  return pending
}

/**
 * 保存岩场离线数据到 IndexedDB
 */
export async function saveCragOffline(data: OfflineCragData): Promise<void> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME, CLEANUP_STORE], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const previous = store.get(data.cragId)
    previous.onsuccess = () => {
      if (!previous.result) return
      const keep = new Set(storedImageUrls(data))
      const obsolete = storedImageUrls(previous.result).filter(url => !keep.has(url))
      const cleanup = transaction.objectStore(CLEANUP_STORE)
      const queued = cleanup.get(data.cragId)
      queued.onsuccess = () => cleanup.put({ cragId: data.cragId, urls: [...new Set([...(queued.result?.urls ?? []), ...obsolete])].filter(url => !keep.has(url)) })
    }
    const request = store.put(data)

    request.onerror = () => {
      reject(new Error(`Failed to save crag: ${request.error?.message}`))
    }

    transaction.onerror = transaction.onabort = () => reject(new Error(transaction.error?.message || 'Offline transaction aborted'))
    transaction.oncomplete = () => {
      // 同步更新 localStorage 元数据
      updateMeta(data)
      void drainImageCleanup(data.cragId).catch(() => { /* Durable queue retries on next read. */ })
      resolve()
    }
  })
}

/**
 * 获取单个岩场的离线数据
 */
export async function getCragOffline(cragId: string): Promise<OfflineCragData | null> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(cragId)

    request.onerror = () => {
      reject(new Error(`Failed to get crag: ${request.error?.message}`))
    }

    request.onsuccess = () => {
      resolve(request.result || null)
    }
  })
}

/**
 * 获取所有已下载的岩场
 */
export async function getAllOfflineCrags(): Promise<OfflineCragData[]> {
  const db = await openDB()
  const pending = await new Promise<{ cragId: string }[]>(resolve => {
    const request = db.transaction(CLEANUP_STORE, 'readonly').objectStore(CLEANUP_STORE).getAll()
    request.onsuccess = () => resolve(request.result ?? [])
    request.onerror = () => resolve([])
  })
  for (const item of pending) await drainImageCleanup(item.cragId).catch(() => { /* Keep queue until storage recovers. */ })

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.getAll()

    request.onerror = () => {
      reject(new Error(`Failed to get all crags: ${request.error?.message}`))
    }

    request.onsuccess = () => {
      const rows: OfflineCragData[] = request.result || []
      const meta = getMeta()
      for (const row of rows) {
        const saved = meta.crags[row.cragId]
        const revision = row.schemaVersion === 2 ? row.version : undefined
        if (!saved || saved.revision !== revision || saved.downloadedAt !== row.downloadedAt || saved.routeCount !== row.routes.length) updateMeta(row)
      }
      const present = new Set(rows.map(row => row.cragId))
      for (const id of Object.keys(meta.crags)) if (!present.has(id)) removeMeta(id)
      resolve(rows)
    }
  })
}

/**
 * 删除岩场离线数据
 */
/** A durable cleanup queue bridges the independent IndexedDB and Cache transactions. */
const cleanupRuns = new Map<string, Promise<void>>()
async function drainImageCleanup(cragId: string): Promise<void> {
  const previous = cleanupRuns.get(cragId) ?? Promise.resolve()
  const run = previous.catch(() => {}).then(() => consumeImageCleanup(cragId))
  cleanupRuns.set(cragId, run)
  try { await run } finally { if (cleanupRuns.get(cragId) === run) cleanupRuns.delete(cragId) }
}

async function consumeImageCleanup(cragId: string): Promise<void> {
  const db = await openDB()
  const item = await new Promise<{ cragId: string; urls: string[] } | undefined>((resolve, reject) => {
    const request = db.transaction(CLEANUP_STORE, 'readonly').objectStore(CLEANUP_STORE).get(cragId)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  if (!item) return
  // A revision can be reused. Never delete media referenced by the latest committed snapshot.
  const current = await getCragOffline(cragId)
  const inUse = new Set(current ? storedImageUrls(current) : [])
  await deleteImages(item.urls.filter(url => !inUse.has(url)))
  const consumed = new Set(item.urls)
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CLEANUP_STORE, 'readwrite')
    const store = tx.objectStore(CLEANUP_STORE)
    const request = store.get(cragId)
    request.onsuccess = () => {
      if (!request.result) return
      const remaining = request.result.urls.filter((url: string) => !consumed.has(url))
      if (remaining.length) store.put({ cragId, urls: remaining })
      else store.delete(cragId)
    }
    tx.oncomplete = () => resolve()
    tx.onabort = tx.onerror = () => reject(tx.error)
  })
}

export async function deleteCragOffline(cragId: string): Promise<void> {
  return withOfflineCragOperation(cragId, 'delete', () => performOfflineDeletion(cragId))
}

async function performOfflineDeletion(cragId: string): Promise<void> {
  const stored = await getCragOffline(cragId)
  const others = await getAllOfflineCrags()
  const referenced = new Set(others.filter(item => item.cragId !== cragId).flatMap(storedImageUrls))
  const urls = new Set(stored ? storedImageUrls(stored) : [])
  // Include verified partial downloads and previous revisions belonging to this crag.
  if ('caches' in window) {
    const cache = await caches.open(OFFLINE_IMAGE_CACHE_NAME)
    for (const request of await cache.keys()) {
      const path = new URL(request.url).pathname
      if (path.startsWith(`/${cragId}/`) || path.startsWith(`/CragSurface/${cragId}/`)) urls.add(request.url)
    }
  }
  const db = await openDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, CLEANUP_STORE], 'readwrite')
    tx.objectStore(STORE_NAME).delete(cragId)
    const cleanup = tx.objectStore(CLEANUP_STORE)
    const request = cleanup.get(cragId)
    request.onsuccess = () => cleanup.put({ cragId, urls: [...new Set([...(request.result?.urls ?? []), ...urls])].filter(url => !referenced.has(url)) })
    tx.onerror = tx.onabort = () => reject(new Error(tx.error?.message || 'Offline deletion aborted'))
    tx.oncomplete = () => { removeMeta(cragId); resolve() }
  })
  // Failure retains the queue for the next cleanup attempt. The deleted snapshot is never advertised.
  await drainImageCleanup(cragId)
}

/**
 * 检查岩场是否已下载
 * 优先使用 localStorage 快速检查
 */
export function isOfflineAvailable(cragId: string): boolean {
  try {
    const meta = getMeta()
    return cragId in meta.crags
  } catch {
    return false
  }
}

/**
 * 检查 IndexedDB 是否支持且可用
 */
export function isIndexedDBSupported(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

// ==================== localStorage 元数据操作 ====================

/**
 * 获取元数据
 */
export function getMeta(): OfflineCragsMeta {
  if (volatileMeta) return volatileMeta
  try {
    if (typeof localStorage === 'undefined') {
      return { crags: {}, lastUpdated: '' }
    }
    const stored = localStorage.getItem(META_STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored) as OfflineCragsMeta
    }
  } catch {
    // 解析失败时返回空对象
  }
  return volatileMeta ?? { crags: {}, lastUpdated: '' }
}

/**
 * 更新单个岩场的元数据
 */
function updateMeta(data: OfflineCragData): void {
  try {
    if (typeof localStorage === 'undefined') return

    const meta = getMeta()
    meta.crags[data.cragId] = {
      cragName: data.crag.name,
      routeCount: data.routes.length,
      downloadedAt: data.downloadedAt,
      imageCount: data.imageCount,
      revision: data.schemaVersion === 2 ? data.version : undefined,
    }
    meta.lastUpdated = new Date().toISOString()
    volatileMeta = meta
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta))
    volatileMeta = null
  } catch {
    // IndexedDB remains authoritative if localStorage is unavailable.
  }
  notifyMetaChanged()
}

/**
 * 从元数据中移除岩场
 */
function removeMeta(cragId: string): void {
  try {
    if (typeof localStorage === 'undefined') return

    const meta = getMeta()
    delete meta.crags[cragId]
    meta.lastUpdated = new Date().toISOString()
    volatileMeta = meta
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta))
    volatileMeta = null
  } catch {
    // IndexedDB remains authoritative if localStorage is unavailable.
  }
  notifyMetaChanged()
}

/**
 * 清除所有元数据
 */
export function clearMeta(): void {
  volatileMeta = null
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(META_STORAGE_KEY)
    notifyMetaChanged()
  } catch {
    // 静默处理
  }
}

// ==================== Staleness 检查 ====================

/**
 * 更新岩场的服务端线路数 (用于 stale 检测)
 */
export function updateStaleness(cragId: string, serverRouteCount: number, serverRevision?: string): void {
  try {
    if (typeof localStorage === 'undefined') return

    const meta = getMeta()
    if (!(cragId in meta.crags)) return

    meta.crags[cragId].serverRouteCount = serverRouteCount
    meta.crags[cragId].serverRevision = serverRevision
    meta.crags[cragId].lastChecked = new Date().toISOString()
    volatileMeta = meta
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta))
    volatileMeta = null
  } catch {
    // 静默处理
  }
  notifyMetaChanged()
}

/**
 * 检查岩场是否有更新 (服务端线路数 > 本地线路数)
 */
export function getStaleInfo(cragId: string): { isStale: boolean; newRouteCount: number } | null {
  try {
    const meta = getMeta()
    const cragMeta = meta.crags[cragId]
    if (!cragMeta) return null
    if (!cragMeta.revision) return { isStale: true, newRouteCount: 0 }
    if (cragMeta.serverRouteCount == null) return null

    const newRouteCount = cragMeta.serverRouteCount - cragMeta.routeCount
    return {
      isStale: cragMeta.serverRevision ? cragMeta.revision !== cragMeta.serverRevision : newRouteCount !== 0,
      newRouteCount: Math.max(0, newRouteCount),
    }
  } catch {
    return null
  }
}

/**
 * 获取需要检查更新的岩场列表
 * 过滤掉最近 minIntervalMs 内已检查过的岩场
 */
export function getCragsNeedingCheck(minIntervalMs: number = 30 * 60 * 1000): string[] {
  try {
    const meta = getMeta()
    const now = Date.now()

    return Object.entries(meta.crags)
      .filter(([, data]) => {
        if (!data.lastChecked) return true
        return now - new Date(data.lastChecked).getTime() > minIntervalMs
      })
      .map(([cragId]) => cragId)
  } catch {
    return []
  }
}

// ==================== 图片缓存操作 ====================

export const OFFLINE_IMAGE_CACHE_NAME = 'offline-crag-images'

/**
 * 收集岩场相关的所有图片 URL
 *
 * 注意：线路 TOPO 图片 URL 是动态生成的，格式为：
 * https://img.bouldering.top/{cragId}/{routeName}.jpg?v=1
 * 而不是存储在 route.image 字段中
 */
export function collectImageUrls(crag: Crag, routes: Route[]): string[] {
  return collectOfflineImageUrls(crag, routes)
}

export function storedImageUrls(data: OfflineCragData): string[] {
  return data.images?.map(image => image.cacheUrl) ?? collectImageUrls(data.crag, data.routes)
}

export interface ImagePrefetchResult {
  cached: number
  processed: number
  failedUrls: string[]
  total: number
  storageFull?: boolean
}

export function isOfflineQuotaError(error: unknown): boolean {
  return error instanceof Error && ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'].includes(error.name)
}

async function validateImage(response: Response): Promise<boolean> {
  if (!response.ok || response.type === 'opaque' || !response.headers.get('Content-Type')?.startsWith('image/')) return false
  const blob = await response.clone().blob()
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    const valid = bitmap.width > 0 && bitmap.height > 0
    bitmap.close()
    return valid
  }
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise<boolean>(resolve => {
      const image = new Image()
      image.onload = () => resolve(image.naturalWidth > 0)
      image.onerror = () => resolve(false)
      image.src = url
    })
  } finally { URL.revokeObjectURL(url) }
}

/** Only verified image bodies are counted. Opaque responses cannot prove availability. */
export async function prefetchImages(
  urls: string[],
  onProgress?: (result: ImagePrefetchResult) => void,
  signal?: AbortSignal,
): Promise<ImagePrefetchResult> {
  if (!('caches' in window)) throw new Error('Offline image storage is unavailable')
  const cache = await caches.open(OFFLINE_IMAGE_CACHE_NAME)
  const uniqueUrls = [...new Set(urls)]
  const result: ImagePrefetchResult = { cached: 0, processed: 0, failedUrls: [], total: uniqueUrls.length }
  for (const url of uniqueUrls) {
    throwIfOfflineAborted(signal)
    try {
      const cached = await cache.match(url)
      const validCached = cached ? await validateImage(cached).catch(() => false) : false
      if (!validCached) {
        const response = await withOfflineRequest(async requestSignal => {
          const body = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store', signal: requestSignal })
          if (!await validateImage(body)) throw new Error('Invalid offline image')
          throwIfOfflineAborted(requestSignal)
          return body
        }, signal)
        throwIfOfflineAborted(signal)
        await cache.put(url, response)
      }
      result.cached++
    } catch (error) {
      throwIfOfflineAborted(signal)
      if (isOfflineQuotaError(error)) result.storageFull = true
      result.failedUrls.push(url)
    }
    result.processed++
    onProgress?.({ ...result, failedUrls: [...result.failedUrls] })
  }
  return result
}

/**
 * 删除岩场相关的缓存图片
 */
export async function deleteImages(urls: string[]): Promise<void> {
  if (!('caches' in window)) return
  const cache = await caches.open(OFFLINE_IMAGE_CACHE_NAME)
  await Promise.all(urls.map(url => cache.delete(url)))
}

// ==================== 工具函数 ====================

/**
 * 生成数据版本号 (用于检测更新)
 * 基于岩场 ID 和当前日期
 */
export function generateVersion(cragId: string): string {
  const date = new Date().toISOString().split('T')[0]
  return `${cragId}-${date}`
}

/**
 * 关闭数据库连接 (用于测试清理)
 */
export function closeDB(): void {
  void dbPromise?.then(db => db.close())
  dbPromise = null
  volatileMeta = null
}

/**
 * 根据线路 ID 查找离线线路数据
 * 遍历所有已下载的岩场来查找对应线路
 */
export async function getOfflineRouteById(routeId: number): Promise<{
  route: Route
  crag: Crag
} | null> {
  const crags = await getAllOfflineCrags()

  for (const cragData of crags) {
    const route = cragData.routes.find((r) => r.id === routeId)
    if (route) {
      return { route, crag: cragData.crag }
    }
  }

  return null
}
