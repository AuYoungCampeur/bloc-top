import { useState, useRef, useCallback, useEffect } from 'react'
import { useToast } from '@bloctop/ui/components/toast'
import type { FaceMutationResult } from '@/lib/face-state'
import { publishingDelayMessage } from '@/lib/publishing-feedback'

interface UploadTarget { cragId: string; faceId: string; area: string }
interface UploadParams extends UploadTarget {
  overwrite?: boolean
  onSuccess: (url: string, result: FaceMutationResult) => void | Promise<unknown>
  onPartial?: (cragId: string) => Promise<unknown>
}
const targetKey = ({ cragId, area, faceId }: UploadTarget) => JSON.stringify([cragId, area, faceId])

export function useFaceUpload() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [compressionProgress, setCompressionProgress] = useState<number | null>(null)
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false)
  const [clearTopoOnUpload, setClearTopoOnUpload] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<File | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const busyRef = useRef(false)
  const checkedRef = useRef<{ key: string; etag: string; file: File } | null>(null)
  const { showToast } = useToast()

  const handleFile = useCallback((file: File) => {
    if (busyRef.current) return
    if (!file.type.startsWith('image/')) { showToast('请上传图片文件', 'error'); return }
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    const url = URL.createObjectURL(file)
    previewUrlRef.current = url
    fileRef.current = file
    checkedRef.current = null
    setShowOverwriteConfirm(false)
    setClearTopoOnUpload(false)
    setUploadedFile(file)
    setPreviewUrl(url)
  }, [showToast])

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); if (!busyRef.current) setIsDragging(true) }, [])
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false) }, [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const clearFile = useCallback(() => {
    if (busyRef.current) return
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = null
    fileRef.current = null
    checkedRef.current = null
    setShowOverwriteConfirm(false)
    setClearTopoOnUpload(false)
    setUploadedFile(null)
    setPreviewUrl(null)
  }, [])

  const doUpload = useCallback(async (params: UploadParams) => {
    const file = fileRef.current
    if (!file || busyRef.current) return false
    const { cragId, faceId, area, onSuccess, onPartial, overwrite } = params
    const checked = checkedRef.current
    if (overwrite && (!checked || checked.key !== targetKey(params) || checked.file !== file)) {
      setShowOverwriteConfirm(false)
      showToast('照片或目标已变化，请重新检查后上传', 'error', 4000)
      return false
    }
    busyRef.current = true
    setIsUploading(true)
    setShowOverwriteConfirm(false)
    try {
      let fileToUpload: File = file
      if (fileToUpload.size > 5 * 1024 * 1024) {
        setCompressionProgress(0)
        const { default: imageCompression } = await import('browser-image-compression')
        fileToUpload = await imageCompression(fileToUpload, {
          maxSizeMB: 4, maxWidthOrHeight: 4096, useWebWorker: true,
          onProgress: (p: number) => setCompressionProgress(Math.round(p)),
        })
      }
      const formData = new FormData()
      formData.append('file', fileToUpload)
      formData.append('cragId', cragId)
      formData.append('faceId', faceId)
      formData.append('area', area)
      if (overwrite) { formData.append('overwrite', 'true'); formData.append('expectedEtag', checked!.etag) }
      if (clearTopoOnUpload) formData.append('clearTopoLines', 'true')
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok || !data.success || typeof data.url !== 'string') {
        if (data.partial) await onPartial?.(cragId)
        throw new Error(data.error || '上传失败')
      }
      await onSuccess(data.url, data)
      if (data.refreshPending) showToast(publishingDelayMessage(data.warning), 'info', 8000)
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
      fileRef.current = null
      checkedRef.current = null
      setUploadedFile(null)
      setPreviewUrl(null)
      setClearTopoOnUpload(false)
      return true
    } catch (error) {
      checkedRef.current = null
      showToast(error instanceof Error ? error.message : '上传失败', 'error', 4000)
      return false
    } finally {
      busyRef.current = false
      setIsUploading(false)
      setCompressionProgress(null)
    }
  }, [clearTopoOnUpload, showToast])

  const checkAndUpload = useCallback(async (params: UploadTarget & { onDirectUpload: () => void | Promise<unknown> }) => {
    const file = fileRef.current
    if (!file || busyRef.current) return
    busyRef.current = true
    setIsUploading(true)
    checkedRef.current = null
    const { cragId, faceId, area, onDirectUpload } = params
    let canCreate = false
    try {
      const formData = new FormData()
      formData.append('cragId', cragId)
      formData.append('faceId', faceId)
      formData.append('area', area)
      formData.append('checkOnly', 'true')
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok || !data.success || typeof data.exists !== 'boolean') throw new Error(data.error || '检查照片失败，请重试')
      if (data.exists) {
        if (typeof data.etag !== 'string' || !data.etag.trim()) throw new Error('无法确认照片版本，请刷新后重新检查')
        checkedRef.current = { key: targetKey(params), etag: data.etag, file }
        setShowOverwriteConfirm(true)
      } else canCreate = true
    } catch (error) {
      showToast(error instanceof Error ? error.message : '检查照片失败，请重试', 'error', 4000)
    } finally {
      busyRef.current = false
      setIsUploading(false)
    }
    if (canCreate) await onDirectUpload()
  }, [showToast])

  useEffect(() => () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current) }, [])

  return {
    uploadedFile, previewUrl, isDragging, isUploading, compressionProgress,
    showOverwriteConfirm, setShowOverwriteConfirm, clearTopoOnUpload, setClearTopoOnUpload,
    fileInputRef, handleFile, handleDragOver, handleDragLeave, handleDrop, handleFileSelect,
    clearFile, doUpload, checkAndUpload,
  }
}
