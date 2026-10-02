'use client'

import { useRef, useCallback, useEffect, useState, useLayoutEffect } from 'react'
import Image from 'next/image'
import { X, ZoomIn, ZoomOut, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  TransformWrapper,
  TransformComponent,
  useControls,
  useTransformComponent,
  ReactZoomPanPinchRef,
} from 'react-zoom-pan-pinch'

interface ImageViewerProps {
  isOpen: boolean
  onClose: () => void
  src: string
  alt?: string
  /** 可选的叠加层内容（如 Topo 线路 SVG），会随图片一起缩放 */
  children?: React.ReactNode
  /** 固定在顶部的内容（不随缩放移动，如提示条） */
  topSlot?: React.ReactNode
  /** 多图模式：所有图片 URL（传入时显示左右导航箭头） */
  images?: string[]
  /** 多图模式：当前激活图片 index */
  activeImageIndex?: number
  /** 多图模式：切换图片回调 */
  onImageChange?: (index: number) => void
}

// 底部控制栏组件（缩放 + 关闭）
function BottomControls({ onClose }: { onClose: () => void }) {
  const { zoomIn, zoomOut, resetTransform } = useControls()
  const scale = useTransformComponent((ctx) => ctx.state.scale)

  return (
    <div
      className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation()
          zoomOut()
        }}
        className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/20"
        disabled={scale <= 1}
        aria-label="缩小"
      >
        <ZoomOut className={`w-5 h-5 ${scale <= 1 ? 'text-white/40' : 'text-white'}`} />
      </button>
      <span className="text-white text-sm font-medium min-w-[3rem] text-center">
        {Math.round(scale * 100)}%
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          zoomIn()
        }}
        className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/20"
        disabled={scale >= 4}
        aria-label="放大"
      >
        <ZoomIn className={`w-5 h-5 ${scale >= 4 ? 'text-white/40' : 'text-white'}`} />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation()
          resetTransform()
        }}
        className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/20"
        disabled={scale === 1}
        aria-label="重置"
      >
        <RotateCcw className={`w-4 h-4 ${scale === 1 ? 'text-white/40' : 'text-white'}`} />
      </button>
      {/* 分隔线 */}
      <div className="w-px h-5 bg-white/20" />
      {/* 关闭按钮 */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/20"
        aria-label="关闭"
      >
        <X className="w-5 h-5 text-white" />
      </button>
    </div>
  )
}

export function ImageViewer({ isOpen, onClose, src, alt = '', children, topSlot, images, activeImageIndex, onImageChange }: ImageViewerProps) {
  const effectiveSrc = images ? (images[activeImageIndex ?? 0] ?? src) : src
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const currentSrc = useRef(effectiveSrc)
  useLayoutEffect(() => { currentSrc.current = effectiveSrc }, [effectiveSrc])
  const effectiveIndex = activeImageIndex ?? 0
  const canGoPrev = !!images && images.length > 1 && effectiveIndex > 0
  const canGoNext = !!images && images.length > 1 && effectiveIndex < images.length - 1
  const transformRef = useRef<ReactZoomPanPinchRef>(null)
  const startYRef = useRef<number>(0)
  const scaleRef = useRef<number>(1)

  // 锁定 body 滚动
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = originalOverflow
      }
    }
  }, [isOpen])

  // ESC 键关闭 / 左右方向键切换图片（多图模式）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowLeft' && canGoPrev) {
        onImageChange?.(effectiveIndex - 1)
      } else if (e.key === 'ArrowRight' && canGoNext) {
        onImageChange?.(effectiveIndex + 1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, canGoPrev, canGoNext, effectiveIndex, onImageChange])

  // 重置状态（打开时 或 切换图片时）
  useEffect(() => {
    if (isOpen && transformRef.current) {
      transformRef.current.resetTransform()
      scaleRef.current = 1
    }
  }, [isOpen, activeImageIndex])

  // 下滑关闭（仅在未缩放状态）
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      startYRef.current = e.touches[0].clientY
    }
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.changedTouches.length === 1 && scaleRef.current === 1) {
      const deltaY = e.changedTouches[0].clientY - startYRef.current
      if (deltaY > 100) {
        onClose()
      }
    }
  }, [onClose])

  // 单击背景关闭（仅在未缩放状态）
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    // 只响应直接点击背景，不响应点击图片
    if (e.target === e.currentTarget && scaleRef.current === 1) {
      onClose()
    }
  }, [onClose])

  // 缩放变化回调
  const handleTransform = useCallback((ref: ReactZoomPanPinchRef) => {
    scaleRef.current = ref.state.scale
  }, [])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center animate-fade-in"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.95)' }}
      onClick={handleBackdropClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* 顶部插槽 */}
      {topSlot}

      {/* 多图导航箭头（在 TransformWrapper 外，不随缩放移动） */}
      {images && images.length > 1 && (
        <>
          <button
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full flex items-center justify-center bg-black/40 backdrop-blur-sm transition-opacity"
            style={{ opacity: canGoPrev ? 1 : 0.3 }}
            disabled={!canGoPrev}
            onClick={(e) => { e.stopPropagation(); onImageChange?.(effectiveIndex - 1) }}
            aria-label="上一张"
          >
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
          <button
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full flex items-center justify-center bg-black/40 backdrop-blur-sm transition-opacity"
            style={{ opacity: canGoNext ? 1 : 0.3 }}
            disabled={!canGoNext}
            onClick={(e) => { e.stopPropagation(); onImageChange?.(effectiveIndex + 1) }}
            aria-label="下一张"
          >
            <ChevronRight className="w-5 h-5 text-white" />
          </button>
        </>
      )}

      {/* 图片查看器 */}
      <TransformWrapper
        ref={transformRef}
        initialScale={1}
        minScale={1}
        maxScale={4}
        centerOnInit
        limitToBounds
        centerZoomedOut
        doubleClick={{ mode: 'toggle', step: 1.5 }}
        panning={{ velocityDisabled: true }}
        onTransformed={handleTransform}
        smooth
      >
        <>
          <BottomControls onClose={onClose} />
          <TransformComponent
            wrapperStyle={{
              width: '100%',
              height: '100%',
            }}
            contentStyle={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div className="relative w-full h-full flex items-center justify-center">
              <Image
                key={effectiveSrc}
                src={effectiveSrc}
                alt={alt}
                fill
                className="object-contain select-none"
                sizes="100vw"
                priority
                draggable={false}
                onLoad={() => {
                  if (currentSrc.current === effectiveSrc) setLoadedSrc(effectiveSrc)
                }}
                onError={() => {
                  if (currentSrc.current === effectiveSrc) setLoadedSrc(null)
                }}
              />
              {/* 叠加层内容（如 Topo 线路 SVG） */}
              {loadedSrc === effectiveSrc ? children : null}
            </div>
          </TransformComponent>
        </>
      </TransformWrapper>
    </div>
  )
}
