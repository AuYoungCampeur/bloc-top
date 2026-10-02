import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useClimberBodyData } from './use-climber-body-data'

const auth = vi.hoisted(() => ({
  session: null as { user: { id: string; height?: number; reach?: number }; session?: { id: string } } | null,
  updateUser: vi.fn(),
}))
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: auth.session }),
  authClient: { updateUser: auth.updateUser },
}))
const key = (id?: string) => id ? `climber-body-data:user:${id}` : 'climber-body-data:anonymous'
const login = (id: string, values: { height?: number; reach?: number } = {}, token = id) => {
  auth.session = { user: { id, ...values }, session: { id: token } }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  auth.session = null
  auth.updateUser.mockResolvedValue({ data: {}, error: null })
})

describe('账号归属的攀岩者身体数据缓存', () => {
  it('缺少完整session的过渡数据不会崩溃或触发账号写入', () => {
    auth.session = { user: { id: 'a' } }
    const { result } = renderHook(() => useClimberBodyData())
    expect(result.current.bodyData).toEqual({ height: '', reach: '' })
    act(() => result.current.updateBodyData({ height: '175' }))
    expect(result.current.bodyData.height).toBe('175')
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('保留当前匿名输入、裁剪空格、部分更新和清空，但不自动认领旧全局缓存', () => {
    localStorage.setItem('climber-body-data', JSON.stringify({ height: '190', reach: '200' }))
    const { result } = renderHook(() => useClimberBodyData())
    expect(result.current.bodyData).toEqual({ height: '', reach: '' })
    act(() => result.current.updateBodyData({ height: ' 175 ', reach: '180' }))
    act(() => result.current.updateBodyData({ height: ' ', reach: '185' }))
    expect(result.current.bodyData).toEqual({ height: '175', reach: '185' })
    expect(JSON.parse(localStorage.getItem(key())!)).toEqual(result.current.bodyData)
    expect(auth.updateUser).not.toHaveBeenCalled()
    act(() => result.current.clearBodyData())
    expect(result.current.bodyData).toEqual({ height: '', reach: '' })
    expect(localStorage.getItem(key())).toBeNull()
    expect(localStorage.getItem('climber-body-data')).not.toBeNull()
  })

  it('A→空资料B不会显示A数据，也不会向B自动迁移缓存', () => {
    login('a', { height: 175, reach: 180 })
    const { result, rerender } = renderHook(() => useClimberBodyData())
    expect(result.current.bodyData).toEqual({ height: '175', reach: '180' })
    login('b')
    rerender()
    expect(result.current.bodyData).toEqual({ height: '', reach: '' })
    expect(auth.updateUser).not.toHaveBeenCalled()
    act(() => result.current.updateBodyData({ height: '160', reach: '165' }))
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({ height: 160, reach: 165 })
    expect(JSON.parse(localStorage.getItem(key('a'))!)).toEqual({ height: '175', reach: '180' })
    expect(JSON.parse(localStorage.getItem(key('b'))!)).toEqual({ height: '160', reach: '165' })
  })

  it('每个账号只读取自己的缓存，DB单字段不会拼接匿名或其他账号值', () => {
    localStorage.setItem(key(), JSON.stringify({ height: '195', reach: '200' }))
    localStorage.setItem(key('a'), JSON.stringify({ height: '175', reach: '180' }))
    login('a', { height: 176 })
    const { result, rerender } = renderHook(() => useClimberBodyData())
    expect(result.current.bodyData).toEqual({ height: '176', reach: '180' })
    login('b', { height: 160 })
    rerender()
    expect(result.current.bodyData).toEqual({ height: '160', reach: '' })
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('退出只显示匿名命名空间，重新登录恢复同账号输入，旧会话回调不写新会话', () => {
    login('a')
    const { result, rerender } = renderHook(() => useClimberBodyData())
    act(() => result.current.updateBodyData({ height: '175' }))
    const previousUpdate = result.current.updateBodyData
    auth.session = null
    rerender()
    expect(result.current.bodyData).toEqual({ height: '', reach: '' })
    act(() => result.current.updateBodyData({ height: '150' }))
    login('a', {}, 'new-session')
    rerender()
    expect(result.current.bodyData).toEqual({ height: '175', reach: '' })
    auth.updateUser.mockClear()
    act(() => previousUpdate({ height: '190' }))
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(result.current.bodyData.height).toBe('175')
  })

  it('迟到A提交回调与A更新响应均不能覆盖B当前输入', async () => {
    login('a')
    let resolveA!: (value: object) => void
    auth.updateUser.mockImplementationOnce(() => new Promise(resolve => { resolveA = resolve }))
    const { result, rerender } = renderHook(() => useClimberBodyData())
    const callbackA = result.current.updateBodyData
    act(() => callbackA({ height: '175' }))
    login('b')
    rerender()
    act(() => result.current.updateBodyData({ height: '160' }))
    auth.updateUser.mockClear()
    act(() => callbackA({ height: '190' }))
    await act(async () => resolveA({ data: { user: { id: 'a', height: 175 } }, error: null }))
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(result.current.bodyData).toEqual({ height: '160', reach: '' })
    expect(JSON.parse(localStorage.getItem(key('b'))!).height).toBe('160')
  })

  it('损坏缓存和存储不可用时仍可输入，DB读取不触发写账号', () => {
    localStorage.setItem(key(), 'broken')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useClimberBodyData())
    expect(result.current.bodyData).toEqual({ height: '', reach: '' })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('full') })
    act(() => result.current.updateBodyData({ height: '175' }))
    expect(result.current.bodyData.height).toBe('175')
    vi.restoreAllMocks()
  })
})
