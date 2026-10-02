'use client'

import { useMemo, useCallback, useState, useTransition, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { FILTER_PARAMS, getGradesByValues, DEFAULT_SORT_DIRECTION, type SortDirection } from '@/lib/filter-constants'
import { compareGrades } from '@/lib/grade-utils'
import { getSiblingRoutes } from '@/lib/route-utils'
import { matchRouteByQuery } from '@/hooks/use-route-search'
import { GradeRangeSelectorVertical } from '@/components/grade-range-selector-vertical'
import { RouteFilterBar } from '@/components/route-filter-bar'
import { FloatingSearchInput } from '@/components/floating-search-input'
import { RouteDetailDrawer } from '@/components/route-detail-drawer'
import { RouteListItem } from '@/components/route-list-item'
import { AppTabbar } from '@/components/app-tabbar'
import type { Route, Crag } from '@/types'
import { collectRouteFaces, matchesRouteFace, matchesRouteFaceArea } from '@/lib/route-face-filter'
import { getFaceIdentityKey } from '@bloctop/shared/face-references'
import { useOnlineCragContent } from '@/hooks/use-online-crag-content'

const MAX_ANIMATED_CARDS = 10

interface RouteListClientProps {
  routes: Route[]
  crags: Crag[]
  contextCityId?: string
}

export default function RouteListClient({ routes: initialRoutes, crags: initialCrags, contextCityId }: RouteListClientProps) {
  const t = useTranslations('RouteList')
  const tCommon = useTranslations('Common')
  const tSearch = useTranslations('Search')
  const router = useRouter()
  const searchParams = useSearchParams()
  const createFilterParams = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (contextCityId) params.set('city', contextCityId)
    return params
  }, [searchParams, contextCityId])
  const [isPending, startTransition] = useTransition()

  // 抽屉状态
  const [routeSelection, setRouteSelection] = useState<Route | null>(null)
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState(false)

  // 入场动画控制
  const [hasInitialRender, setHasInitialRender] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setHasInitialRender(true), 500)
    return () => clearTimeout(timer)
  }, [])

  // 从 URL 读取筛选状态（城市过滤已在服务端完成，客户端不再处理）
  const selectedCrag = searchParams.get(FILTER_PARAMS.CRAG) || ''
  const seed = useMemo(() => {
    const crag = initialCrags.find(item => item.id === selectedCrag)
    return crag ? { crag, routes: initialRoutes.filter(route => route.cragId === selectedCrag) } : null
  }, [initialCrags, initialRoutes, selectedCrag])
  const readingContent = useOnlineCragContent(selectedCrag || undefined, seed)
  const routes = useMemo(() => readingContent
    ? [...initialRoutes.filter(route => route.cragId !== readingContent.crag.id), ...readingContent.routes]
    : initialRoutes, [initialRoutes, readingContent])
  const crags = useMemo(() => readingContent
    ? initialCrags.map(crag => crag.id === readingContent.crag.id ? readingContent.crag : crag)
    : initialCrags, [initialCrags, readingContent])
  // Restore by identity, including new RSC props; never retain a clicked stale object.
  const selectedRoute = routeSelection
    ? routes.find(route => route.id === routeSelection.id && route.cragId === routeSelection.cragId) ?? null
    : null
  const selectedArea = searchParams.get(FILTER_PARAMS.AREA) || null
  const gradeParam = searchParams.get(FILTER_PARAMS.GRADE)
  const selectedGrades = useMemo(
    () => (gradeParam ? gradeParam.split(',') : []),
    [gradeParam]
  )
  const searchQuery = searchParams.get(FILTER_PARAMS.QUERY) || ''
  const sortDirection = (searchParams.get(FILTER_PARAMS.SORT) as SortDirection) || DEFAULT_SORT_DIRECTION
  const selectedFace = searchParams.get(FILTER_PARAMS.FACE) || null
  const faces = useMemo(() => collectRouteFaces(routes, selectedCrag), [routes, selectedCrag])

  // 计算当前路线池中实际存在的难度等级
  const availableGrades = useMemo(() => {
    const pool = selectedCrag
      ? routes.filter((r) => r.cragId === selectedCrag)
      : routes
    const gradeSet = new Set(pool.map((r) => r.grade))
    // 按难度排序，"？"放最后
    return [...gradeSet].sort((a, b) => {
      if (a === '？') return 1
      if (b === '？') return -1
      return compareGrades(a, b)
    })
  }, [routes, selectedCrag])

  // 切换岩场时，清除不在新岩场中的已选难度
  useEffect(() => {
    if (selectedGrades.length === 0) return
    const validGrades = selectedGrades.filter((g) => availableGrades.includes(g))
    if (validGrades.length !== selectedGrades.length) {
      updateSearchParams(FILTER_PARAMS.GRADE, validGrades.length > 0 ? validGrades : null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 availableGrades 变化时检查
  }, [availableGrades])

  // 更新 URL 参数
  const updateSearchParams = useCallback(
    (key: string, value: string | string[] | null) => {
      const params = createFilterParams()

      if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
        params.delete(key)
      } else if (Array.isArray(value)) {
        params.set(key, value.join(','))
      } else {
        params.set(key, value)
      }

      const queryString = params.toString()
      const newUrl = queryString ? `/route?${queryString}` : '/route'

      startTransition(() => {
        router.replace(newUrl, { scroll: false })
      })
    },
    [router, createFilterParams, startTransition]
  )

  // 处理岩场筛选（单选）— 切换岩场时清除 face 筛选
  // 点击"全部"时重置所有 filter（岩场、岩面、难度、搜索）
  const handleCragSelect = useCallback(
    (cragId: string) => {
      const newCrag = cragId === selectedCrag ? null : cragId
      const params = createFilterParams()

      if (newCrag) {
        params.set(FILTER_PARAMS.CRAG, newCrag)
      } else {
        // "全部" — 清除所有筛选条件
        params.delete(FILTER_PARAMS.CRAG)
        params.delete(FILTER_PARAMS.GRADE)
        params.delete(FILTER_PARAMS.QUERY)
      }
      params.delete(FILTER_PARAMS.AREA)
      params.delete(FILTER_PARAMS.FACE)

      const queryString = params.toString()
      const newUrl = queryString ? `/route?${queryString}` : '/route'
      startTransition(() => {
        router.replace(newUrl, { scroll: false })
      })
    },
    [selectedCrag, createFilterParams, router, startTransition]
  )

  // 处理区域筛选
  const handleAreaChange = useCallback(
    (area: string | null) => {
      const params = createFilterParams()
      if (area) params.set(FILTER_PARAMS.AREA, area)
      else params.delete(FILTER_PARAMS.AREA)
      params.delete(FILTER_PARAMS.FACE)
      startTransition(() => router.replace(`/route${params.size ? `?${params}` : ''}`, { scroll: false }))
    },
    [createFilterParams, router, startTransition]
  )

  // 处理岩面筛选
  const handleFaceSelect = useCallback(
    (faceId: string | null) => {
      updateSearchParams(FILTER_PARAMS.FACE, faceId)
    },
    [updateSearchParams]
  )

  // 处理搜索
  const handleSearchChange = useCallback(
    (query: string) => {
      updateSearchParams(FILTER_PARAMS.QUERY, query || null)
    },
    [updateSearchParams]
  )

  // 切换排序方向
  const toggleSortDirection = useCallback(() => {
    const newDirection: SortDirection = sortDirection === 'asc' ? 'desc' : 'asc'
    updateSearchParams(FILTER_PARAMS.SORT, newDirection)
  }, [sortDirection, updateSearchParams])

  // 是否有任何 filter 激活（用于 0 结果提示）
  const hasActiveFilters = selectedCrag !== '' || selectedArea !== null || selectedGrades.length > 0 || searchQuery !== '' || selectedFace !== null

  // 清除所有筛选
  const handleClearAllFilters = useCallback(() => {
    const params = createFilterParams()
    params.delete(FILTER_PARAMS.CRAG)
    params.delete(FILTER_PARAMS.AREA)
    params.delete(FILTER_PARAMS.FACE)
    params.delete(FILTER_PARAMS.GRADE)
    params.delete(FILTER_PARAMS.QUERY)
    const queryString = params.toString()
    startTransition(() => {
      router.replace(queryString ? `/route?${queryString}` : '/route', { scroll: false })
    })
  }, [createFilterParams, router, startTransition])

  // 处理线路卡片点击
  const handleRouteClick = useCallback((route: Route) => {
    setRouteSelection(route)
    setIsDetailDrawerOpen(true)
  }, [])

  // 获取选中线路对应的岩场（从全量 crags 查找，因为详情抽屉不受城市过滤影响）
  const selectedCragData = useMemo(() => {
    if (!selectedRoute) return null
    return crags.find((c) => c.id === selectedRoute.cragId) || null
  }, [selectedRoute, crags])

  // 获取同岩面的线路
  const siblingRoutes = useMemo(() => {
    return getSiblingRoutes(selectedRoute, routes)
  }, [routes, selectedRoute])

  // 处理线路切换
  const handleRouteChange = useCallback((route: Route) => {
    setRouteSelection(route)
  }, [])

  // Active filter tags 列表（❷ filter 汇总提示）
  const activeFilterTags = useMemo(() => {
    const tags: { label: string; onRemove: () => void }[] = []
    if (selectedFace) {
      const face = faces.find(item => getFaceIdentityKey(item) === selectedFace || item.faceId === selectedFace)
      tags.push({
        label: face ? `${face.area} · ${face.faceId}` : selectedFace,
        onRemove: () => updateSearchParams(FILTER_PARAMS.FACE, null),
      })
    }
    if (selectedGrades.length > 0) {
      // 显示难度范围：≤3 个列出全部，>3 个显示首尾范围如 "V2–V7"
      const sorted = [...selectedGrades].sort((a, b) => compareGrades(a, b))
      const label = selectedGrades.length <= 3
        ? sorted.join(', ')
        : `${sorted[0]}–${sorted[sorted.length - 1]}`
      tags.push({
        label,
        onRemove: () => updateSearchParams(FILTER_PARAMS.GRADE, null),
      })
    }
    if (searchQuery) {
      tags.push({
        label: `"${searchQuery}"`,
        onRemove: () => updateSearchParams(FILTER_PARAMS.QUERY, null),
      })
    }
    return tags
  }, [selectedFace, faces, selectedGrades, searchQuery, updateSearchParams])

  // 筛选逻辑
  const filteredRoutes = useMemo(() => {
    let result = routes

    if (selectedCrag) {
      result = result.filter((r) => r.cragId === selectedCrag)
    }

    if (selectedArea) {
      result = result.filter((r) => matchesRouteFaceArea(r, selectedArea))
    }

    if (selectedFace) {
      result = result.filter((r) => matchesRouteFace(r, selectedFace))
    }

    if (selectedGrades.length > 0) {
      const allGrades = getGradesByValues(selectedGrades)
      result = result.filter((r) => allGrades.includes(r.grade))
    }

    if (searchQuery.trim()) {
      result = result.filter((r) => matchRouteByQuery(r, searchQuery) !== null)
    }

    result = [...result].sort((a, b) => {
      const comparison = compareGrades(a.grade, b.grade)
      return sortDirection === 'asc' ? comparison : -comparison
    })

    return result
  }, [routes, selectedCrag, selectedArea, selectedFace, selectedGrades, searchQuery, sortDirection])

  return (
    <>
      <div
        className="flex flex-col h-dvh overflow-hidden"
        style={{
          backgroundColor: 'var(--theme-surface)',
          transition: 'var(--theme-transition)',
        }}
      >
        {/* 顶部筛选栏 — 全宽 */}
        <RouteFilterBar
          faces={faces}
          crags={crags}
          selectedCrag={selectedCrag}
          onCragSelect={handleCragSelect}
          selectedArea={selectedArea}
          onAreaChange={handleAreaChange}
          selectedFace={selectedFace}
          onFaceSelect={handleFaceSelect}
          sortDirection={sortDirection}
          onToggleSort={toggleSortDirection}
          activeFilterTags={activeFilterTags}
          allLabel={tCommon('all')}
          totalCountLabel={t('totalCount', { count: filteredRoutes.length })}
          sortAscLabel={t('sortAsc')}
          sortDescLabel={t('sortDesc')}
          sortAscHint={t('sortAscHint')}
          sortDescHint={t('sortDescHint')}
          faceHintLabel={t('faceHint')}
        />

        {/* 中间内容区 — flex row */}
        <div className="flex flex-1 min-h-0">
          {/* 左侧 grade bar */}
          <div
            className="flex-shrink-0 pt-2 pb-36 pl-1.5 pr-1"
            style={{ width: 48 }}
          >
            <GradeRangeSelectorVertical
              availableGrades={availableGrades}
              selectedGrades={selectedGrades}
              onChange={(grades) => updateSearchParams(FILTER_PARAMS.GRADE, grades)}
              className="h-full"
            />
          </div>

          {/* 右侧线路列表 */}
          <main
            className="flex-1 overflow-y-auto px-4 pb-36"
            style={{
              opacity: isPending ? 0.6 : 1,
              transition: 'opacity 150ms ease',
              pointerEvents: isPending ? 'none' : undefined,
            }}
          >
            <div className="space-y-2">
              {filteredRoutes.map((route, index) => (
                <RouteListItem
                  key={route.id}
                  route={route}
                  onClick={handleRouteClick}
                  className={!hasInitialRender && index < MAX_ANIMATED_CARDS ? 'animate-fade-in-up' : ''}
                  style={{
                    backgroundColor: 'var(--theme-surface)',
                    boxShadow: 'var(--theme-shadow-sm)',
                    contentVisibility: 'auto' as React.CSSProperties['contentVisibility'],
                    containIntrinsicSize: '0 72px',
                    ...(!hasInitialRender && index < MAX_ANIMATED_CARDS ? { animationDelay: `${index * 30}ms` } : {}),
                  }}
                />
              ))}
            </div>

            {filteredRoutes.length === 0 && (
              <div className="text-center py-12">
                <p style={{ color: 'var(--theme-on-surface-variant)' }}>
                  {t('noResults')}
                </p>
                {hasActiveFilters && (
                  <button
                    onClick={handleClearAllFilters}
                    className="mt-3 px-4 py-2 text-sm font-medium transition-all active:scale-95"
                    style={{
                      color: 'var(--theme-primary)',
                      backgroundColor: 'color-mix(in srgb, var(--theme-primary) 12%, transparent)',
                      borderRadius: 'var(--theme-radius-full)',
                    }}
                  >
                    {t('clearFilters')}
                  </button>
                )}
              </div>
            )}
          </main>
        </div>
      </div>

      {/* 悬浮搜索框 */}
      <FloatingSearchInput
        value={searchQuery}
        onChange={handleSearchChange}
        placeholder={tSearch('placeholder')}
      />

      {/* 线路详情抽屉 */}
      <RouteDetailDrawer
        isOpen={isDetailDrawerOpen}
        onClose={() => setIsDetailDrawerOpen(false)}
        route={selectedRoute}
        siblingRoutes={siblingRoutes}
        crag={selectedCragData}
        onRouteChange={handleRouteChange}
        readingContent={readingContent?.crag.id === selectedRoute?.cragId ? readingContent : undefined}
      />

      {/* 底部导航栏 */}
      <AppTabbar />
    </>
  )
}
