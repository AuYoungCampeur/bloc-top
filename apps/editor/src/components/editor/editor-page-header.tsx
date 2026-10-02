'use client'

import { type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

interface EditorPageHeaderProps {
  /** 页面标题 (e.g., "岩面管理", "线路标注", "Beta 管理") */
  title: string
  /** 标题左侧图标 */
  icon: ReactNode
  /** 移动端是否处于详情模式 */
  isDetailMode: boolean
  /** 移动端点击"返回列表"按钮的回调 */
  onBackToList: () => void
  /** "返回列表"按钮文案 (e.g., "岩面列表", "线路列表") */
  listLabel: string
  /** header 右侧自定义内容 (如 faces 的刷新按钮) */
  rightContent?: ReactNode
  /** Override the desktop back link when the page must protect a draft. */
  onBack?: () => void
}

export function EditorPageHeader({
  title,
  icon,
  isDetailMode,
  onBackToList,
  listLabel,
  rightContent,
  onBack,
}: EditorPageHeaderProps) {
  return (
    <header
      className="glass-heavy sticky top-0 z-40 px-4 lg:px-6 py-3"
      style={{
        borderBottom: '1px solid var(--theme-outline-variant)',
      }}
    >
      <div className="flex items-center justify-between max-w-4xl lg:max-w-none mx-auto">
        {/* 左侧: 动态返回按钮 */}
        {isDetailMode ? (
          <button
            onClick={onBackToList}
            className="lg:hidden flex items-center gap-2 min-h-[44px] -ml-2 px-2 rounded-xl transition-all duration-200 active:scale-95"
            style={{ color: 'var(--theme-primary)' }}
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-medium">{listLabel}</span>
          </button>
        ) : null}
        {onBack ? (
          <button
            onClick={onBack}
            className={`flex items-center gap-2 min-h-[44px] -ml-2 px-2 rounded-xl transition-all duration-200 active:scale-95 ${isDetailMode ? 'hidden lg:flex' : ''}`}
            style={{ color: 'var(--theme-primary)' }}
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-medium">返回</span>
          </button>
        ) : <Link
          href="/"
          className={`flex items-center gap-2 min-h-[44px] -ml-2 px-2 rounded-xl transition-all duration-200 active:scale-95 ${isDetailMode ? 'hidden lg:flex' : ''}`}
          style={{ color: 'var(--theme-primary)' }}
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="font-medium">返回</span>
        </Link>}

        {/* 中间: 图标 + 标题 */}
        <div className="flex items-center gap-2">
          {icon}
          <h1 className="text-lg font-bold" style={{ color: 'var(--theme-on-surface)' }}>{title}</h1>
        </div>

        {/* 右侧: 自定义内容或占位 */}
        <div className="w-20 flex justify-end">
          {rightContent}
        </div>
      </div>
    </header>
  )
}
