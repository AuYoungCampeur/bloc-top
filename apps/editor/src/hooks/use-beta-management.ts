'use client'

import { useState, useCallback, useRef } from 'react'
import type { Route, BetaLink } from '@bloctop/shared/types'
import { useToast } from '@bloctop/ui/components/toast'
import type { BetaEditForm } from '@/components/editor/beta-card'

export type { BetaEditForm }

export interface UseBetaManagementOptions {
  setRoutes: React.Dispatch<React.SetStateAction<Route[]>>
}

export function useBetaManagement({ setRoutes }: UseBetaManagementOptions) {
  const { showToast } = useToast()
  const [editingBetaId, setEditingBetaId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<BetaEditForm>({
    title: '',
    author: '',
    climberHeight: '',
    climberReach: '',
  })
  const [isSaving, setIsSaving] = useState(false)
  const [deletingBetaId, setDeletingBetaId] = useState<string | null>(null)
  const editSessionRef = useRef(0)
  const currentEditRef = useRef({ editingBetaId, editForm })
  currentEditRef.current = { editingBetaId, editForm }
  const savingRef = useRef(false)

  const updateRoute = useCallback(
    (
      routeId: number,
      transform: (r: Route) => Route,
    ) => {
      setRoutes(prev => prev.map(r => r.id === routeId ? transform(r) : r))
    },
    [setRoutes],
  )

  const handleBetaAdded = useCallback((routeId: number, beta: BetaLink) => {
    updateRoute(routeId, route => ({
      ...route,
      betaLinks: [...(route.betaLinks ?? []).filter(existing => existing.id !== beta.id), beta],
    }))
  }, [updateRoute])

  const handleStartEdit = useCallback((beta: BetaLink) => {
    editSessionRef.current += 1
    setEditingBetaId(beta.id)
    setEditForm({
      title: beta.title || '',
      author: beta.author || '',
      climberHeight: beta.climberHeight ? String(beta.climberHeight) : '',
      climberReach: beta.climberReach ? String(beta.climberReach) : '',
    })
  }, [])

  const handleCancelEdit = useCallback(() => {
    editSessionRef.current += 1
    setEditingBetaId(null)
  }, [])

  const handleSaveBeta = useCallback(async (
    betaId: string,
    selectedRoute: Route,
  ) => {
    if (editingBetaId !== betaId || savingRef.current) return
    const submittedSession = editSessionRef.current
    const submittedDraftKey = JSON.stringify(editForm)
    savingRef.current = true
    setIsSaving(true)
    try {
      const parsedValues = {
        title: editForm.title.trim() || null,
        author: editForm.author.trim() || null,
        climberHeight: editForm.climberHeight.trim() ? Number(editForm.climberHeight) : null,
        climberReach: editForm.climberReach.trim() ? Number(editForm.climberReach) : null,
      }
      if ([parsedValues.climberHeight, parsedValues.climberReach].some(value => value !== null && !Number.isFinite(value))) {
        throw new Error('身高和臂展必须是有效数字')
      }
      const res = await fetch('/api/beta', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routeId: selectedRoute.id, betaId, ...parsedValues }),
      })
      const data = await res.json()
      if (!res.ok || !data.beta) {
        throw new Error(data.error || '保存失败')
      }

      updateRoute(selectedRoute.id, r => ({
        ...r,
        betaLinks: (r.betaLinks || []).map(b => b.id === betaId ? data.beta as BetaLink : b),
      }))

      const isSubmittedSession = submittedSession === editSessionRef.current
        && currentEditRef.current.editingBetaId === betaId
      const hasNewChanges = isSubmittedSession && JSON.stringify(currentEditRef.current.editForm) !== submittedDraftKey
      if (isSubmittedSession && !hasNewChanges) handleCancelEdit()
      showToast(
        hasNewChanges ? '已保存提交内容，后续 Beta 修改尚未保存' : 'Beta 信息已更新',
        hasNewChanges ? 'info' : 'success',
        hasNewChanges ? 4000 : 3000,
      )
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败', 'error', 4000)
    } finally {
      savingRef.current = false
      setIsSaving(false)
    }
  }, [editingBetaId, editForm, updateRoute, showToast, handleCancelEdit])

  const handleDeleteBeta = useCallback(async (
    betaId: string,
    selectedRoute: Route,
  ) => {
    setDeletingBetaId(betaId)
    try {
      const res = await fetch('/api/beta', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routeId: selectedRoute.id, betaId }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '删除失败')
      }

      updateRoute(selectedRoute.id, r => ({
        ...r,
        betaLinks: (r.betaLinks || []).filter(b => b.id !== betaId),
      }))

      showToast('Beta 已删除', 'success', 3000)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '删除失败', 'error', 4000)
    } finally {
      setDeletingBetaId(null)
    }
  }, [updateRoute, showToast])

  return {
    editingBetaId,
    editForm,
    setEditForm,
    isSaving,
    deletingBetaId,
    handleBetaAdded,
    handleStartEdit,
    handleCancelEdit,
    handleSaveBeta,
    handleDeleteBeta,
  }
}
