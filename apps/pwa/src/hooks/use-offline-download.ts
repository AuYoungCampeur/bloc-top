'use client'

/**
 * 离线下载管理 Hook
 *
 * 提供岩场离线下载的完整功能:
 * - 下载岩场数据和图片
 * - 管理下载状态和进度
 * - 查询已下载的岩场列表
 * - 删除已下载的数据
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import type { Crag, Route, OfflineCragMeta } from '@/types'
import { downloadOfflineSnapshot, OfflineDownloadError, type OfflineDownloadProgress } from '@/lib/offline-download'
import {
  getCragOffline,
  getAllOfflineCrags,
  deleteCragOffline,
  isOfflineAvailable,
  getMeta,
  isIndexedDBSupported,
  getCragsNeedingCheck,
  updateStaleness,
  getStaleInfo,
  OFFLINE_META_EVENT,
  META_STORAGE_KEY,
} from '@/lib/offline-storage'

export interface UseOfflineDownloadReturn {
  // 状态
  offlineCrags: OfflineCragMeta[]           // 已下载的岩场列表
  downloadProgress: OfflineDownloadProgress | null  // 当前下载进度
  isSupported: boolean                       // 是否支持离线功能

  // 操作
  downloadCrag: (crag: Crag, routes: Route[]) => Promise<void>
  deleteCrag: (cragId: string, crag?: Crag, routes?: Route[]) => Promise<void>
  isDownloaded: (cragId: string) => boolean

  // Staleness 检测
  getUpdateInfo: (cragId: string) => { isStale: boolean; newRouteCount: number } | null

  // 辅助
  refreshList: () => void
}

/**
 * 从 localStorage 元数据加载已下载岩场列表 (纯函数)
 */
function loadOfflineCrags(): OfflineCragMeta[] {
  try {
    const meta = getMeta()
    const list: OfflineCragMeta[] = Object.entries(meta.crags).map(
      ([cragId, data]) => ({
        cragId,
        cragName: data.cragName,
        routeCount: data.routeCount,
        downloadedAt: data.downloadedAt,
        imageCount: data.imageCount,
      })
    )
    // 按下载时间倒序
    list.sort((a, b) =>
      new Date(b.downloadedAt).getTime() - new Date(a.downloadedAt).getTime()
    )
    return list
  } catch {
    return []
  }
}

/**
 * 离线下载管理 Hook
 */
export function useOfflineDownload(): UseOfflineDownloadReturn {
  // 初始为 false，hydration 后检测 IndexedDB 支持
  // 避免 SSR/Client 不一致导致 Hydration Mismatch（服务端无 indexedDB 全局变量）
  const [isSupported, setIsSupported] = useState(false)
  const [offlineCrags, setOfflineCrags] = useState<OfflineCragMeta[]>([])

  useEffect(() => {
    if (isIndexedDBSupported() && 'caches' in window) {
      setIsSupported(true)
      setOfflineCrags(loadOfflineCrags())
      void getAllOfflineCrags().then(() => setOfflineCrags(loadOfflineCrags())).catch(() => {})
    }
  }, [])
  const [downloadProgress, setDownloadProgress] = useState<OfflineDownloadProgress | null>(null)

  // staleness 检查版本号 — 递增时触发 UI 重渲染
  const [staleVersion, setStaleVersion] = useState(0)

  /**
   * 刷新已下载岩场列表
   */
  const refreshList = useCallback(() => {
    setOfflineCrags(loadOfflineCrags())
  }, [])

  /**
   * 检查岩场是否已下载
   */
  const isDownloaded = useCallback((cragId: string): boolean => {
    return isOfflineAvailable(cragId)
  }, [])

  /**
   * 下载岩场数据和图片
   */
  const activeDownloadRef = useRef(false)
  const downloadCrag = useCallback(async (crag: Crag, routes: Route[]) => {
    void routes // Cards may contain trimmed data; always request a complete snapshot.
    if (activeDownloadRef.current) return
    activeDownloadRef.current = true
    const cragId = crag.id
    setDownloadProgress({ cragId, status: 'downloading', totalImages: 0, downloadedImages: 0 })
    try {
      const data = await downloadOfflineSnapshot(cragId, result => {
        setDownloadProgress({ cragId, status: 'downloading', totalImages: result.total, downloadedImages: result.cached, failedImages: result.failedUrls.length })
      })
      setDownloadProgress({ cragId, status: 'completed', totalImages: data.imageCount, downloadedImages: data.imageCount, routeCount: data.routes.length })
      refreshList()
    } catch (error) {
      const result = error instanceof OfflineDownloadError ? error.result : undefined
      setDownloadProgress({
        cragId, status: 'failed', totalImages: result?.total ?? 0, downloadedImages: result?.cached ?? 0,
        failedImages: result?.failedUrls.length,
        error: error instanceof OfflineDownloadError ? error.reason : 'storage',
      })
    } finally { activeDownloadRef.current = false }
  }, [refreshList])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === META_STORAGE_KEY || event.key === null) refreshList()
    }
    window.addEventListener(OFFLINE_META_EVENT, refreshList)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(OFFLINE_META_EVENT, refreshList)
      window.removeEventListener('storage', onStorage)
    }
  }, [refreshList])

  /**
   * 获取岩场的更新信息 (是否有新线路)
   */
  const getUpdateInfo = useCallback((cragId: string) => {
    // staleVersion 依赖确保检查完成后重新计算
    void staleVersion
    return getStaleInfo(cragId)
  }, [staleVersion])

  /**
   * 后台检查所有已下载岩场是否有更新
   */
  const checkingRef = useRef(false)
  useEffect(() => {
    if (!isSupported) return

    const checkForUpdates = async () => {
      if (checkingRef.current || !navigator.onLine) return
      const cragIds = getCragsNeedingCheck()
      if (cragIds.length === 0) return
      checkingRef.current = true

      for (const cragId of cragIds) {
        try {
          const res = await fetch(`/api/crags/${encodeURIComponent(cragId)}/version`, { cache: 'no-store' })
          if (res.status === 404) { updateStaleness(cragId, 0, 'deleted'); continue }
          if (!res.ok) continue

          const data = await res.json()
          if (data.success && typeof data.routeCount === 'number') {
            updateStaleness(cragId, data.routeCount, data.revision)
          }
        } catch {
          // 网络失败静默忽略
        }
      }

      // 检查完成后触发 UI 更新
      checkingRef.current = false
      setStaleVersion(v => v + 1)
    }

    void checkForUpdates()
    window.addEventListener('online', checkForUpdates)
    const onVisible = () => { if (document.visibilityState === 'visible') void checkForUpdates() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', checkForUpdates)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [isSupported, offlineCrags.length])

  /**
   * 删除岩场离线数据
   */
  const deleteCrag = useCallback(async (
    cragId: string,
    crag?: Crag,
    routes?: Route[]
  ) => {
    try {
      void crag
      void routes

      // 删除 IndexedDB 中的数据
      await deleteCragOffline(cragId)
      setDownloadProgress(current => current?.cragId === cragId ? null : current)

      // 刷新列表
      refreshList()
    } catch (error) {
      console.error('Failed to delete offline crag:', error)
      throw error
    }
  }, [refreshList])

  return {
    offlineCrags,
    downloadProgress,
    isSupported,
    downloadCrag,
    deleteCrag,
    isDownloaded,
    getUpdateInfo,
    refreshList,
  }
}

/**
 * 获取岩场离线数据 (用于离线模式下访问)
 */
export async function getOfflineCragData(cragId: string) {
  return getCragOffline(cragId)
}
