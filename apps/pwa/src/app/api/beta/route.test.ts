import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/mongodb', () => ({ getDatabase: vi.fn() }))
vi.mock('@/lib/require-auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  createModuleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { getDatabase } from '@/lib/mongodb'
import { requireAuth } from '@/lib/require-auth'
import { GET, POST } from './route'

beforeEach(() => vi.clearAllMocks())

it('PWA Beta 提交入口保留登录校验，未登录不访问数据库', async () => {
  vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ success: false, error: '未登录' }, { status: 401 }))
  const response = await POST(new NextRequest('http://localhost:3000/api/beta', {
    method: 'POST',
    body: JSON.stringify({ routeId: 39, url: 'https://www.xiaohongshu.com/explore/6797869e0000000029017615' }),
  }))
  expect(response.status).toBe(401)
  expect(getDatabase).not.toHaveBeenCalled()
})

describe('GET /api/beta', () => {
  it('从数据库读取 Beta 且禁止 HTTP 缓存', async () => {
    const beta = { id: 'beta-1', noteId: '6797869e0000000029017615' }
    const findOne = vi.fn().mockResolvedValue({ betaLinks: [beta] })
    vi.mocked(getDatabase).mockResolvedValue({
      collection: () => ({ findOne }),
    } as unknown as Awaited<ReturnType<typeof getDatabase>>)

    const response = await GET(new NextRequest('http://localhost:3000/api/beta?routeId=39'))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0')
    expect(findOne).toHaveBeenCalledWith({ _id: 39 }, { projection: { betaLinks: 1 } })
    expect((await response.json()).betaLinks).toEqual([beta])
  })
})
