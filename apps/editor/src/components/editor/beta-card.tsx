'use client'

import { useState } from 'react'
import {
  BookHeart,
  ExternalLink,
  Pencil,
  Trash2,
  Save,
  Loader2,
  User,
  Ruler,
  MoveHorizontal,
} from 'lucide-react'
import { Input } from '@bloctop/ui/components/input'
import { BETA_PLATFORMS } from '@bloctop/shared/beta-constants'
import type { BetaLink } from '@bloctop/shared/types'

export interface BetaEditForm {
  title: string
  author: string
  climberHeight: string
  climberReach: string
}

export interface BetaCardProps {
  beta: BetaLink
  isEditing: boolean
  editForm: BetaEditForm
  setEditForm: React.Dispatch<React.SetStateAction<BetaEditForm>>
  onStartEdit: () => void
  onCancelEdit: () => void
  onSave: () => void
  onDelete: () => void
  isSaving: boolean
  isDeleting: boolean
  editDisabled?: boolean
}

export function BetaCard({
  beta,
  isEditing,
  editForm,
  setEditForm,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDelete,
  isSaving,
  isDeleting,
  editDisabled = false,
}: BetaCardProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const platformInfo = BETA_PLATFORMS[beta.platform]

  return (
    <div
      className="p-4 transition-all duration-200"
      style={{
        backgroundColor: 'var(--theme-surface-variant)',
        borderRadius: 'var(--theme-radius-xl)',
        border: isEditing ? '2px solid var(--theme-primary)' : '1px solid var(--theme-outline-variant)',
      }}
    >
      {/* 头部：平台 + URL + 操作按钮 */}
      <div className="flex items-center gap-2 mb-3">
        <BookHeart className="w-4 h-4 flex-shrink-0" style={{ color: platformInfo?.color || 'var(--theme-on-surface-variant)' }} />
        <span className="text-xs font-medium" style={{ color: platformInfo?.color }}>{platformInfo?.name || beta.platform}</span>
        <a
          href={beta.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs truncate flex-1 min-w-0"
          style={{ color: 'var(--theme-primary)' }}
        >
          <span className="truncate">{beta.url}</span>
          <ExternalLink className="w-3 h-3 flex-shrink-0" />
        </a>
        {!isEditing && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={onStartEdit}
              disabled={editDisabled}
              className="p-1.5 rounded-lg transition-all duration-200 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ color: 'var(--theme-primary)' }}
              aria-label="编辑"
              title={editDisabled ? '请先保存或取消当前 Beta 编辑' : '编辑'}
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="p-1.5 rounded-lg transition-all duration-200 active:scale-95"
              style={{ color: 'var(--theme-error)' }}
              title="删除"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* 删除确认 */}
      {showDeleteConfirm && (
        <div
          className="flex items-center gap-2 p-3 mb-3 animate-fade-in-up"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--theme-error) 12%, var(--theme-surface))',
            borderRadius: 'var(--theme-radius-lg)',
          }}
        >
          <span className="text-sm flex-1" style={{ color: 'var(--theme-error)' }}>确定删除此 Beta？</span>
          <button
            onClick={() => { setShowDeleteConfirm(false); onDelete() }}
            disabled={isDeleting}
            className="px-3 py-1 rounded-lg text-sm font-medium text-white transition-all active:scale-95"
            style={{ backgroundColor: 'var(--theme-error)' }}
          >
            {isDeleting ? '删除中...' : '确定'}
          </button>
          <button
            onClick={() => setShowDeleteConfirm(false)}
            className="px-3 py-1 rounded-lg text-sm font-medium transition-all active:scale-95"
            style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-on-surface)' }}
          >
            取消
          </button>
        </div>
      )}

      {isEditing ? (
        /* 编辑模式 */
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--theme-on-surface-variant)' }}>标题</label>
            <Input
              value={editForm.title}
              onChange={(v) => setEditForm(prev => ({ ...prev, title: v }))}
              placeholder="Beta 标题"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--theme-on-surface-variant)' }}>
              <User className="w-3 h-3 inline mr-1" />作者
            </label>
            <Input
              value={editForm.author}
              onChange={(v) => setEditForm(prev => ({ ...prev, author: v }))}
              placeholder="昵称"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--theme-on-surface-variant)' }}>
                <Ruler className="w-3 h-3 inline mr-1" />身高 (cm)
              </label>
              {/* eslint-disable-next-line no-restricted-syntax -- type="number" has no IME composition */}
              <input
                type="number"
                value={editForm.climberHeight}
                onChange={(e) => setEditForm(prev => ({ ...prev, climberHeight: e.target.value }))}
                placeholder="170"
                min={100}
                max={250}
                className="w-full px-3 py-2 text-sm outline-none"
                style={{
                  backgroundColor: 'var(--theme-surface)',
                  borderRadius: 'var(--theme-radius-lg)',
                  color: 'var(--theme-on-surface)',
                }}
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--theme-on-surface-variant)' }}>
                <MoveHorizontal className="w-3 h-3 inline mr-1" />臂长 (cm)
              </label>
              {/* eslint-disable-next-line no-restricted-syntax -- type="number" has no IME composition */}
              <input
                type="number"
                value={editForm.climberReach}
                onChange={(e) => setEditForm(prev => ({ ...prev, climberReach: e.target.value }))}
                placeholder="170"
                min={100}
                max={250}
                className="w-full px-3 py-2 text-sm outline-none"
                style={{
                  backgroundColor: 'var(--theme-surface)',
                  borderRadius: 'var(--theme-radius-lg)',
                  color: 'var(--theme-on-surface)',
                }}
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={onCancelEdit}
              className="flex-1 py-2 px-4 rounded-xl font-medium text-sm transition-all active:scale-[0.98]"
              style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-on-surface)' }}
            >
              取消
            </button>
            <button
              onClick={onSave}
              disabled={isSaving}
              className="flex-1 py-2 px-4 rounded-xl font-medium text-sm flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
              style={{
                backgroundColor: 'var(--theme-primary)',
                color: 'var(--theme-on-primary)',
                opacity: isSaving ? 0.7 : 1,
              }}
            >
              {isSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> 保存中...</> : <><Save className="w-4 h-4" /> 保存</>}
            </button>
          </div>
        </div>
      ) : (
        /* 展示模式 */
        <div className="space-y-1.5">
          {beta.title && (
            <p className="text-sm font-medium" style={{ color: 'var(--theme-on-surface)' }}>{beta.title}</p>
          )}
          {beta.author && (
            <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--theme-on-surface-variant)' }}>
              <User className="w-3 h-3" />
              <span>{beta.author}</span>
            </div>
          )}
          {(beta.climberHeight || beta.climberReach) && (
            <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--theme-on-surface-variant)' }}>
              {beta.climberHeight && (
                <span className="flex items-center gap-1">
                  <Ruler className="w-3 h-3" />
                  {beta.climberHeight}cm
                </span>
              )}
              {beta.climberReach && (
                <span className="flex items-center gap-1">
                  <MoveHorizontal className="w-3 h-3" />
                  臂长 {beta.climberReach}cm
                </span>
              )}
            </div>
          )}
          {!beta.title && !beta.author && !beta.climberHeight && !beta.climberReach && (
            <p className="text-xs" style={{ color: 'var(--theme-on-surface-variant)', opacity: 0.6 }}>
              无额外信息
            </p>
          )}
        </div>
      )}
    </div>
  )
}
