'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { ZoomIn } from 'lucide-react'
import { Drawer } from '@/components/ui/drawer'
import { ImageViewer } from '@/components/ui/image-viewer'

const BetaListDrawer = dynamic(() =>
  import('@/components/beta-list-drawer').then(m => ({ default: m.BetaListDrawer })),
  { ssr: false }
)
const BetaSubmitDrawer = dynamic(() =>
  import('@/components/beta-submit-drawer').then(m => ({ default: m.BetaSubmitDrawer })),
  { ssr: false }
)

import { ContextualHint } from '@/components/contextual-hint'
import { TopoLineOverlay } from '@/components/topo-line-overlay'
import { MultiTopoLineOverlay } from '@/components/multi-topo-line-overlay'
import { RouteLegendPanel } from '@/components/route-legend-panel'
import { getGradeColor } from '@/lib/tokens'

import { TopoImageArea, RouteInfoSection, RouteBetaSection } from '@/components/route-detail'
import { useFaceImage, useFaceImageCache } from '@/hooks/use-face-image'
import { useOverlayMode } from '@/hooks/use-overlay-mode'
import { useTopoAnimation } from '@/hooks/use-topo-animation'

import type { Route, Crag, BetaLink } from '@/types'

interface RouteDetailDrawerProps {
  isOpen: boolean
  onClose: () => void
  route: Route | null
  /** 同一岩面的其他线路（用于多线路叠加显示） */
  siblingRoutes?: Route[]
  crag?: Crag | null
  /** 线路切换回调 */
  onRouteChange?: (route: Route) => void
}

export function RouteDetailDrawer({
  isOpen,
  onClose,
  route,
  siblingRoutes,
  crag,
  onRouteChange,
}: RouteDetailDrawerProps) {
  const tIntro = useTranslations('Intro')
  const [imageViewerOpen, setImageViewerOpen] = useState(false)
  const [betaListOpen, setBetaListOpen] = useState(false)
  const [betaSubmitOpen, setBetaSubmitOpen] = useState(false)

  // Face image cache layer
  const {
    src: topoImageUrl,
    isLoading: imageLoading,
    isError: imageError,
    onLoad: handleImageLoad,
    onError: handleImageError,
  } = useFaceImage(route)

  const [imageAspectRatio, setImageAspectRatio] = useState<number | undefined>(undefined)
  const [localBetaLinks, setLocalBetaLinks] = useState<BetaLink[] | null>(null)
  const betaRequestSequence = useRef(0)
  const routeId = route?.id
  const routeBetaLinks = route?.betaLinks
  const [activeAnnotationIndex, setActiveAnnotationIndex] = useState(0)

  // Overlay mode derivation (replaces 5 inline booleans)
  const overlay = useOverlayMode(route, siblingRoutes)

  // Route color
  const routeColor = useMemo(
    () => route ? getGradeColor(route.grade) : '#888888',
    [route]
  )

  // Animation orchestration
  const animation = useTopoAnimation({
    isOpen,
    imageLoading,
    topoLine: route?.topoLine,
    useMultiLineMode: overlay.useMultiLineMode,
    imageViewerOpen,
  })

  // Reset non-image state on route change
  useEffect(() => {
    if (route) {
      betaRequestSequence.current += 1
      setLocalBetaLinks(null)
      animation.resetAnimation()
      setImageAspectRatio(undefined)
      setActiveAnnotationIndex(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on route.id change
  }, [route?.id])

  // 线路页可能来自长时间缓存；打开详情或手动刷新时读取最新 Beta。
  const fetchLatestBetas = useCallback(async (signal?: AbortSignal): Promise<boolean> => {
    if (!routeId) return false
    const requestSequence = ++betaRequestSequence.current
    try {
      const res = await fetch(`/api/beta?routeId=${routeId}&_=${Date.now()}`, {
        cache: 'no-store',
        signal,
      })
      if (!res.ok) return false
      const data = await res.json()
      if (!signal?.aborted && requestSequence === betaRequestSequence.current && data.success && Array.isArray(data.betaLinks)) {
        setLocalBetaLinks(data.betaLinks)
        return true
      }
    } catch (err) {
      if (!signal?.aborted) console.error('[RouteDetailDrawer] Failed to fetch betas:', err)
    }
    return false
  }, [routeId])

  useEffect(() => {
    if (!isOpen || !routeId) return
    const controller = new AbortController()
    void fetchLatestBetas(controller.signal)
    return () => controller.abort()
  }, [isOpen, routeId, fetchLatestBetas])

  const handleBetaSubmitted = useCallback((beta: BetaLink) => {
    // POST 已返回完整记录；直接显示，避免旧 GET 响应覆盖新提交。
    betaRequestSequence.current += 1
    setLocalBetaLinks(current => {
      const links = current ?? routeBetaLinks ?? []
      return links.some(link => link.id === beta.id) ? links : [...links, beta]
    })
  }, [routeBetaLinks])

  // Route selection handler
  const handleRouteSelect = useCallback((routeId: number) => {
    const newRoute = siblingRoutes?.find(r => r.id === routeId)
    if (newRoute && onRouteChange) {
      onRouteChange(newRoute)
    }
  }, [siblingRoutes, onRouteChange])

  // Multi-annotation image viewer URL helper
  const faceImageCache = useFaceImageCache()

  if (!route) return null

  const betaLinks = localBetaLinks ?? route.betaLinks ?? []

  return (
    <>
      <Drawer isOpen={isOpen} onClose={onClose} height="full" showHandle>
        <div className="px-4 pb-4">
          {/* Topo image area (3 modes: carousel / error / single) */}
          <TopoImageArea
            route={route}
            routeColor={routeColor}
            topoImageUrl={topoImageUrl}
            imageLoading={imageLoading}
            imageError={imageError}
            handleImageLoad={handleImageLoad}
            handleImageError={handleImageError}
            onAspectRatioChange={setImageAspectRatio}
            imageAspectRatio={imageAspectRatio}
            hasTopoLine={overlay.hasTopoLine}
            hasMultiAnnotations={overlay.hasMultiAnnotations}
            topoAnnotations={overlay.topoAnnotations}
            validSiblingRoutes={overlay.validSiblingRoutes}
            hasMultiLines={overlay.hasMultiLines}
            showAllOverlay={overlay.showAllOverlay}
            toggleShowAllOverlay={overlay.toggleShowAllOverlay}
            useMultiLineMode={overlay.useMultiLineMode}
            drawerOverlayRef={animation.drawerOverlayRef}
            multiOverlayRef={animation.multiOverlayRef}
            onClose={onClose}
            onImageViewerOpen={() => setImageViewerOpen(true)}
            onRouteSelect={handleRouteSelect}
            activeAnnotationIndex={activeAnnotationIndex}
            onActiveAnnotationIndexChange={setActiveAnnotationIndex}
          />

          {/* Route legend panel (multi-line mode) */}
          {overlay.hasMultiLines && (
            <RouteLegendPanel
              routes={overlay.validSiblingRoutes}
              selectedRouteId={route.id}
              onRouteSelect={handleRouteSelect}
            />
          )}

          {/* Route info (grade, name, FA, setter, description) */}
          <RouteInfoSection route={route} crag={crag} />

          {/* Beta videos */}
          <RouteBetaSection
            betaLinks={betaLinks}
            onOpenBetaList={() => setBetaListOpen(true)}
          />
        </div>
      </Drawer>

      {/* Fullscreen image viewer */}
      {(overlay.hasMultiAnnotations || !imageError) && (
        <ImageViewer
          isOpen={imageViewerOpen}
          onClose={() => setImageViewerOpen(false)}
          src={
            overlay.hasMultiAnnotations
              ? faceImageCache.getImageUrl({
                  cragId: route.cragId,
                  area: overlay.topoAnnotations[activeAnnotationIndex]?.area ?? '',
                  faceId: overlay.topoAnnotations[activeAnnotationIndex]?.faceId ?? '',
                })
              : topoImageUrl!
          }
          alt={route.name}
          images={overlay.hasMultiAnnotations ? overlay.topoAnnotations.map(a =>
            faceImageCache.getImageUrl({ cragId: route.cragId, area: a.area, faceId: a.faceId })
          ) : undefined}
          activeImageIndex={overlay.hasMultiAnnotations ? activeAnnotationIndex : undefined}
          onImageChange={overlay.hasMultiAnnotations ? (index) => {
            setActiveAnnotationIndex(index)
          } : undefined}
          topSlot={
            <div className="absolute top-12 left-4 right-4 z-10 flex items-start justify-between">
              <ContextualHint
                hintKey="topo-pinch-zoom"
                message={tIntro('hintPinchZoom')}
                icon={<ZoomIn className="w-3.5 h-3.5" />}
              />
            </div>
          }
        >
          {/* Topo overlay in fullscreen */}
          {overlay.hasMultiAnnotations ? (
            (overlay.topoAnnotations[activeAnnotationIndex]?.topoLine?.length ?? 0) >= 2 && (
              <TopoLineOverlay
                points={overlay.topoAnnotations[activeAnnotationIndex].topoLine}
                color={routeColor}
                tension={overlay.topoAnnotations[activeAnnotationIndex].topoTension}
                objectFit="contain"
                aspectRatio={imageAspectRatio}
              />
            )
          ) : overlay.hasTopoLine ? (
            overlay.useMultiLineMode ? (
              <MultiTopoLineOverlay
                ref={animation.multiFullscreenOverlayRef}
                routes={overlay.validSiblingRoutes}
                selectedRouteId={route.id}
                onRouteSelect={handleRouteSelect}
                objectFit="contain"
                aspectRatio={imageAspectRatio}
              />
            ) : (
              <TopoLineOverlay
                ref={animation.fullscreenOverlayRef}
                points={route.topoLine!}
                color={routeColor}
                tension={route.topoTension}
                animated
                objectFit="contain"
                aspectRatio={imageAspectRatio}
              />
            )
          ) : null}
        </ImageViewer>
      )}

      {/* Beta drawers */}
      <BetaListDrawer
        isOpen={betaListOpen}
        onClose={() => setBetaListOpen(false)}
        betaLinks={betaLinks}
        routeName={route.name}
        routeId={route.id}
        onRefresh={fetchLatestBetas}
        onAddBeta={() => {
          setBetaListOpen(false)
          setBetaSubmitOpen(true)
        }}
      />

      <BetaSubmitDrawer
        isOpen={betaSubmitOpen}
        onClose={() => setBetaSubmitOpen(false)}
        routeId={route.id}
        routeName={route.name}
        onSuccess={handleBetaSubmitted}
      />
    </>
  )
}
