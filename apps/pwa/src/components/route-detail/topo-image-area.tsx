'use client'

import { useCallback, useRef } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { ImageIcon, X, Eye, EyeOff } from 'lucide-react'

import { TopoLineOverlay, type TopoLineOverlayRef } from '@/components/topo-line-overlay'
import { MultiTopoLineOverlay, type MultiTopoLineOverlayRef } from '@/components/multi-topo-line-overlay'
import { AnnotationSlide } from './annotation-slide'
import type { RouteTopoAnnotation } from '@bloctop/shared/types'
import type { MultiTopoRoute } from '@/components/multi-topo-line-overlay'
import type { Route } from '@/types'

interface TopoImageAreaProps {
  route: Route
  mediaRevision?: string
  routeColor: string
  /** Face image URL from useFaceImage hook */
  topoImageUrl: string | null
  imageLoading: boolean
  imageError: boolean
  handleImageLoad: () => void
  handleImageError: () => void
  /** Aspect ratio state setter (shared with fullscreen viewer) */
  onAspectRatioChange: (ratio: number | undefined) => void
  imageAspectRatio: number | undefined
  /** Overlay mode derived values */
  hasTopoLine: boolean
  hasMultiAnnotations: boolean
  topoAnnotations: RouteTopoAnnotation[]
  validSiblingRoutes: MultiTopoRoute[]
  hasMultiLines: boolean
  showAllOverlay: boolean
  toggleShowAllOverlay: () => void
  useMultiLineMode: boolean
  /** Animation refs */
  drawerOverlayRef: React.RefObject<TopoLineOverlayRef | null>
  multiOverlayRef: React.RefObject<MultiTopoLineOverlayRef | null>
  /** Callbacks */
  onClose: () => void
  onImageViewerOpen: () => void
  onRouteSelect: (routeId: number) => void
  /** Carousel state (shared with fullscreen viewer for sync) */
  activeAnnotationIndex: number
  onActiveAnnotationIndexChange: (index: number) => void
}

export function TopoImageArea({
  route,
  mediaRevision,
  routeColor,
  topoImageUrl,
  imageLoading,
  imageError,
  handleImageLoad,
  handleImageError,
  onAspectRatioChange,
  imageAspectRatio,
  hasTopoLine,
  hasMultiAnnotations,
  topoAnnotations,
  validSiblingRoutes,
  hasMultiLines,
  showAllOverlay,
  toggleShowAllOverlay,
  useMultiLineMode,
  drawerOverlayRef,
  multiOverlayRef,
  onClose,
  onImageViewerOpen,
  onRouteSelect,
  activeAnnotationIndex,
  onActiveAnnotationIndexChange,
}: TopoImageAreaProps) {
  const tCommon = useTranslations('Common')
  const t = useTranslations('RouteDetail')

  const carouselRef = useRef<HTMLDivElement>(null)

  // Smart default: <=3 routes show all by default
  const shouldShowAllByDefault = validSiblingRoutes.length <= 3

  const handleCarouselScroll = useCallback(() => {
    if (!carouselRef.current) return
    const el = carouselRef.current
    const index = Math.round(el.scrollLeft / el.clientWidth)
    onActiveAnnotationIndexChange(index)
  }, [onActiveAnnotationIndexChange])

  const scrollToAnnotation = useCallback((index: number) => {
    if (!carouselRef.current) return
    carouselRef.current.scrollTo({ left: index * carouselRef.current.clientWidth, behavior: 'smooth' })
  }, [])

  return (
    <div
      className="relative w-full mb-4 overflow-hidden"
      style={{
        height: '50vh',
        maxHeight: '400px',
        borderRadius: 'var(--theme-radius-xl)',
        backgroundColor: 'var(--theme-surface-variant)',
      }}
    >
      {hasMultiAnnotations ? (
        /* Multi-annotation carousel mode */
        <>
          <div
            className="flex h-full overflow-x-auto snap-x snap-mandatory scrollbar-hide"
            ref={carouselRef}
            onScroll={handleCarouselScroll}
          >
            {topoAnnotations.map((annotation, index) => (
              <AnnotationSlide
                key={`${annotation.area}/${annotation.faceId}-${index}`}
                annotation={annotation}
                cragId={route.cragId}
                mediaRevision={mediaRevision}
                routeColor={routeColor}
                routeName={route.name}
                onClick={onImageViewerOpen}
              />
            ))}
          </div>
          {/* Page indicator dots */}
          <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 z-10 pointer-events-none">
            {topoAnnotations.map((_, index) => (
              <button
                key={index}
                className={`w-1.5 h-1.5 rounded-full transition-colors pointer-events-auto ${
                  index === activeAnnotationIndex ? 'bg-white' : 'bg-white/40'
                }`}
                onClick={() => scrollToAnnotation(index)}
                aria-label={`切换到角度${index + 1}`}
              />
            ))}
          </div>
          {/* Close button */}
          <button
            className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full flex items-center justify-center bg-black/50 backdrop-blur-sm transition-transform active:scale-95"
            onClick={onClose}
            aria-label={tCommon('close')}
          >
            <X className="w-4.5 h-4.5 text-white" />
          </button>
        </>
      ) : imageError ? (
        /* Image load error */
        <div className="w-full h-full flex flex-col items-center justify-center">
          <ImageIcon
            className="w-12 h-12 mb-2"
            style={{ color: 'var(--theme-on-surface-variant)' }}
          />
          <span
            className="text-sm"
            style={{ color: 'var(--theme-on-surface-variant)' }}
          >
            {t('noTopo')}
          </span>
        </div>
      ) : (
        /* Single image mode */
        <button
          onClick={onImageViewerOpen}
          className="relative w-full h-full group"
          aria-label={t('clickToEnlarge')}
        >
          {imageLoading && (
            <div className="absolute inset-0 skeleton-shimmer" />
          )}
          <Image
            key={topoImageUrl}
            src={topoImageUrl!}
            alt={route.name}
            fill
            className={`object-contain transition-all duration-300 group-active:scale-[0.98] ${
              imageLoading ? 'opacity-0' : 'opacity-100'
            }`}
            sizes="(max-width: 768px) 100vw, 50vw"
            onLoad={(e) => {
              handleImageLoad()
              const img = e.currentTarget as HTMLImageElement
              if (img.naturalWidth && img.naturalHeight) {
                onAspectRatioChange(img.naturalWidth / img.naturalHeight)
              }
            }}
            onError={handleImageError}
          />

          {/* Topo overlay */}
          {hasTopoLine && !imageLoading && (
            useMultiLineMode ? (
              <MultiTopoLineOverlay
                ref={multiOverlayRef}
                routes={validSiblingRoutes}
                selectedRouteId={route.id}
                onRouteSelect={onRouteSelect}
                objectFit="contain"
                aspectRatio={imageAspectRatio}
              />
            ) : (
              <TopoLineOverlay
                ref={drawerOverlayRef}
                points={route.topoLine!}
                color={routeColor}
                tension={route.topoTension}
                animated
                objectFit="contain"
                aspectRatio={imageAspectRatio}
              />
            )
          )}

          {/* Close button */}
          {!imageLoading && (
            <div
              className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full flex items-center justify-center bg-black/50 backdrop-blur-sm transition-transform active:scale-95"
              onClick={(e) => {
                e.stopPropagation()
                onClose()
              }}
              role="button"
              aria-label={tCommon('close')}
            >
              <X className="w-4.5 h-4.5 text-white" />
            </div>
          )}

          {/* Show all / Show current toggle (only for >3 sibling routes) */}
          {!imageLoading && hasMultiLines && !shouldShowAllByDefault && (
            <div
              className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5 px-2.5 py-1.5 backdrop-blur-sm transition-all duration-200 active:scale-95"
              style={{
                borderRadius: 'var(--theme-radius-md)',
                backgroundColor: showAllOverlay
                  ? 'color-mix(in srgb, var(--theme-primary) 60%, rgba(0,0,0,0.3))'
                  : 'rgba(0,0,0,0.5)',
              }}
              onClick={(e) => {
                e.stopPropagation()
                toggleShowAllOverlay()
              }}
              role="button"
            >
              {showAllOverlay ? (
                <EyeOff className="w-3.5 h-3.5 text-white" />
              ) : (
                <Eye className="w-3.5 h-3.5 text-white" />
              )}
              <span className="text-white text-xs font-medium">
                {showAllOverlay ? t('showCurrentOnly') : t('showAllRoutes')}
              </span>
            </div>
          )}

          {/* Zoom hint */}
          {!imageLoading && (
            <div
              className="absolute bottom-3 right-3 flex items-center gap-1 px-2 py-1 bg-black/50 backdrop-blur-sm"
              style={{ borderRadius: 'var(--theme-radius-md)' }}
            >
              <ImageIcon className="w-3.5 h-3.5 text-white" />
              <span className="text-white text-xs">{t('tapToZoom')}</span>
            </div>
          )}
        </button>
      )}
    </div>
  )
}
