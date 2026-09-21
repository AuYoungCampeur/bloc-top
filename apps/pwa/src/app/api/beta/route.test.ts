import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/mongodb', () => ({ getDatabase: vi.fn() }))
vi.mock('@/lib/require-auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  createModuleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { getDatabase } from '@/lib/mongodb'
import { GET } from './route'

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
