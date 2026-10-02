/**
 * /api/routes/[id] — 线路详情 GET / PATCH / DELETE
 *
 * 覆盖场景:
 * GET: 获取线路 (200/400/404/500)
 * PATCH: 更新线路 (401/400/403/404/200) + topoLine/faceId 验证
 * DELETE: 删除线路 (401/400/403/404/200)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import type { Route } from '@bloctop/shared/types'

vi.mock('@/lib/revalidate-pwa', () => ({ revalidateCragPages: vi.fn() }))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@bloctop/shared/db', () => ({
  getRouteById: vi.fn(),
  updateRoute: vi.fn(),
  deleteRoute: vi.fn(),
}))

vi.mock('@/lib/require-auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@bloctop/shared/permissions', () => ({
  canEditCrag: vi.fn(),
}))

vi.mock('@bloctop/shared/logger', () => ({
  createModuleLogger: () => ({
    info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
  }),
}))

import { GET, PATCH, DELETE } from './route'
import { requireAuth } from '@/lib/require-auth'
import { canEditCrag } from '@bloctop/shared/permissions'
import { getRouteById, updateRoute, deleteRoute } from '@bloctop/shared/db'

const mockRequireAuth = vi.mocked(requireAuth)
const mockCanEditCrag = vi.mocked(canEditCrag)
const mockGetRouteById = vi.mocked(getRouteById)
const mockUpdateRoute = vi.mocked(updateRoute)
const mockDeleteRoute = vi.mocked(deleteRoute)

const SAMPLE_ROUTE: Route = {
  id: 42, name: '线路A', grade: 'V3', cragId: 'crag-1', area: 'A',
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function createGetRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/routes/42')
}

function createPatchRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/routes/42', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function createDeleteRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/routes/42', { method: 'DELETE' })
}

describe('GET /api/routes/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return route when found', async () => {
    mockGetRouteById.mockResolvedValue(SAMPLE_ROUTE)
    const res = await GET(createGetRequest(), makeParams('42'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.route.id).toBe(42)
  })

  it('should return 400 for invalid id', async () => {
    const res = await GET(createGetRequest(), makeParams('abc'))
    expect(res.status).toBe(400)
  })

  it('should return 404 when not found', async () => {
    mockGetRouteById.mockResolvedValue(null)
    const res = await GET(createGetRequest(), makeParams('999'))
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/routes/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return 401 when not authenticated', async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ success: false }, { status: 401 })
    )
    const res = await PATCH(createPatchRequest({}), makeParams('42'))
    expect(res.status).toBe(401)
  })

  it('should return 400 for invalid id', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin' })
    const res = await PATCH(createPatchRequest({ name: 'x' }), makeParams('abc'))
    expect(res.status).toBe(400)
  })

  it('should return 404 when route not found', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin' })
    mockGetRouteById.mockResolvedValue(null)
    const res = await PATCH(createPatchRequest({ name: 'x' }), makeParams('999'))
    expect(res.status).toBe(404)
  })

  it('should return 403 when user cannot edit crag', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'user' })
    mockGetRouteById.mockResolvedValue(SAMPLE_ROUTE)
    mockCanEditCrag.mockResolvedValue(false)
    const res = await PATCH(createPatchRequest({ name: 'x' }), makeParams('42'))
    expect(res.status).toBe(403)
  })

  it('should return 400 when no updatable fields', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin' })
    mockGetRouteById.mockResolvedValue(SAMPLE_ROUTE)
    mockCanEditCrag.mockResolvedValue(true)
    const res = await PATCH(createPatchRequest({ invalidField: 'x' }), makeParams('42'))
    expect(res.status).toBe(400)
  })

  it('should update route name and return 200', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin' })
    mockGetRouteById.mockResolvedValue(SAMPLE_ROUTE)
    mockCanEditCrag.mockResolvedValue(true)
    mockUpdateRoute.mockResolvedValue({ ...SAMPLE_ROUTE, name: '新名' })

    const res = await PATCH(createPatchRequest({ name: '新名' }), makeParams('42'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.route.name).toBe('新名')
  })

  it('should validate topoLine format', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin' })
    mockGetRouteById.mockResolvedValue(SAMPLE_ROUTE)
    mockCanEditCrag.mockResolvedValue(true)

    // Invalid: x > 1
    const res = await PATCH(createPatchRequest({ topoLine: [{ x: 2, y: 0.5 }] }), makeParams('42'))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Topo')
  })

  it('should accept valid topoLine', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin' })
    mockGetRouteById.mockResolvedValue(SAMPLE_ROUTE)
    mockCanEditCrag.mockResolvedValue(true)
    mockUpdateRoute.mockResolvedValue(SAMPLE_ROUTE)

    const res = await PATCH(createPatchRequest({ topoLine: [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.8 }] }), makeParams('42'))
    expect(res.status).toBe(200)
  })

  it('should allow clearing topoLine with null', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin' })
    mockGetRouteById.mockResolvedValue(SAMPLE_ROUTE)
    mockCanEditCrag.mockResolvedValue(true)
    mockUpdateRoute.mockResolvedValue(SAMPLE_ROUTE)

    const res = await PATCH(createPatchRequest({ topoLine: null }), makeParams('42'))
    expect(res.status).toBe(200)
    expect(mockUpdateRoute).toHaveBeenCalledWith(42, expect.objectContaining({ topoLine: undefined }))
  })

  it('projects the first annotation region independently of the route category', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'user1', role: 'user' })
    mockGetRouteById.mockResolvedValue(SAMPLE_ROUTE)
    mockCanEditCrag.mockResolvedValue(true)
    const annotations = [
      { faceId: 'wall', area: 'B', topoLine: [{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.5 }] },
      { faceId: 'wall', area: 'C', topoLine: [{ x: 0.2, y: 0.3 }, { x: 0.5, y: 0.6 }] },
    ]
    mockUpdateRoute.mockResolvedValue({ ...SAMPLE_ROUTE, topoAnnotations: annotations, faceId: 'wall', faceArea: 'B', topoLine: annotations[0].topoLine })
    const response = await PATCH(createPatchRequest({ topoAnnotations: annotations, faceId: 'incorrect', topoLine: [] }), makeParams('42'))
    expect(response.status).toBe(200)
    expect(mockUpdateRoute).toHaveBeenCalledWith(42, expect.objectContaining({ topoAnnotations: annotations, faceId: 'wall', faceArea: 'B', topoLine: annotations[0].topoLine }))
    expect((await response.json()).route.area).toBe('A')
  })

  it('empty arrays truly request removal of all legacy projection fields', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'user1', role: 'user' })
    mockGetRouteById.mockResolvedValue(SAMPLE_ROUTE)
    mockCanEditCrag.mockResolvedValue(true)
    mockUpdateRoute.mockResolvedValue({ ...SAMPLE_ROUTE, topoAnnotations: [] })
    const response = await PATCH(createPatchRequest({ topoAnnotations: [] }), makeParams('42'))
    expect(response.status).toBe(200)
    expect(mockUpdateRoute).toHaveBeenCalledWith(42, expect.objectContaining({ topoAnnotations: [], faceId: undefined, faceArea: undefined, topoLine: undefined, topoTension: undefined }))
  })

  it.each([null, { faceId: 'wall', area: 'B', topoLine: [] }])('rejects malformed new annotations with 400: %j', async invalid => {
    mockRequireAuth.mockResolvedValue({ userId: 'user1', role: 'user' })
    mockGetRouteById.mockResolvedValue(SAMPLE_ROUTE)
    mockCanEditCrag.mockResolvedValue(true)
    const response = await PATCH(createPatchRequest({ topoAnnotations: [invalid] }), makeParams('42'))
    expect(response.status).toBe(400)
    expect(mockUpdateRoute).not.toHaveBeenCalled()
  })

  it.each(['42junk', '0', '-1', '9007199254740992'])('rejects malformed route IDs before DB access: %s', async id => {
    mockRequireAuth.mockResolvedValue({ userId: 'user1', role: 'user' })
    expect((await PATCH(createPatchRequest({ name: 'change' }), makeParams(id))).status).toBe(400)
    expect(mockGetRouteById).not.toHaveBeenCalled()
  })

  it('should validate faceId format', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin' })
    mockGetRouteById.mockResolvedValue(SAMPLE_ROUTE)
    mockCanEditCrag.mockResolvedValue(true)

    const res = await PATCH(createPatchRequest({ faceId: 'INVALID_UPPERCASE' }), makeParams('42'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('faceId')
  })
})

describe('DELETE /api/routes/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return 401 when not authenticated', async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ success: false }, { status: 401 })
    )
    const res = await DELETE(createDeleteRequest(), makeParams('42'))
    expect(res.status).toBe(401)
  })

  it('should return 400 for invalid id', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin' })
    const res = await DELETE(createDeleteRequest(), makeParams('abc'))
    expect(res.status).toBe(400)
  })

  it('should return 404 when route not found', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin' })
    mockGetRouteById.mockResolvedValue(null)
    const res = await DELETE(createDeleteRequest(), makeParams('999'))
    expect(res.status).toBe(404)
  })

  it('should return 403 when user cannot edit crag', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'user' })
    mockGetRouteById.mockResolvedValue(SAMPLE_ROUTE)
    mockCanEditCrag.mockResolvedValue(false)
    const res = await DELETE(createDeleteRequest(), makeParams('42'))
    expect(res.status).toBe(403)
  })

  it('should delete route and return 200', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin' })
    mockGetRouteById.mockResolvedValue(SAMPLE_ROUTE)
    mockCanEditCrag.mockResolvedValue(true)
    mockDeleteRoute.mockResolvedValue(true)

    const res = await DELETE(createDeleteRequest(), makeParams('42'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
  })
})
