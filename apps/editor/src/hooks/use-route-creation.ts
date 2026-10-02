import { useState, useCallback } from 'react'
import type { Route } from '@bloctop/shared/types'
import { useToast } from '@bloctop/ui/components/toast'
import { validateRouteForm } from '@/lib/route-validation'
import { publishingDelayMessage } from '@/lib/publishing-feedback'

export interface UseRouteCreationOptions {
  selectedCragId: string | null
  selectedArea: string | null
  areas: string[]
  setRoutes: React.Dispatch<React.SetStateAction<Route[]>>
  persistedAreas: string[]
  updateCragAreas: (cragId: string, areas: string[]) => Promise<string[]>
  hasUnsavedChanges: () => boolean
}

export function useRouteCreation({
  selectedCragId,
  selectedArea,
  areas,
  setRoutes,
  persistedAreas,
  updateCragAreas,
  hasUnsavedChanges,
}: UseRouteCreationOptions) {
  const { showToast } = useToast()

  const [isCreatingRoute, setIsCreatingRoute] = useState(false)
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false)
  const [newRoute, setNewRoute] = useState({
    name: '', grade: '？', area: '', FA: '', setter: '', description: '',
  })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const handleStartCreate = useCallback((): boolean => {
    if (hasUnsavedChanges()) {
      showToast('请先保存当前线路的更改', 'info', 3000)
      return false
    }
    setIsCreatingRoute(true)
    const defaultArea = selectedArea || (areas.length > 0 ? areas[0] : '')
    setNewRoute({
      name: '', grade: '？', area: defaultArea, FA: '', setter: '', description: '',
    })
    setFormErrors({})
    return true
  }, [selectedArea, areas, hasUnsavedChanges, showToast])

  const handleSubmitCreate = useCallback(async (): Promise<Route | null> => {
    const errors = validateRouteForm(newRoute)
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return null
    }
    setFormErrors({})
    if (!selectedCragId) return null

    setIsSubmittingCreate(true)
    try {
      const res = await fetch('/api/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newRoute, cragId: selectedCragId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '创建失败')

      const created = data.route as Route
      setRoutes(prev => [...prev, created])
      setIsCreatingRoute(false)

      const createdArea = newRoute.area.trim()
      if (createdArea && selectedCragId && !persistedAreas.includes(createdArea)) {
        const merged = [...new Set([...persistedAreas, createdArea])].sort()
        updateCragAreas(selectedCragId, merged).catch(() => {})
      }

      showToast(data.refreshPending ? publishingDelayMessage(data.warning) : `线路「${created.name}」创建成功！`, data.refreshPending ? 'info' : 'success', data.refreshPending ? 8000 : 3000)
      return created
    } catch (error) {
      showToast(error instanceof Error ? error.message : '创建失败', 'error', 4000)
      return null
    } finally {
      setIsSubmittingCreate(false)
    }
  }, [selectedCragId, newRoute, setRoutes, showToast, persistedAreas, updateCragAreas])

  const handleCancelCreate = useCallback(() => {
    setIsCreatingRoute(false)
    setFormErrors({})
  }, [])

  return {
    isCreatingRoute,
    isSubmittingCreate,
    newRoute,
    setNewRoute,
    formErrors,
    setFormErrors,
    handleStartCreate,
    handleSubmitCreate,
    handleCancelCreate,
  }
}
