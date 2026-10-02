'use client'

import { useState, useCallback } from 'react'
import { Upload } from 'lucide-react'
import { Input } from '@bloctop/ui/components/input'
import { useToast } from '@bloctop/ui/components/toast'
import { ImageUploadZone } from './image-upload-zone'
import { publishingDelayMessage } from '@/lib/publishing-feedback'

const FACE_ID_REGEX = /^[a-z][a-z0-9-]*[a-z0-9]$/

interface InlineFaceUploadProps {
  cragId: string
  area: string
  onUploadSuccess: (faceId: string) => void
}

export function InlineFaceUpload({ cragId, area, onUploadSuccess }: InlineFaceUploadProps) {
  const [faceId, setFaceId] = useState('')
  const [faceIdError, setFaceIdError] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const { showToast } = useToast()

  const handleFaceIdChange = useCallback((value: string) => {
    setFaceId(value)
    if (value && !FACE_ID_REGEX.test(value)) {
      setFaceIdError('只能包含小写字母、数字和连字符，且以字母开头和结尾，最少 2 个字符')
    } else {
      setFaceIdError('')
    }
  }, [])

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      if (!file.type.startsWith('image/')) {
        showToast('请选择图片文件', 'error')
        return
      }
      setSelectedFile(file)
      setPreviewUrl(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(file)
      })
    },
    [showToast]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => setIsDragging(false), [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (!file) return
      if (!file.type.startsWith('image/')) {
        showToast('请选择图片文件', 'error')
        return
      }
      setSelectedFile(file)
      setPreviewUrl(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(file)
      })
    },
    [showToast]
  )

  const handleClearFile = useCallback(() => {
    setPreviewUrl(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setSelectedFile(null)
  }, [])

  const handleUpload = useCallback(async () => {
    if (!selectedFile || !faceId || faceIdError) return
    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('cragId', cragId)
      formData.append('area', area)
      formData.append('faceId', faceId)
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '上传失败')
      showToast(data.refreshPending ? publishingDelayMessage(data.warning) : '岩面照片上传成功', data.refreshPending ? 'info' : 'success', data.refreshPending ? 8000 : undefined)
      onUploadSuccess(faceId)
    } catch (err) {
      showToast(err instanceof Error ? err.message : '上传失败', 'error')
    } finally {
      setIsUploading(false)
    }
  }, [selectedFile, faceId, faceIdError, cragId, area, showToast, onUploadSuccess])

  return (
    <div className="space-y-4">
      {/* 提示 */}
      <div
        className="glass-light p-4 text-center"
        style={{ borderRadius: 'var(--theme-radius-xl)', color: 'var(--theme-on-surface-variant)' }}
      >
        <Upload className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--theme-on-surface)' }}>
          当前区域还没有岩面照片
        </p>
        <p className="text-xs">上传一张照片即可开始标注线路</p>
      </div>

      {/* faceId 输入 */}
      <div>
        <label
          className="block text-xs font-medium mb-1.5"
          style={{ color: 'var(--theme-on-surface-variant)' }}
        >
          岩面名称（英文ID）
        </label>
        <Input
          value={faceId}
          onChange={handleFaceIdChange}
          placeholder="如：zhu-qiang"
          style={faceIdError ? { borderColor: 'var(--theme-error)' } : undefined}
        />
        {faceIdError && (
          <p className="text-xs mt-1" style={{ color: 'var(--theme-error)' }} role="alert">
            {faceIdError}
          </p>
        )}
      </div>

      {/* 区域只读 badge */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium" style={{ color: 'var(--theme-on-surface-variant)' }}>
          区域
        </span>
        <span
          className="px-2.5 py-1 rounded-full text-xs font-medium"
          style={{
            backgroundColor: 'var(--theme-primary)',
            color: 'var(--theme-on-primary)',
          }}
        >
          {area}
        </span>
      </div>

      {/* 上传区 */}
      <ImageUploadZone
        previewUrl={previewUrl}
        isDragging={isDragging}
        isUploading={isUploading}
        compressionProgress={null}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onFileSelect={handleFileSelect}
        onClearFile={handleClearFile}
        onUpload={handleUpload}
        uploadButtonText="上传并开始标注"
        disabled={!faceId || !!faceIdError || !selectedFile}
        emptyTitle="上传岩面照片"
        emptySubtitle="拖拽或点击选择图片"
      />
    </div>
  )
}
