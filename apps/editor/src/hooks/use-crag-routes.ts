'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import type { Crag, Route, UserRole } from '@bloctop/shared/types'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

interface FaceInfo {
  faceId: string
  area: string
}

interface UseCragRoutesOptions {
  /** 是否同时加载 R2 岩面数据 */
  includeFaces?: boolean
  /** 编辑器模式：从 /api/editor/crags 获取权限过滤后的岩场列表 */
  editorMode?: boolean
}

/**
 * 共用 hook：加载岩场列表 + 线路列表
 * 可选并行加载 R2 faces 数据
 */
export function useCragRoutes(options?: UseCragRoutesOptions) {
  const includeFaces = options?.includeFaces ?? false
  const editorMode = options?.editorMode ?? false
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const requestedCragId = searchParams.get('cragId')

  const [crags, setCrags] = useState<Crag[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [selectionId, setSelectionId] = useState<string | null>(null)
  const [isLoadingCrags, setIsLoadingCrags] = useState(true)
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false)
  const [r2Faces, setR2Faces] = useState<FaceInfo[]>([])
  const [isLoadingFaces, setIsLoadingFaces] = useState(false)
  // 编辑器模式下的额外状态
  const [userRole, setUserRole] = useState<UserRole | null>(null)
  const [canCreate, setCanCreate] = useState(false)
  const [cragsError, setCragsError] = useState<string | null>(null)
  const [cragsLoadVersion, setCragsLoadVersion] = useState(0)
  const reloadCrags = useCallback(() => setCragsLoadVersion(version => version + 1), [])

  // 加载岩场列表
  useEffect(() => {
    const controller = new AbortController()
    const endpoint = editorMode ? '/api/editor/crags' : '/api/crags'
    async function loadCrags() {
      setIsLoadingCrags(true)
      setCragsError(null)
      try {
        const response = await fetch(endpoint, { signal: controller.signal })
        const data = await response.json()
        if (!response.ok || !Array.isArray(data.crags)) throw new Error(data.error || '加载岩场失败')
        if (!controller.signal.aborted) {
          setCrags(data.crags || [])
          if (editorMode) {
            setUserRole(data.role ?? null)
            setCanCreate(data.canCreate ?? false)
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) setCragsError(error instanceof Error ? error.message : '加载岩场失败')
      } finally {
        if (!controller.signal.aborted) setIsLoadingCrags(false)
      }
    }
    loadCrags()
    return () => controller.abort()
  }, [editorMode, cragsLoadVersion])

  const cragSelectionError = cragsError || (!isLoadingCrags && requestedCragId && !crags.some(crag => crag.id === requestedCragId)
    ? '你无权访问此岩场或岩场不存在，请重新选择。' : null)
  const selectedCragId = cragSelectionError ? null : selectionId

  useEffect(() => {
    if (isLoadingCrags) return
    if (requestedCragId) {
      setSelectionId(crags.some(crag => crag.id === requestedCragId) ? requestedCragId : null)
    } else {
      setSelectionId(previous => crags.some(crag => crag.id === previous) ? previous : crags[0]?.id ?? null)
    }
  }, [crags, isLoadingCrags, requestedCragId])

  const setSelectedCragId = useCallback((id: string | null) => {
    if (id && !crags.some(crag => crag.id === id)) return
    setSelectionId(id)
    const query = new URLSearchParams(searchParams.toString())
    if (id) query.set('cragId', id)
    else query.delete('cragId')
    router.replace(`${pathname}${query.size ? `?${query}` : ''}`, { scroll: false })
  }, [crags, pathname, router, searchParams])

  // 加载岩场线路（可选并行加载 faces）
  useEffect(() => {
    if (!selectedCragId) {
      setRoutes([])
      if (includeFaces) setR2Faces([])
      setIsLoadingRoutes(false)
      setIsLoadingFaces(false)
      return
    }

    setRoutes([])
    if (includeFaces) setR2Faces([])

    let cancelled = false

    async function loadData() {
      setIsLoadingRoutes(true)
      if (includeFaces) setIsLoadingFaces(true)

      const promises: Promise<void>[] = [
        fetch(`/api/crags/${selectedCragId}/routes`)
          .then(res => res.json())
          .then(data => { if (!cancelled) setRoutes(data.routes || []) })
          .catch(err => console.error('Failed to load routes:', err))
          .finally(() => { if (!cancelled) setIsLoadingRoutes(false) }),
      ]

      if (includeFaces) {
        promises.push(
          fetch(`/api/faces?cragId=${encodeURIComponent(selectedCragId!)}`)
            .then(res => res.json())
            .then(data => { if (!cancelled && data.success) setR2Faces(data.faces || []) })
            .catch(() => { /* silent fallback */ })
            .finally(() => { if (!cancelled) setIsLoadingFaces(false) })
        )
      }

      await Promise.all(promises)
    }

    loadData()
    return () => { cancelled = true }
  }, [selectedCragId, includeFaces])

  // Do not expose the previous crag's records while the next context loads.
  const visibleRoutes = useMemo(() => routes.filter(route => route.cragId === selectedCragId), [routes, selectedCragId])

  // 统计数据
  const stats = useMemo(() => {
    const marked = visibleRoutes.filter((r) => r.topoLine && r.topoLine.length >= 2)
    return {
      total: visibleRoutes.length,
      marked: marked.length,
      unmarked: visibleRoutes.length - marked.length,
      progress: visibleRoutes.length > 0 ? (marked.length / visibleRoutes.length) * 100 : 0,
    }
  }, [visibleRoutes])

  // 更新指定岩场的 areas 并同步本地状态
  const updateCragAreas = useCallback(async (cragId: string, areas: string[]) => {
    const res = await fetch(`/api/crags/${cragId}/areas`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ areas }),
    })
    if (!res.ok) throw new Error('更新区域失败')
    const data = await res.json()
    const savedAreas: string[] = data.areas
    setCrags(prev => prev.map(c => c.id === cragId ? { ...c, areas: savedAreas } : c))
    return savedAreas
  }, [])

  return {
    crags,
    routes: visibleRoutes,
    setRoutes,
    selectedCragId,
    setSelectedCragId,
    isLoadingCrags,
    isLoadingRoutes,
    cragSelectionError,
    reloadCrags,
    stats,
    updateCragAreas,
    ...(includeFaces ? { r2Faces, setR2Faces, isLoadingFaces } : {}),
    ...(editorMode ? { userRole, canCreate } : {}),
  }
}
