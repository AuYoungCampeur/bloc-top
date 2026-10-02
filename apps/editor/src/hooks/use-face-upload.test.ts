import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFaceUpload } from './use-face-upload'

const fixtures = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('@bloctop/ui/components/toast', () => ({ useToast: () => ({ showToast: fixtures.toast }) }))
const target = { cragId: 'a', area: '北区', faceId: 'same' }
const file = () => new File(['photo'], 'photo.webp', { type: 'image/webp' })
const response = (data: unknown, ok = true) => ({ ok, json: async () => data }) as Response
function setup() {
  const view = renderHook(() => useFaceUpload())
  act(() => view.result.current.handleFile(file()))
  return view
}
beforeEach(() => {
  vi.clearAllMocks()
  URL.createObjectURL = vi.fn().mockReturnValue('blob:preview')
  URL.revokeObjectURL = vi.fn()
  globalThis.fetch = vi.fn()
})

describe('真实 useFaceUpload 条件写入工作流', () => {
  it.each([403, 500])('检查返回 %s 不直接上传，保留文件并提示可重试', async status => {
    const { result } = setup()
    vi.mocked(fetch).mockResolvedValueOnce(response({ success: false, error: `检查失败 ${status}` }, false))
    const direct = vi.fn()
    await act(async () => { await result.current.checkAndUpload({ ...target, onDirectUpload: direct }) })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(direct).not.toHaveBeenCalled()
    expect(result.current.uploadedFile).not.toBeNull()
    expect(fixtures.toast).toHaveBeenLastCalledWith(`检查失败 ${status}`, 'error', 4000)
  })

  it('网络错误或缺少 ETag 都不能执行覆盖', async () => {
    const { result } = setup()
    const direct = vi.fn()
    vi.mocked(fetch).mockRejectedValueOnce(new Error('网络失败'))
    await act(async () => { await result.current.checkAndUpload({ ...target, onDirectUpload: direct }) })
    vi.mocked(fetch).mockResolvedValueOnce(response({ success: true, exists: true }))
    await act(async () => { await result.current.checkAndUpload({ ...target, onDirectUpload: direct }) })
    expect(result.current.showOverwriteConfirm).toBe(false)
    expect(direct).not.toHaveBeenCalled()
    await act(async () => { expect(await result.current.doUpload({ ...target, overwrite: true, onSuccess: vi.fn() })).toBe(false) })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('确认覆盖发送检查得到的 ETag/完整目标，回调收到服务器权威记录', async () => {
    const { result } = setup()
    vi.mocked(fetch).mockResolvedValueOnce(response({ success: true, exists: true, etag: 'etag-1' }))
    await act(async () => { await result.current.checkAndUpload({ ...target, onDirectUpload: vi.fn() }) })
    expect(result.current.showOverwriteConfirm).toBe(true)
    act(() => result.current.setClearTopoOnUpload(true))
    const saved = { success: true, url: 'https://img.example.com/saved.webp', routes: [], mediaRevision: 5, partial: true, warning: '通知待完成' }
    vi.mocked(fetch).mockResolvedValueOnce(response(saved))
    const success = vi.fn()
    await act(async () => { expect(await result.current.doUpload({ ...target, overwrite: true, onSuccess: success })).toBe(true) })
    const body = vi.mocked(fetch).mock.calls[1][1]!.body as FormData
    expect(body.get('expectedEtag')).toBe('etag-1')
    expect(body.get('overwrite')).toBe('true')
    expect(body.get('area')).toBe('北区')
    expect(body.get('clearTopoLines')).toBe('true')
    expect((body.get('file') as File).type).toBe('image/webp')
    expect(success).toHaveBeenCalledWith(saved.url, saved)
    expect(result.current.uploadedFile).toBeNull()
  })

  it('确认时区域/文件变化拒绝沿用旧检查，不发写请求', async () => {
    const { result } = setup()
    vi.mocked(fetch).mockResolvedValueOnce(response({ success: true, exists: true, etag: 'v1' }))
    await act(async () => { await result.current.checkAndUpload({ ...target, onDirectUpload: vi.fn() }) })
    await act(async () => { await result.current.doUpload({ ...target, area: '南区', overwrite: true, onSuccess: vi.fn() }) })
    act(() => result.current.handleFile(file()))
    await act(async () => { await result.current.doUpload({ ...target, overwrite: true, onSuccess: vi.fn() }) })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result.current.uploadedFile).not.toBeNull()
  })

  it('覆盖 409 保留文件并允许重新检查，失败结果不进入成功回调', async () => {
    const { result } = setup()
    vi.mocked(fetch).mockResolvedValueOnce(response({ success: true, exists: true, etag: 'v1' }))
    await act(async () => { await result.current.checkAndUpload({ ...target, onDirectUpload: vi.fn() }) })
    const success = vi.fn()
    vi.mocked(fetch).mockResolvedValueOnce(response({ error: '照片版本已变化，请重新检查' }, false))
    await act(async () => { expect(await result.current.doUpload({ ...target, overwrite: true, onSuccess: success })).toBe(false) })
    expect(success).not.toHaveBeenCalled()
    expect(result.current.uploadedFile).not.toBeNull()
    vi.mocked(fetch).mockResolvedValueOnce(response({ success: true, exists: true, etag: 'v2' }))
    await act(async () => { await result.current.checkAndUpload({ ...target, onDirectUpload: vi.fn() }) })
    expect(result.current.showOverwriteConfirm).toBe(true)
  })

  it('新照片 create-only；检查和上传期间锁住文件/重复入口且等待 UI 成功回调', async () => {
    const { result } = setup()
    const original = result.current.uploadedFile
    let finishCheck!: (res: Response) => void
    let finishWrite!: (res: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finishCheck = resolve }))
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finishWrite = resolve }))
    const success = vi.fn().mockResolvedValue(undefined)
    let pending!: Promise<void>
    act(() => { pending = result.current.checkAndUpload({ ...target, onDirectUpload: () => result.current.doUpload({ ...target, onSuccess: success }) }) })
    expect(result.current.isUploading).toBe(true)
    act(() => { result.current.clearFile(); result.current.handleFile(file()) })
    expect(result.current.uploadedFile).toBe(original)
    await act(async () => { finishCheck(response({ success: true, exists: false })) })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(result.current.isUploading).toBe(true)
    act(() => result.current.clearFile())
    await act(async () => { await result.current.doUpload({ ...target, onSuccess: success }) })
    expect(fetch).toHaveBeenCalledTimes(2)
    const body = vi.mocked(fetch).mock.calls[1][1]!.body as FormData
    expect(body.has('overwrite')).toBe(false)
    expect(body.has('expectedEtag')).toBe(false)
    await act(async () => { finishWrite(response({ success: true, url: 'saved' })); await pending })
    expect(success).toHaveBeenCalledOnce()
    expect(result.current.isUploading).toBe(false)
    expect(result.current.uploadedFile).toBeNull()
  })

  it('部分错误先刷新对应岩场，保留文件并显示失败', async () => {
    const { result } = setup()
    const partial = vi.fn().mockResolvedValue(undefined)
    const success = vi.fn()
    vi.mocked(fetch).mockResolvedValueOnce(response({ success: false, partial: true, referencesChanged: true, error: '清理待完成' }, false))
    await act(async () => { await result.current.doUpload({ ...target, onSuccess: success, onPartial: partial }) })
    expect(partial).toHaveBeenCalledWith('a')
    expect(success).not.toHaveBeenCalled()
    expect(result.current.uploadedFile).not.toBeNull()
  })
})
