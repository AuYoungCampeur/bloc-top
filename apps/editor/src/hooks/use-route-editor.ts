import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import type { Route, TopoPoint, RouteTopoAnnotation } from '@bloctop/shared/types'
import { catmullRomCurve, scalePoints } from '@bloctop/shared/topo-utils'
import { getGradeColor } from '@bloctop/shared/tokens'
import { computeViewBox } from '@bloctop/shared/topo-constants'
import { useToast } from '@bloctop/ui/components/toast'
import { validateRouteForm } from '@/lib/route-validation'
import type { FaceImageCacheService } from '@bloctop/ui/face-image'
import { getRouteTopoAnnotations } from '@bloctop/shared/face-references'
import { publishingDelayMessage } from '@/lib/publishing-feedback'

export interface UseRouteEditorOptions {
  selectedRoute: Route | null
  faceImageCache: FaceImageCacheService
  setRoutes: React.Dispatch<React.SetStateAction<Route[]>>
  persistedAreas: string[]
  selectedCragId: string | null
  updateCragAreas: (cragId: string, areas: string[]) => Promise<string[]>
}

/** 从路由数据初始化 annotations（兼容旧字段） */
function buildInitialAnnotations(route: Route): RouteTopoAnnotation[] {
  return getRouteTopoAnnotations(route)
}

/** Persisted fields owned by this editor; Beta updates are a separate workflow. */
function buildEditorSelection(route: Route) {
  return {
    id: route.id,
    cragId: route.cragId,
    topoVersion: route.topoVersion ?? 0,
    fields: {
      name: route.name,
      grade: route.grade,
      area: route.area,
      setter: route.setter,
      FA: route.FA,
      description: route.description,
    },
    annotations: buildInitialAnnotations(route),
  }
}

type EditorSelection = ReturnType<typeof buildEditorSelection>
const EMPTY_TOPO_LINE: TopoPoint[] = []

function draftHasChanges(selection: EditorSelection, fields: Partial<Route>, annotations: RouteTopoAnnotation[]) {
  const editableFields = ['name', 'grade', 'area', 'FA', 'setter', 'description'] as const
  if (editableFields.some(field => (fields[field] ?? '') !== (selection.fields[field] ?? ''))) return true
  const original = selection.annotations
  if (annotations.length !== original.length) return true
  return annotations.some((annotation, index) => {
    const baseline = original[index]
    return annotation.faceId !== baseline.faceId || annotation.area !== baseline.area
      || (annotation.topoTension ?? 0) !== (baseline.topoTension ?? 0)
      || annotation.topoLine.length !== baseline.topoLine.length
      || annotation.topoLine.some((point, i) => point.x !== baseline.topoLine[i].x || point.y !== baseline.topoLine[i].y)
  })
}

export function useRouteEditor({
  selectedRoute,
  faceImageCache,
  setRoutes,
  persistedAreas,
  selectedCragId,
  updateCragAreas,
}: UseRouteEditorOptions) {
  const { showToast } = useToast()

  // Persisted records and the loaded draft baseline are separate: a newer
  // server Topo must not silently change an unsaved draft's expected version.
  const selectionKey = selectedRoute ? JSON.stringify(buildEditorSelection(selectedRoute)) : null
  const persistedSelection = useMemo<EditorSelection | null>(
    () => selectionKey ? JSON.parse(selectionKey) as EditorSelection : null,
    [selectionKey],
  )
  const [editorSelection, setEditorSelection] = useState<EditorSelection | null>(null)
  const loadedSelectionRef = useRef<EditorSelection | null>(null)
  const currentRouteIdRef = useRef(selectedRoute?.id ?? null)
  currentRouteIdRef.current = selectedRoute?.id ?? null
  const currentTopoVersionRef = useRef(selectedRoute?.topoVersion ?? 0)
  currentTopoVersionRef.current = selectedRoute?.topoVersion ?? 0
  const currentSelectionKeyRef = useRef(selectionKey)
  currentSelectionKeyRef.current = selectionKey
  const savedSelectionKeyRef = useRef<string | null>(null)

  // Edit state
  const [editedRoute, setEditedRoute] = useState<Partial<Route>>({})
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  // Multi-annotation state（替代旧的 topoLine/topoTension/selectedFaceId）
  const [annotations, setAnnotations] = useState<RouteTopoAnnotation[]>([])
  const [activeAnnotationIndex, setActiveAnnotationIndex] = useState(0)
  const currentDraftRef = useRef({ fields: editedRoute, annotations })
  currentDraftRef.current = { fields: editedRoute, annotations }

  // Derived values from active annotation
  const activeAnnotation = annotations[activeAnnotationIndex] ?? null
  const topoLine = activeAnnotation?.topoLine ?? EMPTY_TOPO_LINE
  const topoTension = activeAnnotation?.topoTension ?? 0
  const selectedFaceId = activeAnnotation?.faceId ?? null

  // Image state
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [isImageLoading, setIsImageLoading] = useState(false)
  const [imageLoadError, setImageLoadError] = useState(false)
  const [imageAspectRatio, setImageAspectRatio] = useState<number | undefined>(undefined)

  // Save state
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const savingRef = useRef(false)

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // Fullscreen topo state
  const [isFullscreenEdit, setIsFullscreenEdit] = useState(false)
  const [showOtherRoutes, setShowOtherRoutes] = useState(true)

  const topoSnapshotRef = useRef<{ annotations: RouteTopoAnnotation[]; index: number } | null>(null)

  // Dirty check：比较当前 annotations 与路由原始数据
  const hasUnsavedChanges = useCallback((): boolean => {
    if (!editorSelection) return false
    return draftHasChanges(editorSelection, editedRoute, annotations)
  }, [editorSelection, editedRoute, annotations])

  const loadPersistedDraft = useCallback((selection: EditorSelection) => {
    loadedSelectionRef.current = selection
    setEditorSelection(selection)
    setEditedRoute(selection.fields)
    setFormErrors({})
    setSaveError(null)

    const initialAnnotations = selection.annotations
    setAnnotations(initialAnnotations)
    setActiveAnnotationIndex(0)

    const firstAnnotation = initialAnnotations[0] ?? null
    if (firstAnnotation) {
      const url = faceImageCache.getImageUrl({
        cragId: selection.cragId,
        area: firstAnnotation.area,
        faceId: firstAnnotation.faceId,
      })
      setImageUrl(prev => {
        if (prev === url) return prev
        setIsImageLoading(true)
        setImageAspectRatio(undefined)
        return url
      })
      setImageLoadError(false)
    } else {
      setImageUrl(null)
      setImageLoadError(false)
    }
  }, [faceImageCache])

  // Initialize on selection or persisted editable changes, preserving Beta-only edits.
  useEffect(() => {
    // The save handler already reconciles this exact server response with any
    // edits made while awaiting it. Updating the baseline must not reset them.
    if (selectionKey === savedSelectionKeyRef.current) {
      savedSelectionKeyRef.current = null
      loadedSelectionRef.current = persistedSelection
      setEditorSelection(persistedSelection)
      return
    }
    savedSelectionKeyRef.current = null
    if (!persistedSelection) {
      loadedSelectionRef.current = null
      setEditorSelection(null)
      return
    }
    const loaded = loadedSelectionRef.current
    if (loaded?.id === persistedSelection.id && loaded.cragId === persistedSelection.cragId) {
      // An external Topo update must not silently upgrade the expected version
      // of an older unsaved draft or replace it with someone else's geometry.
      if (persistedSelection.topoVersion < loaded.topoVersion) return
      const currentDraft = currentDraftRef.current
      const isDirty = draftHasChanges(loaded, currentDraft.fields, currentDraft.annotations)
      if (persistedSelection.topoVersion > loaded.topoVersion && isDirty) {
        setSaveError('线路 Topo 已有新版本，当前草稿已保留，请核对最新线路后再保存。')
        return
      }
    }
    loadPersistedDraft(persistedSelection)
  }, [persistedSelection, loadPersistedDraft, selectionKey])

  // Annotation management
  const loadAnnotationImage = useCallback((faceId: string, area: string) => {
    if (!selectedRoute) return
    setImageUrl(faceImageCache.getImageUrl({ cragId: selectedRoute.cragId, area, faceId }))
    setIsImageLoading(true)
    setImageLoadError(false)
    setImageAspectRatio(undefined)
  }, [selectedRoute, faceImageCache])

  const activateAnnotation = useCallback((index: number) => {
    const annotation = annotations[index]
    if (!annotation) return false
    setActiveAnnotationIndex(index)
    loadAnnotationImage(annotation.faceId, annotation.area)
    return true
  }, [annotations, loadAnnotationImage])

  const addAnnotation = useCallback((faceId: string, area: string) => {
    if (!selectedRoute) return
    const newAnnotation: RouteTopoAnnotation = { faceId, area, topoLine: [] }
    setAnnotations(prev => {
      const existingIndex = prev.findIndex(annotation => annotation.faceId === faceId && annotation.area === area)
      if (existingIndex !== -1) {
        setActiveAnnotationIndex(existingIndex)
        return prev
      }
      const next = [...prev, newAnnotation]
      setActiveAnnotationIndex(next.length - 1)
      return next
    })
    loadAnnotationImage(faceId, area)
  }, [selectedRoute, loadAnnotationImage])

  const removeAnnotation = useCallback((index: number) => {
    setAnnotations(prev => {
      const next = prev.filter((_, i) => i !== index)
      const newIndex = Math.min(index, Math.max(0, next.length - 1))
      setActiveAnnotationIndex(newIndex)
      // 更新 imageUrl 到新的 active annotation
      const newActive = next[newIndex]
      if (newActive && selectedRoute) {
        const url = faceImageCache.getImageUrl({
          cragId: selectedRoute.cragId,
          area: newActive.area,
          faceId: newActive.faceId,
        })
        setImageUrl(url)
        setIsImageLoading(true)
        setImageAspectRatio(undefined)
      } else {
        setImageUrl(null)
      }
      return next
    })
  }, [selectedRoute, faceImageCache])

  const updateActiveTopoLine = useCallback((points: TopoPoint[]) => {
    setAnnotations(prev => prev.map((a, i) =>
      i === activeAnnotationIndex ? { ...a, topoLine: points } : a
    ))
  }, [activeAnnotationIndex])

  const updateActiveTopoTension = useCallback((tension: number) => {
    setAnnotations(prev => prev.map((a, i) =>
      i === activeAnnotationIndex ? { ...a, topoTension: tension } : a
    ))
  }, [activeAnnotationIndex])

  // Canvas operations (delegate to active annotation)
  const handleRemoveLastPoint = useCallback(() => {
    updateActiveTopoLine(topoLine.slice(0, -1))
  }, [topoLine, updateActiveTopoLine])

  const handleClearPoints = useCallback(() => {
    updateActiveTopoLine([])
    updateActiveTopoTension(0)
  }, [updateActiveTopoLine, updateActiveTopoTension])

  // Fullscreen topo
  const handleOpenFullscreen = useCallback(() => {
    topoSnapshotRef.current = { annotations: annotations.map(a => ({ ...a, topoLine: [...a.topoLine] })), index: activeAnnotationIndex }
    setIsFullscreenEdit(true)
  }, [annotations, activeAnnotationIndex])

  const handleFullscreenClose = useCallback((confirmed: boolean) => {
    if (!confirmed && topoSnapshotRef.current) {
      setAnnotations(topoSnapshotRef.current.annotations)
      setActiveAnnotationIndex(topoSnapshotRef.current.index)
    }
    topoSnapshotRef.current = null
    setIsFullscreenEdit(false)
  }, [])

  // Save
  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!selectedRoute || savingRef.current) return false

    const errors = validateRouteForm({ name: editedRoute.name || '', area: editedRoute.area || '' })
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return false
    }
    setFormErrors({})

    const submittedDraftKey = JSON.stringify({ fields: editedRoute, annotations })
    savingRef.current = true
    setIsSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    try {
      const validAnnotations = annotations.filter(a => a.topoLine.length >= 2)
      const firstAnnotation = validAnnotations[0]

      const response = await fetch(`/api/routes/${selectedRoute.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editedRoute,
          expectedTopoVersion: editorSelection?.topoVersion ?? 0,
          topoAnnotations: validAnnotations,
          // compat sync：旧字段同步自第一条标注，保持向后兼容
          faceId: firstAnnotation?.faceId ?? null,
          topoLine: firstAnnotation?.topoLine ?? null,
          topoTension: firstAnnotation?.topoTension ?? null,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        if (response.status === 409 || response.status === 428) {
          throw new Error(`${data.error || '线路已发生变化'}。当前草稿已保留，请核对最新线路后再保存。`)
        }
        throw new Error(data.error || '保存失败')
      }

      const isCurrentSelection = currentRouteIdRef.current === selectedRoute.id
      const responseVersion = data.route.topoVersion ?? 0
      const loadedVersion = loadedSelectionRef.current?.id === selectedRoute.id
        ? loadedSelectionRef.current.topoVersion : 0
      if (isCurrentSelection && responseVersion < Math.max(currentTopoVersionRef.current, loadedVersion)) {
        const message = '保存响应已过期，当前线路和草稿已保留，请核对最新线路。'
        setSaveError(message)
        showToast(message, 'error', 4000)
        return false
      }
      const hasNewChanges = isCurrentSelection && JSON.stringify(currentDraftRef.current) !== submittedDraftKey
      if (isCurrentSelection) {
        const savedSelection = buildEditorSelection(data.route)
        loadedSelectionRef.current = savedSelection
        setEditorSelection(savedSelection)
        const savedKey = JSON.stringify(savedSelection)
        if (savedKey !== currentSelectionKeyRef.current) savedSelectionKeyRef.current = savedKey
        // Adopt normalization only if the user has not continued editing. The
        // current draft otherwise remains intact against the new server baseline.
        if (!hasNewChanges) loadPersistedDraft(savedSelection)
        setSaveSuccess(!hasNewChanges)
      }
      // Route PATCH owns the form and Topo fields. Beta mutations may have
      // completed while this request was in flight and must keep their result.
      setRoutes((prev) => prev.map((r) => r.id === selectedRoute.id
        ? (responseVersion < (r.topoVersion ?? 0) ? r : { ...data.route, betaLinks: r.betaLinks })
        : r))

      const savedArea = editedRoute.area?.trim()
      if (savedArea && selectedCragId && !persistedAreas.includes(savedArea)) {
        const merged = [...new Set([...persistedAreas, savedArea])].sort()
        updateCragAreas(selectedCragId, merged).catch(() => {})
      }

      showToast(
        data.refreshPending
          ? `${publishingDelayMessage(data.warning)}${hasNewChanges ? '；后续修改尚未保存' : ''}`
          : hasNewChanges ? '已保存提交内容，后续修改尚未保存' : '线路信息保存成功！',
        data.refreshPending || hasNewChanges ? 'info' : 'success',
        data.refreshPending ? 8000 : hasNewChanges ? 4000 : 3000,
      )
      setTimeout(() => setSaveSuccess(false), 2000)
      // Save-and-switch must stay on this route if the latest draft was not sent.
      return !hasNewChanges
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '保存失败'
      if (currentRouteIdRef.current === selectedRoute.id) setSaveError(errorMsg)
      showToast(errorMsg, 'error', 4000)
      return false
    } finally {
      savingRef.current = false
      setIsSaving(false)
    }
  }, [selectedRoute, editorSelection, editedRoute, annotations, setRoutes, showToast, persistedAreas, selectedCragId, updateCragAreas, loadPersistedDraft])

  // Delete
  const handleDeleteRoute = useCallback(async () => {
    if (!selectedRoute || isDeleting) return
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/routes/${selectedRoute.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '删除失败')

      setRoutes(prev => prev.filter(r => r.id !== selectedRoute.id))
      setShowDeleteConfirm(false)
      showToast(data.refreshPending ? publishingDelayMessage(data.warning) : '线路已删除', data.refreshPending ? 'info' : 'success', data.refreshPending ? 8000 : 3000)
      return true
    } catch (error) {
      const msg = error instanceof Error ? error.message : '删除失败'
      showToast(msg, 'error', 4000)
      return false
    } finally {
      setIsDeleting(false)
    }
  }, [selectedRoute, isDeleting, setRoutes, showToast])

  // Face selection — 新增标注（兼容旧 handleFaceSelect 调用）
  const handleFaceSelect = useCallback((faceId: string, area: string) => {
    addAnnotation(faceId, area)
  }, [addAnnotation])

  // Image event handlers
  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    setIsImageLoading(false)
    setImageLoadError(false)
    const img = e.currentTarget
    if (img.naturalWidth && img.naturalHeight) {
      setImageAspectRatio(img.naturalWidth / img.naturalHeight)
    }
  }, [])

  const handleImageError = useCallback(() => {
    setIsImageLoading(false)
    setImageLoadError(true)
  }, [])

  // SVG computations（基于激活标注的派生值）
  const routeColor = useMemo(
    () => getGradeColor(editedRoute.grade || selectedRoute?.grade || '？'),
    [editedRoute.grade, selectedRoute?.grade]
  )

  const vb = useMemo(() => computeViewBox(imageAspectRatio ?? 4 / 3), [imageAspectRatio])

  const scaledPoints = useMemo(
    () => scalePoints(topoLine, vb.width, vb.height),
    [topoLine, vb]
  )

  const pathData = useMemo(() => {
    if (scaledPoints.length < 2) return ''
    return catmullRomCurve(scaledPoints, 0.5, topoTension)
  }, [scaledPoints, topoTension])

  // Reset on deselect
  const resetEditor = useCallback(() => {
    setAnnotations([])
    setActiveAnnotationIndex(0)
    setImageUrl(null)
    setImageLoadError(false)
    setIsImageLoading(false)
  }, [])

  return {
    // Edit state
    editedRoute,
    setEditedRoute,
    formErrors,
    setFormErrors,

    // Multi-annotation state
    annotations,
    activeAnnotationIndex,
    setActiveAnnotationIndex,
    activateAnnotation,
    addAnnotation,
    removeAnnotation,
    updateActiveTopoLine,
    updateActiveTopoTension,

    // Derived from active annotation（供现有 UI 组件直接读取，无需改动）
    topoLine,
    topoTension,
    selectedFaceId,

    // Legacy setters（保持向后兼容，供 routes/page.tsx 画布点击使用）
    setTopoLine: updateActiveTopoLine,
    setTopoTension: updateActiveTopoTension,

    // Image state
    imageUrl,
    isImageLoading,
    imageLoadError,
    imageAspectRatio,

    // Save state
    isSaving,
    saveError,
    saveSuccess,

    // Delete state
    showDeleteConfirm,
    setShowDeleteConfirm,
    isDeleting,

    // Fullscreen
    isFullscreenEdit,
    showOtherRoutes,
    setShowOtherRoutes,

    // SVG
    routeColor,
    vb,
    scaledPoints,
    pathData,

    // Actions
    hasUnsavedChanges,
    handleSave,
    handleDeleteRoute,
    handleFaceSelect,
    handleImageLoad,
    handleImageError,
    handleRemoveLastPoint,
    handleClearPoints,
    handleOpenFullscreen,
    handleFullscreenClose,
    resetEditor,
  }
}
