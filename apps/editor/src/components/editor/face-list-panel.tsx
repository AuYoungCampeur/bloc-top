'use client'
// apps/editor/src/components/editor/face-list-panel.tsx
import { Image as ImageIcon, Plus, Loader2 } from 'lucide-react'
import { Input } from '@bloctop/ui/components/input'
import { CragSelector } from '@/components/editor/crag-selector'
import type { FaceGroup } from '@/hooks/use-face-data'
import type { Crag } from '@bloctop/shared/types'

interface FaceListPanelProps {
  crags: Crag[]
  selectedCragId: string | null
  isLoadingCrags: boolean
  stats: { total: number; marked: number; unmarked: number; progress: number }
  onSelectCrag: (id: string) => void
  areas: string[]
  selectedArea: string | null
  onSelectArea: (area: string | null) => void
  isAddingArea: boolean
  newAreaName: string
  setNewAreaName: (v: string) => void
  onAddAreaKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onStartAddArea: () => void
  isCreating: boolean
  onStartCreate: () => void
  isLoadingRoutes: boolean
  isLoadingFaces: boolean
  faceGroups: FaceGroup[]
  selectedFace: FaceGroup | null
  onSelectFace: (face: FaceGroup) => void
}

export function FaceListPanel({
  crags, selectedCragId, isLoadingCrags, stats, onSelectCrag,
  areas, selectedArea, onSelectArea,
  isAddingArea, newAreaName, setNewAreaName, onAddAreaKeyDown, onStartAddArea,
  isCreating, onStartCreate,
  isLoadingRoutes, isLoadingFaces, faceGroups, selectedFace, onSelectFace,
}: FaceListPanelProps) {
  return (
    <div className="flex flex-col h-full">
      <CragSelector crags={crags} selectedCragId={selectedCragId} isLoading={isLoadingCrags} onSelect={onSelectCrag} stats={stats} />
      {selectedCragId && (
        <>
          {/* Area 筛选 */}
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 mb-3 px-1">
            {[null, ...areas].map(area => (
              <button key={area ?? 'all'} onClick={() => onSelectArea(area)}
                className={`px-4 py-2 rounded-full whitespace-nowrap transition-all duration-200 active:scale-95 text-sm font-medium ${selectedArea === area ? '' : 'glass-light'}`}
                style={{
                  backgroundColor: selectedArea === area ? 'var(--theme-primary)' : undefined,
                  color: selectedArea === area ? 'var(--theme-on-primary)' : 'var(--theme-on-surface)',
                }}>
                {area ?? '全部'}
              </button>
            ))}
            {isAddingArea ? (
              <Input autoFocus variant="unstyled" themed={false} value={newAreaName} onChange={setNewAreaName}
                onKeyDown={onAddAreaKeyDown}
                className="px-3 py-2 rounded-full text-sm font-medium outline-none min-w-[80px]"
                style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-on-surface)', border: '2px solid var(--theme-primary)' }}
                placeholder="区域名…" />
            ) : (
              <button onClick={onStartAddArea}
                className="px-3 py-2 rounded-full whitespace-nowrap transition-all duration-200 active:scale-95 flex items-center gap-1"
                style={{ backgroundColor: 'transparent', color: 'var(--theme-primary)', border: '1.5px dashed var(--theme-primary)' }}>
                <Plus className="w-4 h-4" /><span className="text-sm font-medium">新增区域</span>
              </button>
            )}
          </div>
          {/* 新建按钮 */}
          <button onClick={onStartCreate}
            className={`w-full mb-2 py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.98] ${isCreating ? '' : 'glass-light'}`}
            style={{ backgroundColor: isCreating ? 'var(--theme-primary)' : undefined, color: isCreating ? 'var(--theme-on-primary)' : 'var(--theme-on-surface)' }}>
            <Plus className="w-5 h-5" /> 新建岩面
          </button>
          {/* Face 列表 */}
          <div className="flex-1 overflow-y-auto min-h-0 space-y-2">
            {isLoadingRoutes || isLoadingFaces ? (
              <div className="flex flex-col items-center justify-center py-12" style={{ color: 'var(--theme-on-surface-variant)' }}>
                <div className="w-8 h-8 animate-spin mb-3"><Loader2 className="w-full h-full" /></div>
                <span>加载中...</span>
              </div>
            ) : faceGroups.length === 0 ? (
              <div className="text-center py-12" style={{ color: 'var(--theme-on-surface-variant)' }}>
                <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">暂无岩面</p>
                <p className="text-sm mt-1">点击上方「新建岩面」按钮创建</p>
              </div>
            ) : (
              faceGroups.map(face => (
                <button key={`${face.area}/${face.faceId}`} onClick={() => onSelectFace(face)}
                  className={`w-full text-left p-3 transition-all duration-200 active:scale-[0.98] ${selectedFace?.faceId === face.faceId && selectedFace?.area === face.area && !isCreating ? 'ring-2' : 'glass'}`}
                  style={{
                    backgroundColor: selectedFace?.faceId === face.faceId && selectedFace?.area === face.area && !isCreating
                      ? 'color-mix(in srgb, var(--theme-primary) 12%, var(--theme-surface))'
                      : undefined,
                    borderRadius: 'var(--theme-radius-xl)',
                    '--tw-ring-color': 'var(--theme-primary)',
                  } as React.CSSProperties}>
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-12 rounded-lg overflow-hidden flex-shrink-0" style={{ backgroundColor: 'var(--theme-surface-variant)' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={face.imageUrl}
                        alt={face.faceId}
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold block truncate" style={{ color: 'var(--theme-on-surface)' }}>{face.faceId}</span>
                      <span className="text-xs" style={{ color: 'var(--theme-on-surface-variant)' }}>{face.area} · {face.routes.length} 条线路</span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
