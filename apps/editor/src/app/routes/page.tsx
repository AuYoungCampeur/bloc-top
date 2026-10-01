'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import {
  Save,
  Check,
  Loader2,
  Search,
  X,
  Sparkles,
  Mountain,
  Edit3,
  AlertCircle,
  Plus,
  Trash2,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import { EditorPageHeader } from '@/components/editor/editor-page-header'
import { Input } from '@bloctop/ui/components/input'
import { Textarea } from '@bloctop/ui/components/textarea'
import type { Route } from '@bloctop/shared/types'
import { useFaceImageCache } from '@bloctop/ui/face-image/use-face-image'
import { useBreakAppShellLimit } from '@/hooks/use-break-app-shell-limit'
import { matchRouteByQuery } from '@/hooks/use-route-search'
import { useCragRoutes } from '@/hooks/use-crag-routes'
import { CragSelector } from '@/components/editor/crag-selector'
import { RouteCard } from '@/components/editor/route-card'
import { AreaSelect } from '@/components/editor/area-select'
import { MultiTopoLineOverlay } from '@/components/multi-topo-line-overlay'
import type { MultiTopoRoute } from '@/components/multi-topo-line-overlay'
import { GRADE_OPTIONS } from '@bloctop/shared/editor-utils'
import { deriveAreas, getPersistedAreas } from '@bloctop/shared/editor-areas'
import { ConfirmDialog } from '@/components/editor/confirm-dialog'
import { FaceSelector } from '@/components/editor/face-selector'
import { TopoPreview } from '@/components/editor/topo-preview'
import { useRouteEditor } from '@/hooks/use-route-editor'
import { useRouteCreation } from '@/hooks/use-route-creation'
import { useDirtyGuard } from '@/hooks/use-dirty-guard'
import type { R2FaceInfo, FaceGroup } from '@/types/face'
import { useBetaManagement } from '@/hooks/use-beta-management'
import { BetaCard } from '@/components/editor/beta-card'
import { BetaSubmitDrawer } from '@/components/beta-submit-drawer'
import type { BetaLink } from '@bloctop/shared/types'
import { Play } from 'lucide-react'
import { InlineFaceUpload } from '@/components/editor/inline-face-upload'

const FullscreenTopoEditor = dynamic(
  () => import('@/components/editor/fullscreen-topo-editor'),
  { ssr: false }
)

type PendingAction =
  | { type: 'switchRoute'; payload: Route }
  | { type: 'switchArea'; payload: string | null }
  | { type: 'switchCrag'; payload: string }
  | { type: 'goBackMobile' }

/**
 * 线路标注页面
 * 选 crag → 选 area → 选线路 → 自动匹配 face → 画 topoLine
 */
export default function RouteAnnotationPage() {
  const {
    crags, routes, setRoutes, selectedCragId, setSelectedCragId,
    isLoadingCrags, isLoadingRoutes, stats, updateCragAreas,
  } = useCragRoutes({ editorMode: true })
  const faceImageCache = useFaceImageCache()

  // ============ R2 上已有的 face 列表 ============
  const [r2Faces, setR2Faces] = useState<R2FaceInfo[]>([])
  const [isLoadingFaces, setIsLoadingFaces] = useState(false)

  // ============ 导航状态 ============
  const [selectedArea, setSelectedArea] = useState<string | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null)
  // Routes are the persisted source of truth; selection stores only identity.
  const selectedRoute = useMemo(
    () => routes.find(route => route.id === selectedRouteId) ?? null,
    [routes, selectedRouteId],
  )
  const [showEditorPanel, setShowEditorPanel] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterMode, setFilterMode] = useState<'all' | 'marked' | 'unmarked'>('all')
  const [activeTab, setActiveTab] = useState<'topo' | 'beta'>('topo')
  const [showFaceSelector, setShowFaceSelector] = useState(false)

  // ============ 派生数据 ============
  const selectedCrag = useMemo(() => crags.find(c => c.id === selectedCragId), [crags, selectedCragId])
  const areas = useMemo(
    () => deriveAreas(routes, selectedCragId, selectedCrag),
    [routes, selectedCrag, selectedCragId],
  )
  const persistedAreas = useMemo(() => getPersistedAreas(selectedCrag), [selectedCrag])

  // ============ Hooks ============
  const editor = useRouteEditor({
    selectedRoute,
    faceImageCache,
    setRoutes,
    persistedAreas,
    selectedCragId,
    updateCragAreas,
  })

  // ============ Beta 管理 ============
  const {
    editingBetaId,
    editForm, setEditForm,
    isSaving: isBetaSaving, deletingBetaId,
    handleStartEdit: handleStartBetaEdit,
    handleCancelEdit: handleCancelBetaEdit,
    handleBetaAdded,
    handleSaveBeta,
    handleDeleteBeta,
  } = useBetaManagement({ setRoutes })

  const [showBetaSubmitDrawer, setShowBetaSubmitDrawer] = useState(false)

  const handleBetaSubmitSuccess = useCallback((newBeta: BetaLink) => {
    if (!selectedRoute) return
    handleBetaAdded(selectedRoute.id, newBeta)
  }, [selectedRoute, handleBetaAdded])

  const creation = useRouteCreation({
    selectedCragId,
    selectedArea,
    areas,
    setRoutes,
    persistedAreas,
    updateCragAreas,
    hasUnsavedChanges: editor.hasUnsavedChanges,
  })

  const executePendingAction = useCallback((action: PendingAction) => {
    switch (action.type) {
      case 'switchRoute':
        setSelectedRouteId(action.payload.id)
        setActiveTab('topo')
        break
      case 'switchArea':
        setSelectedArea(action.payload)
        setSelectedRouteId(null)
        setActiveTab('topo')
        setShowEditorPanel(false)
        break
      case 'switchCrag':
        setSelectedCragId(action.payload)
        setSelectedRouteId(null)
        setSelectedArea(null)
        editor.resetEditor()
        setActiveTab('topo')
        setShowEditorPanel(false)
        break
      case 'goBackMobile':
        setShowEditorPanel(false)
        setSelectedRouteId(null)
        setActiveTab('topo')
        break
    }
  }, [setSelectedCragId, editor])

  const dirtyGuard = useDirtyGuard<PendingAction>({
    hasUnsavedChanges: editor.hasUnsavedChanges,
    onSave: editor.handleSave,
    executeAction: executePendingAction,
  })

  // ============ 从 R2 加载岩面列表 ============
  // Render-time state adjustment: reset faces and trigger loading when cragId changes
  const [prevFacesCragId, setPrevFacesCragId] = useState(selectedCragId)
  if (prevFacesCragId !== selectedCragId) {
    setPrevFacesCragId(selectedCragId)
    if (!selectedCragId) {
      setR2Faces([])
      setIsLoadingFaces(false)
    } else {
      setIsLoadingFaces(true)
    }
  }

  useEffect(() => {
    if (!selectedCragId) return
    let cancelled = false
    fetch(`/api/faces?cragId=${encodeURIComponent(selectedCragId)}`)
      .then(res => res.json())
      .then(data => {
        if (!cancelled && data.success) setR2Faces(data.faces as R2FaceInfo[])
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setIsLoadingFaces(false) })
    return () => { cancelled = true }
  }, [selectedCragId])

  useBreakAppShellLimit()

  // ============ 派生数据：面组、线路过滤 ============
  const areaFaceGroups = useMemo(() => {
    if (!selectedCragId) return []
    const map = new Map<string, FaceGroup>()
    r2Faces.forEach(({ faceId, area }) => {
      map.set(faceId, {
        faceId, area, routes: [],
        imageUrl: faceImageCache.getImageUrl({ cragId: selectedCragId, area, faceId }),
      })
    })
    routes.forEach(r => {
      if (!r.faceId) return
      const entry = map.get(r.faceId)
      if (entry) entry.routes.push(r)
    })
    let result = Array.from(map.values())
    if (selectedArea) result = result.filter(f => f.area === selectedArea)
    return result
  }, [routes, r2Faces, selectedCragId, selectedArea, faceImageCache])

  const showInlineUpload = !!selectedRoute
    && activeTab === 'topo'
    && !isLoadingFaces
    && areaFaceGroups.length === 0

  const areaRoutes = useMemo(() => {
    if (!selectedArea) return routes
    return routes.filter(r => r.area === selectedArea)
  }, [routes, selectedArea])

  const filteredRoutes = useMemo(() => {
    let result = areaRoutes
    if (searchQuery) {
      const query = searchQuery.trim().toLowerCase()
      result = result.filter((r) => {
        if (matchRouteByQuery(r, query)) return true
        if (r.area?.toLowerCase().includes(query)) return true
        if (r.grade.toLowerCase().includes(query)) return true
        return false
      })
    }
    if (filterMode === 'marked') {
      result = result.filter((r) => r.topoLine && r.topoLine.length >= 2)
    } else if (filterMode === 'unmarked') {
      result = result.filter((r) => !r.topoLine || r.topoLine.length < 2)
    }
    return result
  }, [areaRoutes, searchQuery, filterMode])

  const areaStats = useMemo(() => {
    const marked = areaRoutes.filter((r) => r.topoLine && r.topoLine.length >= 2)
    return { total: areaRoutes.length, marked: marked.length, unmarked: areaRoutes.length - marked.length }
  }, [areaRoutes])

  const areaCounts = useMemo(() => {
    const counts = new Map<string, number>()
    routes.forEach(r => { if (r.area) counts.set(r.area, (counts.get(r.area) || 0) + 1) })
    return counts
  }, [routes])

  const sameFaceRoutes = useMemo<MultiTopoRoute[]>(() => {
    if (!editor.selectedFaceId || !editor.showOtherRoutes) return []
    const faceGroup = areaFaceGroups.find(f => f.faceId === editor.selectedFaceId)
    if (!faceGroup) return []
    return faceGroup.routes
      .filter(r => r.id !== selectedRoute?.id && r.topoLine && r.topoLine.length >= 2)
      .map(r => ({ id: r.id, name: r.name, grade: r.grade, topoLine: r.topoLine!, topoTension: r.topoTension }))
  }, [selectedRoute, editor.selectedFaceId, areaFaceGroups, editor.showOtherRoutes])

  // ============ 事件处理 ============
  const handleRouteClick = useCallback((route: Route) => {
    if (selectedRoute?.id === route.id) return
    dirtyGuard.guardAction({ type: 'switchRoute', payload: route })
  }, [selectedRoute, dirtyGuard])

  const handleAreaSwitch = useCallback((area: string | null) => {
    if (selectedArea === area) return
    dirtyGuard.guardAction({ type: 'switchArea', payload: area })
  }, [selectedArea, dirtyGuard])

  const handleSelectCrag = useCallback((id: string) => {
    dirtyGuard.guardAction({ type: 'switchCrag', payload: id })
  }, [dirtyGuard])

  const handleStartCreate = useCallback(() => {
    const started = creation.handleStartCreate()
    if (started) {
      setSelectedRouteId(null)
      setActiveTab('topo')
      setShowEditorPanel(true)
    }
  }, [creation])

  const handleSubmitCreate = useCallback(async () => {
    const created = await creation.handleSubmitCreate()
    if (created) {
      setSelectedRouteId(created.id)
    }
  }, [creation])

  const handleCancelCreate = useCallback(() => {
    creation.handleCancelCreate()
    setShowEditorPanel(false)
  }, [creation])

  const handleDeleteRoute = useCallback(async () => {
    const deleted = await editor.handleDeleteRoute()
    if (deleted) {
      setSelectedRouteId(null)
      setActiveTab('topo')
      setShowEditorPanel(false)
    }
  }, [editor])

  const handleRouteClickFromTopo = useCallback((routeId: number) => {
    const target = routes.find(r => r.id === routeId)
    if (target) handleRouteClick(target)
  }, [routes, handleRouteClick])

  // Render-time state adjustment: open editor panel when a route is selected; reset face selector on route change
  const [prevSelectedRoute, setPrevSelectedRoute] = useState(selectedRoute)
  if (prevSelectedRoute !== selectedRoute) {
    setPrevSelectedRoute(selectedRoute)
    if (selectedRoute) {
      setShowEditorPanel(true)
    }
    setShowFaceSelector(false)
  }

  // ============ 左栏 ============
  const leftPanel = (
    <div className="flex flex-col h-full">
      <CragSelector
        crags={crags}
        selectedCragId={selectedCragId}
        isLoading={isLoadingCrags}
        onSelect={handleSelectCrag}
        stats={stats}
      />

      {selectedCragId && (
        <>
          {/* Area 芯片选择器 */}
          <div className="mb-3">
            <label className="block text-xs font-medium mb-1.5 px-1" style={{ color: 'var(--theme-on-surface-variant)' }}>
              选择区域
            </label>
            {isLoadingRoutes ? (
              <div className="flex items-center justify-center py-4" style={{ color: 'var(--theme-on-surface-variant)' }}>
                <div className="w-5 h-5 animate-spin"><Loader2 className="w-full h-full" /></div>
              </div>
            ) : (
              <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2">
                <button
                  onClick={() => handleAreaSwitch(null)}
                  className={`px-4 py-2 rounded-full whitespace-nowrap transition-all duration-200 active:scale-95 font-medium text-sm ${selectedArea === null ? '' : 'glass-light'}`}
                  style={{
                    backgroundColor: selectedArea === null ? 'var(--theme-primary)' : undefined,
                    color: selectedArea === null ? 'var(--theme-on-primary)' : 'var(--theme-on-surface)',
                  }}
                >
                  全部 ({routes.length})
                </button>
                {areas.map(area => (
                  <button
                    key={area}
                    onClick={() => handleAreaSwitch(area)}
                    className={`px-4 py-2 rounded-full whitespace-nowrap transition-all duration-200 active:scale-95 font-medium text-sm ${selectedArea === area ? '' : 'glass-light'}`}
                    style={{
                      backgroundColor: selectedArea === area ? 'var(--theme-primary)' : undefined,
                      color: selectedArea === area ? 'var(--theme-on-primary)' : 'var(--theme-on-surface)',
                    }}
                  >
                    {area} ({areaCounts.get(area) || 0})
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 搜索和筛选 */}
          <div className="relative mb-3">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--theme-on-surface-variant)' }} />
            <Input
              variant="search"
              placeholder="搜索线路..."
              value={searchQuery}
              onChange={setSearchQuery}
              className="pl-12 pr-10 py-3 rounded-xl"
              style={{ backgroundColor: 'var(--theme-surface-variant)' }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full" style={{ backgroundColor: 'var(--theme-outline)' }}>
                <X className="w-4 h-4" style={{ color: 'var(--theme-on-surface)' }} />
              </button>
            )}
          </div>

          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 mb-3">
            {[
              { key: 'all' as const, label: '全部', count: areaStats.total },
              { key: 'unmarked' as const, label: '待标注', count: areaStats.unmarked },
              { key: 'marked' as const, label: '已标注', count: areaStats.marked },
            ].map((filter) => (
              <button
                key={filter.key}
                onClick={() => setFilterMode(filter.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full whitespace-nowrap transition-all duration-200 active:scale-95 ${filterMode === filter.key ? '' : 'glass-light'}`}
                style={{
                  backgroundColor: filterMode === filter.key ? 'var(--theme-primary)' : undefined,
                  color: filterMode === filter.key ? 'var(--theme-on-primary)' : 'var(--theme-on-surface)',
                }}
              >
                <span className="font-medium">{filter.label}</span>
                <span className="text-xs px-1.5 py-0.5 rounded-full" style={{
                  backgroundColor: filterMode === filter.key ? 'color-mix(in srgb, var(--theme-on-primary) 20%, transparent)' : 'var(--theme-outline-variant)',
                }}>
                  {filter.count}
                </span>
              </button>
            ))}
          </div>

          {/* 新增线路按钮 */}
          <button
            onClick={handleStartCreate}
            className="w-full py-3 px-4 rounded-xl font-medium flex items-center justify-center gap-2 mb-3 transition-all duration-200 active:scale-[0.98]"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--theme-primary) 12%, var(--theme-surface))',
              color: 'var(--theme-primary)',
              border: '1.5px dashed var(--theme-primary)',
              borderRadius: 'var(--theme-radius-xl)',
            }}
          >
            <Plus className="w-5 h-5" />
            新增线路
          </button>

          {/* 线路列表 */}
          <div className="flex-1 overflow-y-auto min-h-0 space-y-2">
            {filteredRoutes.length === 0 ? (
              <div className="text-center py-8" style={{ color: 'var(--theme-on-surface-variant)' }}>
                <Search className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">未找到匹配线路</p>
              </div>
            ) : (
              filteredRoutes.map((route) => (
                <div
                  key={route.id}
                  style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 56px' }}
                >
                  <RouteCard
                    route={route}
                    isSelected={selectedRoute?.id === route.id}
                    onClick={() => handleRouteClick(route)}
                  />
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )

  // ============ 右栏：编辑面板 ============
  const rightPanel = (
    <div className="h-full overflow-y-auto">
      {!selectedCragId ? (
        <div className="flex flex-col items-center justify-center h-full" style={{ color: 'var(--theme-on-surface-variant)' }}>
          <Mountain className="w-16 h-16 mb-4 opacity-30" />
          <p className="text-lg font-medium">选择岩场开始标注</p>
        </div>
      ) : creation.isCreatingRoute ? (
        /* 新增线路表单 */
        <div className="max-w-lg mx-auto space-y-4 animate-fade-in-up">
          <div
            className="flex items-center gap-3 p-4"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--theme-primary) 10%, var(--theme-surface))',
              borderRadius: 'var(--theme-radius-xl)',
              border: '2px solid var(--theme-primary)',
            }}
          >
            <Plus className="w-5 h-5" style={{ color: 'var(--theme-primary)' }} />
            <h2 className="text-lg font-bold" style={{ color: 'var(--theme-on-surface)' }}>新增线路</h2>
          </div>

          <div className="glass-light p-4" style={{ borderRadius: 'var(--theme-radius-xl)' }}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--theme-on-surface-variant)' }}>名称 *</label>
                <Input
                  value={creation.newRoute.name}
                  onChange={(v) => { creation.setNewRoute(prev => ({ ...prev, name: v })); creation.setFormErrors(prev => { const next = {...prev}; delete next.name; return next }) }}
                  placeholder="线路名称"
                  style={creation.formErrors.name ? { borderColor: 'var(--theme-error)' } : undefined}
                />
                {creation.formErrors.name && (
                  <p className="text-xs mt-1" style={{ color: 'var(--theme-error)' }} role="alert">
                    {creation.formErrors.name}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--theme-on-surface-variant)' }}>难度 *</label>
                <select
                  value={creation.newRoute.grade}
                  onChange={(e) => creation.setNewRoute(prev => ({ ...prev, grade: e.target.value }))}
                >
                  {GRADE_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--theme-on-surface-variant)' }}>区域 *</label>
                <AreaSelect
                  areas={areas}
                  value={creation.newRoute.area}
                  onChange={(area) => { creation.setNewRoute(prev => ({ ...prev, area })); creation.setFormErrors(prev => { const next = {...prev}; delete next.area; return next }) }}
                  placeholder="选择区域..."
                  required
                  error={creation.formErrors.area}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--theme-on-surface-variant)' }}>首攀者 (FA)</label>
                <Input
                  value={creation.newRoute.FA}
                  onChange={(v) => creation.setNewRoute(prev => ({ ...prev, FA: v }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--theme-on-surface-variant)' }}>定线者</label>
                <Input
                  value={creation.newRoute.setter}
                  onChange={(v) => creation.setNewRoute(prev => ({ ...prev, setter: v }))}
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--theme-on-surface-variant)' }}>描述</label>
                <Textarea
                  value={creation.newRoute.description}
                  onChange={(v) => creation.setNewRoute(prev => ({ ...prev, description: v }))}
                  rows={3}
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleCancelCreate}
              className="flex-1 py-3 px-4 rounded-xl font-medium transition-all duration-200 active:scale-[0.98] glass-light"
              style={{ color: 'var(--theme-on-surface)' }}
            >
              取消
            </button>
            <button
              onClick={handleSubmitCreate}
              disabled={creation.isSubmittingCreate}
              className="flex-1 py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.98]"
              style={{
                backgroundColor: 'var(--theme-primary)',
                color: 'var(--theme-on-primary)',
                opacity: creation.isSubmittingCreate ? 0.6 : 1,
              }}
            >
              {creation.isSubmittingCreate ? (
                <><div className="w-5 h-5 animate-spin"><Loader2 className="w-full h-full" /></div> 创建中...</>
              ) : (
                <><Plus className="w-5 h-5" /> 创建线路</>
              )}
            </button>
          </div>
        </div>
      ) : !selectedRoute ? (
        <div className="flex flex-col items-center justify-center h-full" style={{ color: 'var(--theme-on-surface-variant)' }}>
          <Edit3 className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-lg font-medium mb-1">选择线路开始标注</p>
          <p className="text-sm">从左侧列表选择要标注的线路</p>
        </div>
      ) : (
        /* 线路编辑面板 */
        <div className="space-y-4 animate-fade-in-up">
          {/* 线路标题 */}
          <div
            className="flex items-center gap-3 p-4"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--theme-primary) 10%, var(--theme-surface))',
              borderRadius: 'var(--theme-radius-xl)',
              border: `2px solid ${editor.routeColor}`,
            }}
          >
            <Sparkles className="w-5 h-5" style={{ color: editor.routeColor }} />
            <div className="flex-1">
              <h2 className="text-lg font-bold" style={{ color: 'var(--theme-on-surface)' }}>
                {selectedRoute.name}
              </h2>
              <p className="text-sm" style={{ color: 'var(--theme-on-surface-variant)' }}>
                {selectedRoute.area} · {selectedRoute.grade}
              </p>
            </div>
            <div className="px-3 py-1.5 rounded-full text-sm font-bold text-white" style={{ backgroundColor: editor.routeColor }}>
              {selectedRoute.grade}
            </div>
          </div>

          {/* Tab 切换栏 */}
          <div className="flex glass-light rounded-xl p-1 gap-1">
            {(['topo', 'beta'] as const).map(tab => {
              const label = tab === 'topo'
                ? 'Topo 标注'
                : `Beta 视频${selectedRoute.betaLinks?.length ? ` (${selectedRoute.betaLinks.length})` : ''}`
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all duration-200 active:scale-[0.98]"
                  style={{
                    backgroundColor: activeTab === tab ? 'var(--theme-primary)' : undefined,
                    color: activeTab === tab ? 'var(--theme-on-primary)' : 'var(--theme-on-surface-variant)',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>

          {activeTab === 'topo' && (
            <>
              {/* 多图标注 Tab 栏：有标注时显示 */}
              {!showInlineUpload && editor.annotations.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                  {editor.annotations.map((annotation, index) => (
                    <div
                      key={`${annotation.faceId}-${index}`}
                      className="relative flex items-center gap-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap"
                      style={
                        index === editor.activeAnnotationIndex
                          ? { backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' }
                          : { backgroundColor: 'var(--theme-surface-variant)', color: 'var(--theme-on-surface-variant)' }
                      }
                    >
                      <button
                        className="px-2.5 py-1 rounded-l-full"
                        onClick={() => { editor.setActiveAnnotationIndex(index); setShowFaceSelector(false) }}
                      >
                        角度{index + 1}
                      </button>
                      <button
                        className="pr-2 py-1 rounded-r-full opacity-60 hover:opacity-100 leading-none"
                        onClick={() => editor.removeAnnotation(index)}
                        aria-label={`删除标注${index + 1}`}
                      >×</button>
                    </div>
                  ))}
                  <button
                    onClick={() => setShowFaceSelector(prev => !prev)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors"
                    style={{ border: '1px dashed var(--theme-outline)', color: 'var(--theme-on-surface-variant)' }}
                  >
                    <Plus className="w-3 h-3" />
                    添加标注
                  </button>
                </div>
              )}

              {/* 岩面选择器（有岩面时）/ 内嵌上传（无岩面时）*/}
              {showInlineUpload ? (
                <InlineFaceUpload
                  cragId={selectedCragId!}
                  area={selectedRoute.area}
                  onUploadSuccess={(newFaceId) => {
                    setR2Faces(prev => [...prev, { faceId: newFaceId, area: selectedRoute.area }])
                    editor.addAnnotation(newFaceId, selectedRoute.area)
                    editor.handleOpenFullscreen()
                  }}
                />
              ) : (
                <>
                  {/* 岩面选择器：首次无标注时始终可见；添加新标注时通过 showFaceSelector 控制 */}
                  {(editor.annotations.length === 0 || showFaceSelector) && (
                    <div className="glass-light p-4" style={{ borderRadius: 'var(--theme-radius-xl)' }}>
                      <label className="block text-xs font-medium mb-2" style={{ color: 'var(--theme-on-surface-variant)' }}>
                        {editor.annotations.length === 0 ? '选择岩面' : '选择新角度岩面'}
                      </label>
                      <FaceSelector
                        faceGroups={areaFaceGroups}
                        selectedFaceId={editor.selectedFaceId}
                        isLoading={isLoadingFaces}
                        onSelect={(faceId, area) => {
                          editor.addAnnotation(faceId, area)
                          setShowFaceSelector(false)
                        }}
                      />
                    </div>
                  )}

                  <TopoPreview
                    imageUrl={editor.imageUrl}
                    imageLoadError={editor.imageLoadError}
                    isImageLoading={editor.isImageLoading}
                    imageAspectRatio={editor.imageAspectRatio}
                    topoLine={editor.topoLine}
                    routeColor={editor.routeColor}
                    scaledPoints={editor.scaledPoints}
                    pathData={editor.pathData}
                    vb={editor.vb}
                    sameFaceRoutes={sameFaceRoutes}
                    showOtherRoutes={editor.showOtherRoutes}
                    onToggleOtherRoutes={() => editor.setShowOtherRoutes(prev => !prev)}
                    onOpenFullscreen={editor.handleOpenFullscreen}
                    onRouteClick={handleRouteClickFromTopo}
                    onImageLoad={editor.handleImageLoad}
                    onImageError={editor.handleImageError}
                    MultiTopoLineOverlay={MultiTopoLineOverlay}
                  />
                </>
              )}

              {/* 线路信息编辑 */}
              <div className="glass-light p-4" style={{ borderRadius: 'var(--theme-radius-xl)' }}>
                <h3 className="font-semibold mb-4" style={{ color: 'var(--theme-on-surface)' }}>线路信息</h3>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--theme-on-surface-variant)' }}>名称 *</label>
                    <Input
                      value={editor.editedRoute.name || ''}
                      onChange={(v) => { editor.setEditedRoute((prev) => ({ ...prev, name: v })); editor.setFormErrors(prev => { const next = {...prev}; delete next.name; return next }) }}
                      style={editor.formErrors.name ? { borderColor: 'var(--theme-error)' } : undefined}
                    />
                    {editor.formErrors.name && (
                      <p className="text-xs mt-1" style={{ color: 'var(--theme-error)' }} role="alert">
                        {editor.formErrors.name}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--theme-on-surface-variant)' }}>难度</label>
                    <select
                      value={editor.editedRoute.grade || ''}
                      onChange={(e) => editor.setEditedRoute((prev) => ({ ...prev, grade: e.target.value }))}
                    >
                      {GRADE_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--theme-on-surface-variant)' }}>区域</label>
                    <AreaSelect
                      areas={areas}
                      value={editor.editedRoute?.area || ''}
                      onChange={(area) => { editor.setEditedRoute(prev => prev ? { ...prev, area } : prev); editor.setFormErrors(prev => { const next = {...prev}; delete next.area; return next }) }}
                      placeholder="选择区域..."
                      required
                      error={editor.formErrors.area}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--theme-on-surface-variant)' }}>首攀者 (FA)</label>
                    <Input
                      value={editor.editedRoute.FA || ''}
                      onChange={(v) => editor.setEditedRoute((prev) => ({ ...prev, FA: v }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--theme-on-surface-variant)' }}>定线者</label>
                    <Input
                      value={editor.editedRoute.setter || ''}
                      onChange={(v) => editor.setEditedRoute((prev) => ({ ...prev, setter: v }))}
                    />
                  </div>
                  <div className="col-span-2 lg:col-span-3">
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--theme-on-surface-variant)' }}>描述</label>
                    <Textarea
                      value={editor.editedRoute.description || ''}
                      onChange={(v) => editor.setEditedRoute((prev) => ({ ...prev, description: v }))}
                      rows={3}
                    />
                  </div>
                </div>
              </div>

              {/* 保存按钮 */}
              <button
                className="w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.98]"
                style={{
                  backgroundColor: editor.saveSuccess ? 'var(--theme-success)' : 'var(--theme-primary)',
                  color: editor.saveSuccess ? 'white' : 'var(--theme-on-primary)',
                  boxShadow: `0 4px 16px ${editor.saveSuccess ? 'var(--theme-success)' : 'var(--theme-primary)'}40`,
                  opacity: editor.isSaving ? 0.8 : 1,
                }}
                onClick={editor.handleSave}
                disabled={editor.isSaving}
              >
                {editor.isSaving ? (
                  <><div className="w-5 h-5 animate-spin"><Loader2 className="w-full h-full" /></div> 保存中...</>
                ) : editor.saveSuccess ? (
                  <><Check className="w-5 h-5" /> 保存成功</>
                ) : (
                  <><Save className="w-5 h-5" /> 保存更改</>
                )}
              </button>

              {editor.saveError && (
                <div className="p-3 rounded-xl flex items-center gap-2 animate-fade-in-up" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-error) 12%, var(--theme-surface))', color: 'var(--theme-error)' }}>
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <span className="text-sm">{editor.saveError}</span>
                </div>
              )}

              {/* 删除线路按钮 */}
              <button
                className="w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.98]"
                style={{
                  color: 'var(--theme-error)',
                  backgroundColor: 'color-mix(in srgb, var(--theme-error) 8%, transparent)',
                }}
                onClick={() => editor.setShowDeleteConfirm(true)}
              >
                <Trash2 className="w-4 h-4" />
                删除线路
              </button>
            </>
          )}

          {activeTab === 'beta' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold" style={{ color: 'var(--theme-on-surface)' }}>
                  Beta 视频 ({selectedRoute.betaLinks?.length || 0})
                </h3>
                <button
                  onClick={() => setShowBetaSubmitDrawer(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200 active:scale-95"
                  style={{
                    backgroundColor: 'var(--theme-primary)',
                    color: 'var(--theme-on-primary)',
                  }}
                >
                  <Plus className="w-4 h-4" />
                  添加 Beta
                </button>
              </div>

              {(!selectedRoute.betaLinks || selectedRoute.betaLinks.length === 0) ? (
                <div
                  className="text-center py-8 glass-light"
                  style={{
                    borderRadius: 'var(--theme-radius-xl)',
                    color: 'var(--theme-on-surface-variant)',
                  }}
                >
                  <Play className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">暂无 Beta 视频</p>
                  <button
                    onClick={() => setShowBetaSubmitDrawer(true)}
                    className="text-sm font-medium mt-2 inline-block"
                    style={{ color: 'var(--theme-primary)' }}
                  >
                    添加第一个 Beta →
                  </button>
                </div>
              ) : (
                selectedRoute.betaLinks.map((beta) => (
                  <BetaCard
                    key={beta.id}
                    beta={beta}
                    isEditing={editingBetaId === beta.id}
                    editForm={editForm}
                    setEditForm={setEditForm}
                    onStartEdit={() => handleStartBetaEdit(beta)}
                    onCancelEdit={handleCancelBetaEdit}
                    onSave={() => handleSaveBeta(beta.id, selectedRoute)}
                    onDelete={() => handleDeleteBeta(beta.id, selectedRoute)}
                    isSaving={isBetaSaving}
                    isDeleting={deletingBetaId === beta.id}
                  />
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )

  // ============ 渲染 ============
  return (
    <div className="min-h-screen pb-20 lg:pb-0" style={{ backgroundColor: 'var(--theme-surface)' }}>
      <EditorPageHeader
        title="线路标注"
        icon={<Edit3 className="w-5 h-5" style={{ color: 'var(--theme-primary)' }} />}
        isDetailMode={showEditorPanel}
        onBackToList={() => {
          if (creation.isCreatingRoute) {
            handleCancelCreate()
            return
          }
          dirtyGuard.guardAction({ type: 'goBackMobile' })
        }}
        listLabel="线路列表"
      />

      <div className="max-w-4xl lg:max-w-none mx-auto px-4 lg:px-6 py-4">
        <div className="hidden lg:flex lg:gap-6 lg:h-[calc(100vh-73px)]">
          <div className="w-[380px] flex-shrink-0 flex flex-col overflow-hidden">
            {leftPanel}
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {rightPanel}
          </div>
        </div>

        <div className="lg:hidden">
          {!showEditorPanel ? (
            leftPanel
          ) : (
            <div className="space-y-4 animate-fade-in-up">
              {rightPanel}
            </div>
          )}
        </div>
      </div>

      {/* 全屏编辑 */}
      {editor.isFullscreenEdit && editor.imageUrl && (
        <FullscreenTopoEditor
          imageUrl={editor.imageUrl}
          imageAspectRatio={editor.imageAspectRatio}
          topoLine={editor.topoLine}
          routeColor={editor.routeColor}
          tension={editor.topoTension}
          otherRoutes={sameFaceRoutes}
          onAddPoint={(point) => editor.setTopoLine([...editor.topoLine, point])}
          onRemoveLastPoint={editor.handleRemoveLastPoint}
          onClearPoints={editor.handleClearPoints}
          onTensionChange={editor.setTopoTension}
          onClose={editor.handleFullscreenClose}
        />
      )}

      {/* 未保存更改确认对话框 */}
      <ConfirmDialog
        isOpen={dirtyGuard.showUnsavedDialog}
        title="有未保存的修改"
        description="当前线路的修改尚未保存，切换后将丢失这些更改。"
        confirmLabel={dirtyGuard.isSavingForGuard ? '保存中...' : '保存并切换'}
        cancelLabel="丢弃"
        variant="warning"
        isLoading={dirtyGuard.isSavingForGuard}
        onConfirm={dirtyGuard.handleSaveAndProceed}
        onCancel={dirtyGuard.handleDiscard}
      />

      {/* 删除确认对话框 */}
      <ConfirmDialog
        isOpen={editor.showDeleteConfirm && !!selectedRoute}
        title="删除线路"
        description={`确定要删除线路「${selectedRoute?.name}」(${selectedRoute?.grade}) 吗？`}
        confirmLabel="确认删除"
        variant="danger"
        isLoading={editor.isDeleting}
        icon={
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'color-mix(in srgb, var(--theme-error) 15%, var(--theme-surface))' }}
          >
            <Trash2 className="w-6 h-6" style={{ color: 'var(--theme-error)' }} />
          </div>
        }
        onConfirm={handleDeleteRoute}
        onCancel={() => editor.setShowDeleteConfirm(false)}
      >
        <div
          className="p-3 mb-5 rounded-lg text-xs"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--theme-error) 8%, var(--theme-surface))',
            color: 'var(--theme-on-surface-variant)',
          }}
        >
          删除后，该线路的 Topo 标注和 Beta 视频链接将一并移除，此操作不可撤销。
        </div>
      </ConfirmDialog>

      {/* Beta 提交抽屉 */}
      {selectedRoute && (
        <BetaSubmitDrawer
          isOpen={showBetaSubmitDrawer}
          onClose={() => setShowBetaSubmitDrawer(false)}
          routeId={selectedRoute.id}
          routeName={selectedRoute.name}
          onSuccess={handleBetaSubmitSuccess}
        />
      )}
    </div>
  )
}
