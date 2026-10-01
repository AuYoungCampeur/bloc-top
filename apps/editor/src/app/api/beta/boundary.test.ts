// Exercise the app route with the real shared requireAuth and canEditCrag helpers.
// Only the session provider and Mongo transport are replaced with isolated fixtures.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { BetaLink } from '@bloctop/shared/types'

const fixtures = vi.hoisted(() => ({
  getSession: vi.fn(),
  getDatabase: vi.fn(),
  updateOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
  permissionFindOne: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getAuth: async () => ({ api: { getSession: fixtures.getSession } }) }))
vi.mock('@bloctop/shared/mongodb', () => ({ getDatabase: fixtures.getDatabase }))

import { GET, POST, PATCH, DELETE } from './route'

const beta: BetaLink = {
  id: 'beta-1', platform: 'xiaohongshu', noteId: '6797869e0000000029017615',
  url: 'https://www.xiaohongshu.com/explore/6797869e0000000029017615', author: 'Alice',
}

function request(method: 'POST' | 'PATCH' | 'DELETE', routeId: number, cookie?: string) {
  return new NextRequest('http://localhost:3001/api/beta', {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
    body: JSON.stringify({ routeId, betaId: beta.id, url: beta.url, author: 'Bob' }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  fixtures.getSession.mockImplementation(async ({ headers }: { headers: Headers }) => {
    const token = headers.get('Cookie')?.split('test-session=')[1]
    if (token === 'manager-a') return { user: { id: 'manager-a', role: 'user' } }
    if (token === 'admin') return { user: { id: 'admin', role: 'admin' } }
    return null
  })
  fixtures.permissionFindOne.mockImplementation(async ({ userId, cragId }) =>
    userId === 'manager-a' && cragId === 'crag-a' ? { userId, cragId, role: 'manager' } : null)
  fixtures.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
  fixtures.findOneAndUpdate.mockResolvedValue({ betaLinks: [{ ...beta, author: 'Bob' }] })
  fixtures.getDatabase.mockResolvedValue({
    collection: (name: string) => {
      if (name === 'crag_permissions') return { findOne: fixtures.permissionFindOne }
      if (name === 'crags') return { findOne: async () => null }
      return {
        findOne: async ({ _id }: { _id: number }) => _id === 39
          ? { _id, cragId: 'crag-a', betaLinks: [beta] }
          : _id === 40 ? { _id, cragId: 'crag-b', betaLinks: [beta] } : null,
        updateOne: fixtures.updateOne,
        findOneAndUpdate: fixtures.findOneAndUpdate,
      }
    },
  })
})

describe('Editor Beta route session and crag authorization boundary', () => {
  it.each(['POST', 'PATCH', 'DELETE'] as const)('%s rejects a missing or invalid session before database access', async method => {
    for (const cookie of [undefined, 'test-session=invalid']) {
      const response = await ({ POST, PATCH, DELETE })[method](request(method, 39, cookie))
      expect(response.status).toBe(401)
    }
    expect(fixtures.getDatabase).not.toHaveBeenCalled()
  })

  it.each(['PATCH', 'DELETE'] as const)('%s denies the manager when the route belongs to another crag', async method => {
    const response = await ({ PATCH, DELETE })[method](request(method, 40, 'test-session=manager-a'))
    expect(response.status).toBe(403)
    expect(fixtures.permissionFindOne).toHaveBeenCalledWith({ userId: 'manager-a', cragId: 'crag-b' })
    expect(fixtures.updateOne).not.toHaveBeenCalled()
    expect(fixtures.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('allows the assigned manager to edit a Beta and returns the authoritative record', async () => {
    const response = await PATCH(request('PATCH', 39, 'test-session=manager-a'))
    expect(response.status).toBe(200)
    expect(fixtures.permissionFindOne).toHaveBeenCalledWith({ userId: 'manager-a', cragId: 'crag-a' })
    expect((await response.json()).beta).toMatchObject({ id: beta.id, author: 'Bob' })
  })

  it('allows admin management without a crag assignment', async () => {
    const response = await DELETE(request('DELETE', 40, 'test-session=admin'))
    expect(response.status).toBe(200)
    expect(fixtures.permissionFindOne).not.toHaveBeenCalled()
    expect(fixtures.updateOne.mock.calls[0][0]).toEqual({ _id: 40, cragId: 'crag-b', 'betaLinks.id': beta.id })
  })

  it('keeps GET public even when there is no session', async () => {
    const response = await GET(new NextRequest('http://localhost:3001/api/beta?routeId=39'))
    expect(response.status).toBe(200)
    expect(fixtures.getSession).not.toHaveBeenCalled()
    expect(response.headers.get('Cache-Control')).toBe('no-store, max-age=0')
  })
})
