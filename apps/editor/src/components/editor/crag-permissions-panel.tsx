'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Users,
  Plus,
  Loader2,
  Trash2,
  UserCog,
} from 'lucide-react'
import { Badge } from '@bloctop/ui/components/badge'
import { useToast } from '@bloctop/ui/components/toast'
import { AddManagerDrawer } from './add-manager-drawer'
import type { CragPermissionRole } from '@bloctop/shared/types'

// ==================== Types ====================

interface PermissionUser {
  name: string
  email: string
}

interface PermissionRecord {
  userId: string
  cragId: string
  role: CragPermissionRole
  assignedBy: string
  createdAt: string
  user: PermissionUser
}

// ==================== Props ====================

interface CragPermissionsPanelProps {
  cragId: string
  canManage: boolean
}

// ==================== PermissionRow ====================

function PermissionRow({
  permission,
  canManage,
  onRemove,
  isRemoving,
  removeDisabled,
}: {
  permission: PermissionRecord
  canManage: boolean
  onRemove: (userId: string) => void
  isRemoving: boolean
  removeDisabled: boolean
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 p-3 transition-all duration-200"
      style={{
        backgroundColor: 'var(--theme-surface)',
        borderRadius: 'var(--theme-radius-lg)',
      }}
    >
      {/* User info */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--theme-primary) 15%, transparent)',
          }}
        >
          <UserCog
            className="w-4 h-4"
            style={{ color: 'var(--theme-primary)' }}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="text-sm font-medium truncate"
              style={{ color: 'var(--theme-on-surface)' }}
            >
              {permission.user.name || permission.user.email}
            </span>
            <Badge
              className="shrink-0 text-[10px] px-1.5 py-0"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--theme-primary) 15%, transparent)',
                color: 'var(--theme-primary)',
                border: 'none',
              }}
            >
              管理员
            </Badge>
          </div>
          <p
            className="text-xs truncate"
            style={{ color: 'var(--theme-on-surface-variant)' }}
          >
            {permission.user.email}
          </p>
        </div>
      </div>

      {/* Remove button */}
      {canManage && (
        <button
          type="button"
          onClick={() => onRemove(permission.userId)}
          disabled={isRemoving || removeDisabled}
          className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90 disabled:opacity-50"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--theme-error) 10%, transparent)',
          }}
          aria-label="移除权限"
        >
          {isRemoving ? (
            <Loader2
              className="w-3.5 h-3.5 animate-spin"
              style={{ color: 'var(--theme-error)' }}
            />
          ) : (
            <Trash2
              className="w-3.5 h-3.5"
              style={{ color: 'var(--theme-error)' }}
            />
          )}
        </button>
      )}
    </div>
  )
}

// ==================== CragPermissionsPanel ====================

export function CragPermissionsPanel({
  cragId,
  canManage,
}: CragPermissionsPanelProps) {
  const { showToast } = useToast()
  const [result, setResult] = useState<{ cragId: string; permissions: PermissionRecord[]; loading: boolean; error: string | null } | null>(null)
  const permissions = useMemo(() => result?.cragId === cragId ? result.permissions : [], [result, cragId])
  const isLoading = canManage && (result?.cragId !== cragId || result.loading)
  const loadError = result?.cragId === cragId ? result.error : null
  const [removingUserId, setRemovingUserId] = useState<string | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const contextKey = `${canManage}:${cragId}`
  const contextRef = useRef(contextKey)
  contextRef.current = contextKey
  const loadVersionRef = useRef(0)
  const loadAbortRef = useRef<AbortController | null>(null)
  const removingRef = useRef(false)

  // Fetch permissions
  const fetchPermissions = useCallback(async () => {
    if (!canManage || contextRef.current !== contextKey) return
    loadAbortRef.current?.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller
    const version = ++loadVersionRef.current
    const isCurrent = () => !controller.signal.aborted && contextRef.current === contextKey && loadVersionRef.current === version
    setResult({ cragId, permissions: [], loading: true, error: null })
    try {
      const res = await fetch(
        `/api/crag-permissions?cragId=${encodeURIComponent(cragId)}`,
        { signal: controller.signal },
      )
      const data = await res.json()
      if (!res.ok || !data.success || !Array.isArray(data.permissions)) throw new Error(data.error || '获取权限列表失败')
      if (isCurrent()) {
        setResult({ cragId, permissions: data.permissions, loading: false, error: null })
      }
    } catch (error) {
      if (isCurrent()) setResult({ cragId, permissions: [], loading: false, error: error instanceof Error ? error.message : '获取权限列表失败' })
    }
  }, [cragId, canManage, contextKey])

  useEffect(() => {
    fetchPermissions()
    setIsDrawerOpen(false)
    return () => { loadAbortRef.current?.abort(); loadVersionRef.current += 1 }
  }, [fetchPermissions])

  // Remove manager
  const handleRemove = useCallback(
    async (userId: string) => {
      if (!canManage || removingRef.current || contextRef.current !== contextKey || isLoading || loadError) return
      removingRef.current = true
      loadAbortRef.current?.abort()
      loadVersionRef.current += 1
      setRemovingUserId(userId)

      try {
        const res = await fetch('/api/crag-permissions', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, cragId }),
        })

        const data = await res.json()
        if (!res.ok || !data.success) throw new Error(data.error || '移除失败')
        if (contextRef.current !== contextKey) return

        showToast('已移除管理员', 'success')
        setResult(prev => prev?.cragId === cragId ? { ...prev, permissions: prev.permissions.filter(p => p.userId !== userId) } : prev)
      } catch (error) {
        if (contextRef.current === contextKey) showToast(error instanceof Error ? error.message : '移除失败', 'error')
      } finally {
        removingRef.current = false
        setRemovingUserId(null)
      }
    },
    [cragId, showToast, canManage, contextKey, isLoading, loadError]
  )

  // Existing user IDs for filtering search results (memoized for stable reference)
  const existingUserIds = useMemo(
    () => new Set(permissions.map((p) => p.userId)),
    [permissions]
  )

  // All permissions are 'manager' now, sort by creation date (natural order)
  const sortedPermissions = permissions

  if (!canManage) return <p className="text-sm p-4" style={{ color: 'var(--theme-on-surface-variant)' }}>岩场权限名单仅系统管理员可查看和管理。</p>

  return (
    <div
      className="glass-light p-4 space-y-4"
      style={{
        borderRadius: 'var(--theme-radius-xl)',
      }}
    >
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users
            className="w-4 h-4"
            style={{ color: 'var(--theme-primary)' }}
          />
          <h3
            className="font-semibold text-sm"
            style={{ color: 'var(--theme-on-surface)' }}
          >
            权限管理
          </h3>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={() => setIsDrawerOpen(true)}
            disabled={isLoading || !!loadError}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-200 active:scale-95"
            style={{
              backgroundColor:
                'color-mix(in srgb, var(--theme-primary) 15%, transparent)',
              color: 'var(--theme-primary)',
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            添加管理员
          </button>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-6">
          <Loader2
            className="w-5 h-5 animate-spin"
            style={{ color: 'var(--theme-primary)' }}
          />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && loadError && <div><p role="alert">{loadError}</p><button onClick={fetchPermissions}>重试加载权限</button></div>}
      {!isLoading && !loadError && permissions.length === 0 && (
        <div
          className="text-center py-6"
          style={{ color: 'var(--theme-on-surface-variant)' }}
        >
          <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">暂无权限记录</p>
        </div>
      )}

      {/* Permission rows */}
      {!isLoading && sortedPermissions.length > 0 && (
        <div className="space-y-2">
          {sortedPermissions.map((perm) => (
            <PermissionRow
              key={perm.userId}
              permission={perm}
              canManage={canManage}
              onRemove={handleRemove}
              isRemoving={removingUserId === perm.userId}
              removeDisabled={removingUserId !== null}
            />
          ))}
        </div>
      )}

      {/* Add manager drawer */}
      {canManage && (
        <AddManagerDrawer
          key={cragId}
          isOpen={isDrawerOpen}
          onClose={() => setIsDrawerOpen(false)}
          cragId={cragId}
          existingUserIds={existingUserIds}
          onAdded={fetchPermissions}
        />
      )}
    </div>
  )
}
