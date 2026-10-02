import React, { useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import Link from 'next/link'
import type { FaceGroup } from '@/types/face'

export interface FaceSelectorProps {
  faceGroups: FaceGroup[]
  selectedFaceId: string | null
  selectedFaceArea: string | null
  isLoading: boolean
  onSelect: (faceId: string, area: string) => void
}

export const FaceSelector = React.memo(function FaceSelector({
  faceGroups,
  selectedFaceId,
  selectedFaceArea,
  isLoading,
  onSelect,
}: FaceSelectorProps) {
  const handleClick = useCallback(
    (faceId: string, area: string) => {
      if (faceId === selectedFaceId && area === selectedFaceArea) return
      onSelect(faceId, area)
    },
    [selectedFaceId, selectedFaceArea, onSelect]
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-3" style={{ color: 'var(--theme-on-surface-variant)' }}>
        <div className="w-5 h-5 animate-spin"><Loader2 className="w-full h-full" /></div>
      </div>
    )
  }

  if (faceGroups.length === 0) {
    return (
      <div className="text-center py-3" style={{ color: 'var(--theme-on-surface-variant)' }}>
        <p className="text-sm">暂无岩面数据</p>
        <Link href="/faces" className="text-sm font-medium mt-1 inline-block" style={{ color: 'var(--theme-primary)' }}>
          去岩面管理页面创建 →
        </Link>
      </div>
    )
  }

  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide">
      {faceGroups.map(face => (
        <button
          key={`${face.area}/${face.faceId}`}
          onClick={() => handleClick(face.faceId, face.area)}
          aria-pressed={selectedFaceId === face.faceId && selectedFaceArea === face.area}
          aria-label={`${face.area}/${face.faceId}`}
          className={`flex-shrink-0 p-1.5 transition-all duration-200 active:scale-[0.98] ${selectedFaceId === face.faceId && selectedFaceArea === face.area ? 'ring-2' : ''}`}
          style={{
            backgroundColor: selectedFaceId === face.faceId && selectedFaceArea === face.area
              ? 'color-mix(in srgb, var(--theme-primary) 12%, var(--theme-surface))'
              : 'var(--theme-surface)',
            borderRadius: 'var(--theme-radius-lg)',
            // @ts-expect-error -- CSS custom properties
            '--tw-ring-color': 'var(--theme-primary)',
          }}
        >
          <div className="w-20 h-14 rounded-md overflow-hidden" style={{ backgroundColor: 'var(--theme-surface-variant)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={face.imageUrl}
              alt={face.faceId}
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          </div>
          <p className="text-xs mt-1 text-center truncate w-20" style={{ color: 'var(--theme-on-surface-variant)' }}>
            {face.faceId}
          </p>
        </button>
      ))}
    </div>
  )
})
