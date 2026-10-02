// apps/editor/src/hooks/use-face-data.ts
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useToast } from '@bloctop/ui/components/toast'
import type { Route } from '@bloctop/shared/types'
import type { FaceImageCacheService } from '@bloctop/ui/face-image'
import { preloadImage } from '@bloctop/shared/editor-utils'
import { applyFaceRoutes, buildFaceGroups, type FaceMutationResult } from '@/lib/face-state'
import { publishingDelayMessage } from '@/lib/publishing-feedback'

export const FACE_ID_PATTERN = /^[\u4e00-\u9fffa-z0-9-]+$/
export const FACE_ID_CLEANUP = /[^\u4e00-\u9fffa-z0-9-]/g

export interface R2FaceInfo { faceId: string; area: string }

export interface FaceGroup {
  faceId: string
  area: string
  routes: Route[]
  imageUrl: string
}

export interface UseFaceDataOptions {
  selectedCragId: string | null
  routes: Route[]
  setRoutes: React.Dispatch<React.SetStateAction<Route[]>>
  selectedArea: string | null
  persistedAreas: string[]
  updateCragAreas: (cragId: string, areas: string[]) => Promise<string[]>
  faceImageCache: FaceImageCacheService
}

export function useFaceData({
  selectedCragId,
  routes,
  setRoutes,
  selectedArea,
  persistedAreas,
  updateCragAreas,
  faceImageCache,
}: UseFaceDataOptions) {
  const { showToast } = useToast()
  const [r2Faces, setR2Faces] = useState<R2FaceInfo[]>([])
  const [isLoadingFaces, setIsLoadingFaces] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [facesError, setFacesError] = useState<string | null>(null)
  const [facesCragId, setFacesCragId] = useState<string | null>(null)
  const currentCragRef = useRef(selectedCragId)
  currentCragRef.current = selectedCragId
  const loadVersionRef = useRef(0)

  const loadFaces = useCallback((cragId: string, signal?: AbortSignal) => {
    const version = ++loadVersionRef.current
    const isCurrent = () => !signal?.aborted && currentCragRef.current === cragId && loadVersionRef.current === version
    setIsLoadingFaces(true)
    setFacesError(null)
    return fetch(`/api/faces?cragId=${encodeURIComponent(cragId)}`, { signal })
      .then(async res => {
        const data = await res.json()
        if (!res.ok || !data.success || !Array.isArray(data.faces)) throw new Error(data.error || '加载岩面失败')
        return data
      })
      .then(data => {
        if (!isCurrent()) return false
        setR2Faces(data.faces as R2FaceInfo[])
        setFacesCragId(cragId)
        return true
      })
      .catch(err => {
        if (isCurrent()) setFacesError(err instanceof Error ? err.message : '加载岩面失败')
        return false
      })
      .finally(() => { if (isCurrent()) setIsLoadingFaces(false) })
  }, [])

  useEffect(() => {
    if (!selectedCragId) { setR2Faces([]); setFacesCragId(null); setIsLoadingFaces(false); return }
    setR2Faces([])
    const controller = new AbortController()
    loadFaces(selectedCragId, controller.signal)
    return () => controller.abort()
  }, [selectedCragId, loadFaces])

  const handleRefresh = useCallback(async () => {
    if (!selectedCragId || isRefreshing) return
    setIsRefreshing(true)
    const loaded = await loadFaces(selectedCragId)
    setIsRefreshing(false)
    if (currentCragRef.current === selectedCragId) showToast(loaded ? '已刷新' : '刷新失败，请重试', loaded ? 'success' : 'error', 2000)
  }, [selectedCragId, isRefreshing, loadFaces, showToast])

  const faceGroups = useMemo(() => {
    if (!selectedCragId || facesCragId !== selectedCragId) return []
    let result = buildFaceGroups(r2Faces, routes, selectedCragId, face => faceImageCache.getImageUrl(face))
    if (selectedArea) result = result.filter(f => f.area === selectedArea)
    return result
  }, [routes, r2Faces, selectedCragId, selectedArea, faceImageCache, facesCragId])

  const refreshContext = useCallback(async (cragId: string) => {
    if (currentCragRef.current !== cragId) return
    await Promise.all([
      loadFaces(cragId),
      fetch(`/api/crags/${encodeURIComponent(cragId)}/routes`).then(async res => {
        const data = await res.json()
        if (!res.ok || !data.success || !Array.isArray(data.routes)) throw new Error('重新核对线路失败')
        if (currentCragRef.current === cragId) setRoutes(prev => applyFaceRoutes(prev, data.routes))
      }).catch(() => { if (currentCragRef.current === cragId) showToast('操作状态需要核对，请刷新后再继续', 'info', 4000) }),
    ])
  }, [loadFaces, setRoutes, showToast])

  const handleDeleteFace = useCallback(async (selectedFace: FaceGroup) => {
    if (!selectedCragId) return false
    try {
      const res = await fetch('/api/faces', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cragId: selectedCragId, area: selectedFace.area, faceId: selectedFace.faceId }),
      })
      const data = await res.json()
      if (!res.ok || !data.success || !Array.isArray(data.routes)) {
        if (data.partial) await refreshContext(selectedCragId)
        throw new Error(data.error || '删除失败')
      }
      if (currentCragRef.current !== selectedCragId) return false

      faceImageCache.invalidate(`${selectedCragId}/${selectedFace.area}/${selectedFace.faceId}`)
      setR2Faces(prev => prev.filter(f => f.faceId !== selectedFace.faceId || f.area !== selectedFace.area))
      setRoutes(prev => applyFaceRoutes(prev, data.routes))

      const msg = data.routesCleared > 0
        ? `岩面已删除，已清除 ${data.routesCleared} 条线路的关联`
        : '岩面已删除'
      if (data.partial) await refreshContext(selectedCragId)
      if (currentCragRef.current !== selectedCragId) return false
      showToast(data.refreshPending ? publishingDelayMessage(data.warning) : data.warning || msg,
        data.refreshPending || data.partial ? 'info' : 'success', data.refreshPending ? 8000 : data.partial ? 5000 : 3000)
      return true
    } catch (error) {
      if (currentCragRef.current === selectedCragId) showToast(error instanceof Error ? error.message : '删除失败', 'error', 4000)
      return false
    }
  }, [selectedCragId, showToast, faceImageCache, setRoutes, refreshContext])

  const handleRenameFace = useCallback(async (selectedFace: FaceGroup, newFaceId: string) => {
    if (!selectedCragId) return false
    const trimmed = newFaceId.trim()
    if (!trimmed || trimmed === selectedFace.faceId) return false
    if (!FACE_ID_PATTERN.test(trimmed)) {
      showToast('名称只允许中文、小写字母、数字和连字符', 'error')
      return false
    }
    try {
      const res = await fetch('/api/faces', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cragId: selectedCragId,
          area: selectedFace.area,
          oldFaceId: selectedFace.faceId,
          newFaceId: trimmed,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success || !Array.isArray(data.routes)) {
        if (data.partial) await refreshContext(selectedCragId)
        throw new Error(data.error || '重命名失败')
      }
      if (currentCragRef.current !== selectedCragId) return false

      faceImageCache.invalidate(`${selectedCragId}/${selectedFace.area}/${selectedFace.faceId}`)
      faceImageCache.invalidate(`${selectedCragId}/${selectedFace.area}/${trimmed}`)
      setR2Faces(prev => prev.map(f => f.faceId === selectedFace.faceId && f.area === selectedFace.area ? { ...f, faceId: trimmed } : f))
      setRoutes(prev => applyFaceRoutes(prev, data.routes))

      const msg = data.routesUpdated > 0 ? `已重命名，${data.routesUpdated} 条线路已更新` : '岩面已重命名'
      if (data.partial) await refreshContext(selectedCragId)
      if (currentCragRef.current !== selectedCragId) return false
      showToast(data.refreshPending ? publishingDelayMessage(data.warning) : data.warning || msg,
        data.refreshPending || data.partial ? 'info' : 'success', data.refreshPending ? 8000 : data.partial ? 5000 : 3000)
      return trimmed
    } catch (error) {
      if (currentCragRef.current === selectedCragId) showToast(error instanceof Error ? error.message : '重命名失败', 'error', 4000)
      return false
    }
  }, [selectedCragId, showToast, faceImageCache, setRoutes, refreshContext])

  const handleUploadSuccess = useCallback(async (params: {
    url: string
    faceId: string
    area: string
    isCreating: boolean
    newArea: string
    cragId?: string
    result?: FaceMutationResult
  }) => {
    const { faceId, area, isCreating, newArea } = params
    const cragId = params.cragId ?? selectedCragId
    if (!cragId || currentCragRef.current !== cragId) return false
    const savedRoutes = params.result?.routes
    if (savedRoutes) setRoutes(prev => applyFaceRoutes(prev, savedRoutes))
    // 1. 先 invalidate，生成带新版本号的 URL
    faceImageCache.invalidate(`${cragId}/${area}/${faceId}`)
    // 2. 用 invalidate 后的版本化 URL 预加载（与订阅组件将使用的 URL 一致）
    const versionedUrl = faceImageCache.getImageUrl({
      cragId,
      area,
      faceId,
    })
    let previewFailed = false
    try { await preloadImage(versionedUrl) } catch { previewFailed = true }
    if (currentCragRef.current !== cragId) return false
    if (previewFailed) showToast('照片已上传，预览加载失败，请刷新', 'info', 4000)
    // The upload hook owns publishing-delay feedback after accepting this result.
    if (!params.result?.refreshPending) showToast(params.result?.warning || '照片上传成功！', params.result?.partial ? 'info' : 'success', params.result?.partial ? 5000 : 3000)

    if (isCreating) {
      if (newArea && !persistedAreas.includes(newArea)) {
        const merged = [...new Set([...persistedAreas, newArea])].sort()
        updateCragAreas(cragId, merged).catch(() => {
          if (currentCragRef.current === cragId) showToast('照片已保存，区域列表更新失败，请刷新核对', 'info', 4000)
        })
      }
      setR2Faces(prev => prev.some(f => f.faceId === faceId && f.area === area) ? prev : [...prev, { faceId, area }])
      setFacesCragId(cragId)
    }
    return true
  }, [selectedCragId, faceImageCache, showToast, persistedAreas, updateCragAreas, setRoutes])

  return {
    r2Faces: facesCragId === selectedCragId ? r2Faces : [],
    setR2Faces,
    isLoadingFaces,
    isRefreshing,
    facesError,
    faceGroups,
    handleRefresh,
    handleDeleteFace,
    handleRenameFace,
    handleUploadSuccess,
    refreshContext,
  }
}
