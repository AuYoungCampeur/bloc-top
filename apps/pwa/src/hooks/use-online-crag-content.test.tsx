import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOnlineCragContent } from './use-online-crag-content'
import { readFreshCragContent, type OnlineCragContent } from '@/lib/online-crag-content'
import type { Crag, Route } from '@/types'

vi.mock('@/lib/online-crag-content', () => ({ readFreshCragContent: vi.fn() }))
const packet = (id: string, revision: string, topoVersion: number): OnlineCragContent => ({
  crag: { id, mediaRevision: revision } as Crag,
  routes: [{ id: 1, cragId: id, topoVersion }] as Route[],
})
beforeEach(() => { vi.mocked(readFreshCragContent).mockReset(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true) })
afterEach(() => vi.restoreAllMocks())

describe('online reading lifecycle', () => {
  it('keeps the old packet until the complete refresh resolves; failure retains it', async () => {
    const seed = packet('a', 'one', 1), fresh = packet('a', 'two', 2)
    let resolve!: (value: OnlineCragContent) => void
    vi.mocked(readFreshCragContent).mockReturnValueOnce(new Promise(done => { resolve = done }))
    const { result } = renderHook(() => useOnlineCragContent('a', seed))
    expect(result.current).toBe(seed)
    await act(async () => resolve(fresh))
    expect(result.current).toBe(fresh)
    vi.mocked(readFreshCragContent).mockRejectedValueOnce(new Error('unavailable'))
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(result.current).toBe(fresh)
    expect(readFreshCragContent).toHaveBeenCalledTimes(2)
  })

  it('new SSR props replace an old completed packet and trigger a fresh read', async () => {
    const old = packet('a', 'one', 1), fresh = packet('a', 'two', 2), newSSR = packet('a', 'three', 3)
    vi.mocked(readFreshCragContent).mockResolvedValueOnce(fresh)
    const { result, rerender } = renderHook(({ seed }) => useOnlineCragContent('a', seed), { initialProps: { seed: old } })
    await waitFor(() => expect(result.current).toBe(fresh))
    vi.mocked(readFreshCragContent).mockReturnValueOnce(new Promise(() => {}))
    rerender({ seed: newSSR })
    expect(result.current).toBe(newSSR)
    expect(readFreshCragContent).toHaveBeenCalledTimes(2)
    expect(readFreshCragContent).toHaveBeenLastCalledWith('a', true)
  })

  it('ignores a late A result after switching to B', async () => {
    let resolve!: (value: OnlineCragContent) => void
    vi.mocked(readFreshCragContent).mockReturnValueOnce(new Promise(done => { resolve = done }))
      .mockResolvedValueOnce(packet('b', 'b-two', 2))
    const a = packet('a', 'a-one', 1), b = packet('b', 'b-one', 1)
    const { result, rerender } = renderHook(({ seed }) => useOnlineCragContent(seed.crag.id, seed), { initialProps: { seed: a } })
    rerender({ seed: b })
    await waitFor(() => expect(result.current?.crag.mediaRevision).toBe('b-two'))
    await act(async () => resolve(packet('a', 'a-two', 2)))
    expect(result.current?.crag.id).toBe('b')
  })

  it('late pre-navigation data cannot overwrite newer SSR props for the same crag', async () => {
    let releaseOld!: (value: OnlineCragContent) => void
    let releaseNew!: (value: OnlineCragContent) => void
    vi.mocked(readFreshCragContent).mockReturnValueOnce(new Promise(done => { releaseOld = done }))
      .mockReturnValueOnce(new Promise(done => { releaseNew = done }))
    const one = packet('same-crag', 'one', 1), three = packet('same-crag', 'three', 3)
    const { result, rerender } = renderHook(({ seed }) => useOnlineCragContent(seed.crag.id, seed), { initialProps: { seed: one } })
    rerender({ seed: three })
    expect(readFreshCragContent).toHaveBeenLastCalledWith('same-crag', true)
    await act(async () => releaseOld(packet('same-crag', 'two', 2)))
    expect(result.current).toBe(three)
    await act(async () => releaseNew(packet('same-crag', 'four', 4)))
    expect(result.current?.crag.mediaRevision).toBe('four')
  })

  it('skips offline/hidden reads, then retries on foreground/online and stops after unmount', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const seed = packet('a', 'one', 1)
    vi.mocked(readFreshCragContent).mockResolvedValue(seed)
    const { unmount } = renderHook(() => useOnlineCragContent('a', seed))
    expect(readFreshCragContent).not.toHaveBeenCalled()
    online.mockReturnValue(true)
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => window.dispatchEvent(new Event('online')))
    expect(readFreshCragContent).not.toHaveBeenCalled()
    visibility.mockReturnValue('visible')
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(readFreshCragContent).toHaveBeenCalledTimes(1)
    unmount()
    window.dispatchEvent(new Event('focus'))
    expect(readFreshCragContent).toHaveBeenCalledTimes(1)
  })
})
