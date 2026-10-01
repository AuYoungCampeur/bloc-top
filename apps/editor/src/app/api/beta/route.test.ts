import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@bloctop/shared/mongodb', () => ({ getDatabase: vi.fn() }))
vi.mock('@bloctop/shared/permissions', () => ({ canEditCrag: vi.fn() }))
vi.mock('@/lib/require-auth', () => ({ requireAuth: vi.fn() }))

import { getDatabase } from '@bloctop/shared/mongodb'
import { requireAuth } from '@/lib/require-auth'
import { GET, POST } from './route'

beforeEach(() => vi.clearAllMocks())

describe('Editor shared Beta API wiring', () => {
  it('rejects unauthenticated submissions before database access', async () => {
    vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ success: false, error: '未登录' }, { status: 401 }))
    const response = await POST(new NextRequest('http://localhost:3001/api/beta', {
      method: 'POST',
      body: JSON.stringify({ routeId: 39, url: 'https://www.xiaohongshu.com/explore/6797869e0000000029017615' }),
    }))
    expect(response.status).toBe(401)
    expect(getDatabase).not.toHaveBeenCalled()
  })

  it('keeps public reads fresh through the Editor database dependency', async () => {
    const beta = { id: 'beta-1', noteId: '6797869e0000000029017615' }
    const findOne = vi.fn().mockResolvedValue({ betaLinks: [beta] })
    vi.mocked(getDatabase).mockResolvedValue({ collection: () => ({ findOne }) } as unknown as Awaited<ReturnType<typeof getDatabase>>)
    const response = await GET(new NextRequest('http://localhost:3001/api/beta?routeId=39'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store, max-age=0')
    expect((await response.json()).betaLinks).toEqual([beta])
    expect(findOne).toHaveBeenCalledWith({ _id: 39 }, { projection: { betaLinks: 1 } })
    expect(requireAuth).not.toHaveBeenCalled()
  })
})
