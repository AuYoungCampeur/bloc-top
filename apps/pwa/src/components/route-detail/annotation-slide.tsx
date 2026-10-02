'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useFaceImage } from '@/hooks/use-face-image'
import { TopoLineOverlay } from '@/components/topo-line-overlay'
import type { RouteTopoAnnotation } from '@bloctop/shared/types'

interface AnnotationSlideProps {
  annotation: RouteTopoAnnotation
  cragId: string
  mediaRevision?: string
  routeColor: string
  routeName: string
  onClick: () => void
}

export function AnnotationSlide({
  annotation, cragId, mediaRevision, routeColor, routeName, onClick,
}: AnnotationSlideProps) {
  const { src, isLoading, isError, onLoad, onError } = useFaceImage({
    cragId,
    area: annotation.area,
    faceId: annotation.faceId,
  }, mediaRevision)
  const [aspectRatio, setAspectRatio] = useState<number | undefined>(undefined)

  return (
    <button
      className="relative flex-none w-full h-full snap-start"
      onClick={onClick}
      aria-label="点击放大"
    >
      {isLoading && <div className="absolute inset-0 skeleton-shimmer" />}
      {!isError && src && (
        <Image
          key={src}
          src={src}
          alt={routeName}
          fill
          className={`object-contain transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
          sizes="(max-width: 768px) 100vw, 50vw"
          onLoad={(e) => {
            onLoad()
            const img = e.currentTarget as HTMLImageElement
            if (img.naturalWidth && img.naturalHeight) {
              setAspectRatio(img.naturalWidth / img.naturalHeight)
            }
          }}
          onError={onError}
        />
      )}
      {!isLoading && !isError && annotation.topoLine.length >= 2 && (
        <TopoLineOverlay
          points={annotation.topoLine}
          color={routeColor}
          tension={annotation.topoTension}
          objectFit="contain"
          aspectRatio={aspectRatio}
        />
      )}
    </button>
  )
}
