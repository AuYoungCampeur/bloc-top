// apps/editor/src/components/editor/inline-face-upload.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { InlineFaceUpload } from './inline-face-upload'
import { PUBLISHING_DELAY_MESSAGE } from '@/lib/publishing-feedback'

// Mock ImageUploadZone — exposes both file selection trigger and upload button
vi.mock('./image-upload-zone', () => ({
  ImageUploadZone: ({ onFileSelect, onUpload, disabled, uploadButtonText }: {
    onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
    onUpload: () => void
    disabled?: boolean
    uploadButtonText?: string
  }) => (
    <div>
      <button
        data-testid="file-select-trigger"
        onClick={() => {
          const mockFile = new File(['img'], 'test.jpg', { type: 'image/jpeg' })
          const mockEvent = { target: { files: [mockFile] } } as unknown as React.ChangeEvent<HTMLInputElement>
          onFileSelect(mockEvent)
        }}
      >
        选择文件
      </button>
      <button disabled={disabled} onClick={onUpload}>
        {uploadButtonText || '上传'}
      </button>
    </div>
  ),
}))

// Mock useToast
const toast = vi.hoisted(() => vi.fn())
vi.mock('@bloctop/ui/components/toast', () => ({
  useToast: () => ({ showToast: toast }),
}))
beforeEach(() => { vi.clearAllMocks(); URL.createObjectURL = vi.fn().mockReturnValue('blob:preview'); URL.revokeObjectURL = vi.fn() })

describe('InlineFaceUpload', () => {
  it('用户端通知延迟仍开始标注并仅提示保存完成警告，不重复上传', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, refreshPending: true }) })
    const onSuccess = vi.fn()
    render(<InlineFaceUpload cragId="a" area="北区" onUploadSuccess={onSuccess} />)
    fireEvent.change(screen.getByPlaceholderText(/如.*zhu-qiang/), { target: { value: 'new-face' } })
    fireEvent.click(screen.getByTestId('file-select-trigger'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '上传并开始标注' })) })
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith('new-face'))
    expect(toast).toHaveBeenCalledExactlyOnceWith(PUBLISHING_DELAY_MESSAGE, 'info', 8000)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('显示区域只读 badge', () => {
    render(
      <InlineFaceUpload cragId="test-crag" area="主墙" onUploadSuccess={vi.fn()} />
    )
    expect(screen.getByText('主墙')).toBeTruthy()
  })

  it('faceId 为空时上传按钮 disabled', () => {
    render(
      <InlineFaceUpload cragId="test-crag" area="主墙" onUploadSuccess={vi.fn()} />
    )
    // The upload button text comes from uploadButtonText prop
    const btn = screen.getByRole('button', { name: /上传并开始标注/ })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it('faceId 格式非法时提示错误', () => {
    render(
      <InlineFaceUpload cragId="test-crag" area="主墙" onUploadSuccess={vi.fn()} />
    )
    const input = screen.getByPlaceholderText(/如.*zhu-qiang/)
    fireEvent.change(input, { target: { value: 'ZhuQiang' } })
    expect(screen.getByText(/只能包含小写字母/)).toBeTruthy()
  })

  it('上传成功后调用 onUploadSuccess 并传入正确的 faceId', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    })
    vi.stubGlobal('fetch', mockFetch)
    const onSuccess = vi.fn()

    render(
      <InlineFaceUpload cragId="crag-1" area="主墙" onUploadSuccess={onSuccess} />
    )

    // 1. 输入合法 faceId
    const input = screen.getByPlaceholderText(/如.*zhu-qiang/)
    fireEvent.change(input, { target: { value: 'zhu-qiang' } })

    // 2. 触发文件选择（通过 mock 的 file-select-trigger button）
    fireEvent.click(screen.getByTestId('file-select-trigger'))

    // 3. 点击上传按钮（此时 disabled 应已解除）
    const uploadBtn = screen.getByRole('button', { name: /上传并开始标注/ })
    expect((uploadBtn as HTMLButtonElement).disabled).toBe(false)
    await act(async () => { fireEvent.click(uploadBtn) })

    // 4. 验证 fetch 被调用，以及 onSuccess 被调用并传入正确 faceId
    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/upload', expect.objectContaining({ method: 'POST' }))
      expect(onSuccess).toHaveBeenCalledWith('zhu-qiang')
    })
  })
})
