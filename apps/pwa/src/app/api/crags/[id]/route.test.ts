/**
 * /api/crags/[id] — 岩场详情 GET + PATCH
 *
 * 覆盖场景:
 * GET: 获取岩场 (200/404/500)
 * PATCH: 更新岩场 (401/403/400/404/200/500)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import type { Crag } from '@/types'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getCragById: vi.fn(),
  updateCrag: vi.fn(),
}))

vi.mock('@/lib/require-auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/permissions', () => ({
  canEditCrag: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  createModuleLogger: () => ({
    info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
  }),
}))

import { GET, PATCH } from './route'
import { requireAuth } from '@/lib/require-auth'
import { canEditCrag } from '@/lib/permissions'
import { getCragById, updateCrag } from '@/lib/db'

const mockRequireAuth = vi.mocked(requireAuth)
const mockCanEditCrag = vi.mocked(canEditCrag)
const mockGetCragById = vi.mocked(getCragById)
const mockUpdateCrag = vi.mocked(updateCrag)

const SAMPLE_CRAG: Crag = {
  id: 'yuan-tong-si',
  name: '源通寺',
  cityId: 'luoyuan',
  location: '福州',
  developmentTime: '2024',
  description: '描述',
  approach: '方法',
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function createGetRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/crags/yuan-tong-si')
}

function createPatchRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/crags/yuan-tong-si', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('GET /api/crags/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return crag when found', async () => {
    mockGetCragById.mockResolvedValue(SAMPLE_CRAG)
    const res = await GET(createGetRequest(), makeParams('yuan-tong-si'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.crag.id).toBe('yuan-tong-si')
  })

  it('should return 404 when not found', async () => {
    mockGetCragById.mockResolvedValue(null)
    const res = await GET(createGetRequest(), makeParams('nonexistent'))
    expect(res.status).toBe(404)
  })

  it('should return 500 on database error', async () => {
    mockGetCragById.mockRejectedValue(new Error('DB error'))
    const res = await GET(createGetRequest(), makeParams('yuan-tong-si'))
    expect(res.status).toBe(500)
  })
})

describe('PATCH /api/crags/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return 401 when not authenticated', async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ success: false }, { status: 401 })
    )
    const res = await PATCH(createPatchRequest({}), makeParams('yuan-tong-si'))
    expect(res.status).toBe(401)
  })

  it('should return 403 when user cannot edit', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'user' })
    mockCanEditCrag.mockResolvedValue(false)
    const res = await PATCH(createPatchRequest({ name: '新名' }), makeParams('yuan-tong-si'))
    expect(res.status).toBe(403)
  })

  it('should return 400 when no valid fields provided', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin' })
    mockCanEditCrag.mockResolvedValue(true)
    const res = await PATCH(createPatchRequest({ invalidField: 'x' }), makeParams('yuan-tong-si'))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('没有可更新的字段')
  })

  it('should update crag with allowed fields only', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin' })
    mockCanEditCrag.mockResolvedValue(true)
    mockUpdateCrag.mockResolvedValue({ ...SAMPLE_CRAG, name: '新名字' })

    const res = await PATCH(
      createPatchRequest({ name: '新名字', secretField: 'x' }),
      makeParams('yuan-tong-si')
    )
    expect(res.status).toBe(200)
    // Should only pass allowed fields to updateCrag
    expect(mockUpdateCrag).toHaveBeenCalledWith('yuan-tong-si', { name: '新名字' })
  })

  it('rejects an identity change together with metadata and makes no partial update', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin' })
    mockCanEditCrag.mockResolvedValue(true)
    const res = await PATCH(createPatchRequest({ name: '新名字', id: 'hacked' }), makeParams('yuan-tong-si'))
    expect(res.status).toBe(400)
    expect(mockUpdateCrag).not.toHaveBeenCalled()
  })

  it('should return 404 when crag not found for update', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin' })
    mockCanEditCrag.mockResolvedValue(true)
    mockUpdateCrag.mockResolvedValue(null)

    const res = await PATCH(createPatchRequest({ name: '新名' }), makeParams('nonexistent'))
    expect(res.status).toBe(404)
  })

  it('should return 500 on database error', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin' })
    mockCanEditCrag.mockResolvedValue(true)
    mockUpdateCrag.mockRejectedValue(new Error('DB error'))

    const res = await PATCH(createPatchRequest({ name: '新名' }), makeParams('yuan-tong-si'))
    expect(res.status).toBe(500)
  })
})
