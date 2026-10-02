/**
 * /api/crag-permissions — 岩场权限管理 (admin-only)
 *
 * 覆盖场景:
 * GET: 获取权限列表 (401/400/403/200)
 * POST: 分配权限 (401/400/403/201/409)
 * DELETE: 移除权限 (401/400/403/404/200)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { ObjectId } from 'mongodb'

vi.mock('@/lib/db', () => ({
  getCragPermissionsByCragId: vi.fn(),
  getCragById: vi.fn(async () => ({ id: 'crag-1' })),
  createCragPermission: vi.fn(),
  deleteCragPermission: vi.fn(),
}))

vi.mock('@/lib/require-auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/permissions', () => ({
  canManagePermissions: vi.fn(),
}))

const mockToArray = vi.fn()
const mockProject = vi.fn(() => ({ toArray: mockToArray }))
const mockFind = vi.fn(() => ({ project: mockProject }))
const mockCollection = vi.fn(() => ({ find: mockFind, findOne: vi.fn(async () => ({ _id: new ObjectId('507f1f77bcf86cd799439012') })) }))
const mockDb = { collection: mockCollection }

vi.mock('@/lib/mongodb', () => ({
  getDatabase: vi.fn(() => Promise.resolve(mockDb)),
}))

vi.mock('@/lib/logger', () => ({
  createModuleLogger: () => ({
    info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
  }),
}))

import { GET, POST, DELETE } from './route'
import { requireAuth } from '@/lib/require-auth'
import { canManagePermissions } from '@/lib/permissions'
import { getCragPermissionsByCragId, createCragPermission, deleteCragPermission } from '@/lib/db'

const mockRequireAuth = vi.mocked(requireAuth)
const mockCanManagePermissions = vi.mocked(canManagePermissions)
const mockGetPerms = vi.mocked(getCragPermissionsByCragId)
const mockCreatePerm = vi.mocked(createCragPermission)
const mockDeletePerm = vi.mocked(deleteCragPermission)

function createGetRequest(cragId?: string): NextRequest {
  const url = cragId
    ? `http://localhost:3000/api/crag-permissions?cragId=${cragId}`
    : 'http://localhost:3000/api/crag-permissions'
  return new NextRequest(url)
}

function createBodyRequest(method: string, body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/crag-permissions', {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('GET /api/crag-permissions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return 401 when not authenticated', async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ success: false }, { status: 401 })
    )
    const res = await GET(createGetRequest('crag-1'))
    expect(res.status).toBe(401)
  })

  it('should return 400 when cragId is missing', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'admin1', role: 'admin' })
    const res = await GET(createGetRequest())
    expect(res.status).toBe(400)
  })

  it('should return 403 when user cannot manage permissions', async () => {
    mockRequireAuth.mockResolvedValue({ userId: '507f1f77bcf86cd799439012', role: 'user' })
    mockCanManagePermissions.mockResolvedValue(false)
    const res = await GET(createGetRequest('crag-1'))
    expect(res.status).toBe(403)
  })

  it('should return enriched permissions for admin', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'admin1', role: 'admin' })
    mockCanManagePermissions.mockResolvedValue(true)
    mockGetPerms.mockResolvedValue([
      { userId: '507f1f77bcf86cd799439012', cragId: 'crag-1', role: 'manager', assignedBy: 'admin1', createdAt: new Date() },
    ])
    mockToArray.mockResolvedValue([
      { _id: new ObjectId('507f1f77bcf86cd799439012'), name: 'Alice', email: 'alice@test.com' },
    ])

    const res = await GET(createGetRequest('crag-1'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.permissions).toHaveLength(1)
    expect(data.permissions[0].user.name).toBe('Alice')
  })

  it('should return empty when no permissions', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'admin1', role: 'admin' })
    mockCanManagePermissions.mockResolvedValue(true)
    mockGetPerms.mockResolvedValue([])

    const res = await GET(createGetRequest('crag-1'))
    const data = await res.json()
    expect(data.permissions).toEqual([])
  })
})

describe('POST /api/crag-permissions', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    null, [], { userId: { $ne: null }, cragId: 'c1', role: 'manager' },
    { userId: '507f1f77bcf86cd799439012', cragId: { $ne: null }, role: 'manager' },
    { userId: '507f1f77bcf86cd799439012', cragId: 'c1', role: ['manager'] },
  ])('rejects invalid admin assignments %j without writing grants', async body => {
    mockRequireAuth.mockResolvedValue({ userId: 'admin1', role: 'admin' })
    mockCanManagePermissions.mockResolvedValue(true)
    expect((await POST(createBodyRequest('POST', body))).status).toBe(400)
    expect(mockCreatePerm).not.toHaveBeenCalled()
  })

  it('should return 401 when not authenticated', async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ success: false }, { status: 401 })
    )
    const res = await POST(createBodyRequest('POST', {}))
    expect(res.status).toBe(401)
  })

  it('should return 400 when fields are missing', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'admin1', role: 'admin' })
    const res = await POST(createBodyRequest('POST', { userId: '507f1f77bcf86cd799439012' }))
    expect(res.status).toBe(400)
  })

  it('should return 400 for invalid role', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'admin1', role: 'admin' })
    const res = await POST(createBodyRequest('POST', { userId: '507f1f77bcf86cd799439012', cragId: 'c1', role: 'invalid' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('角色无效')
  })

  it('should return 403 when user cannot manage permissions', async () => {
    mockRequireAuth.mockResolvedValue({ userId: '507f1f77bcf86cd799439012', role: 'user' })
    mockCanManagePermissions.mockResolvedValue(false)
    const res = await POST(createBodyRequest('POST', { userId: '507f1f77bcf86cd799439013', cragId: 'c1', role: 'manager' }))
    expect(res.status).toBe(403)
  })

  it('should create permission and return 201', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'admin1', role: 'admin' })
    mockCanManagePermissions.mockResolvedValue(true)
    mockCreatePerm.mockResolvedValue({
      userId: '507f1f77bcf86cd799439012', cragId: 'c1', role: 'manager', assignedBy: 'admin1', createdAt: new Date(),
    })

    const res = await POST(createBodyRequest('POST', { userId: '507f1f77bcf86cd799439012', cragId: 'c1', role: 'manager' }))
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('should return 409 when permission already exists', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'admin1', role: 'admin' })
    mockCanManagePermissions.mockResolvedValue(true)
    mockCreatePerm.mockRejectedValue(new Error('已存在'))

    const res = await POST(createBodyRequest('POST', { userId: '507f1f77bcf86cd799439012', cragId: 'c1', role: 'manager' }))
    expect(res.status).toBe(409)
  })
})

describe('DELETE /api/crag-permissions', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    null, [], { userId: { $ne: null }, cragId: { $ne: null } },
    { userId: '507f1f77bcf86cd799439012', cragId: { $ne: null } }, { userId: ['507f1f77bcf86cd799439012'], cragId: 'c1' },
    { userId: 123, cragId: 'c1' }, { userId: ' ', cragId: 'c1' },
  ])('rejects unsafe admin input %j with 400 and no permission operations', async body => {
    mockRequireAuth.mockResolvedValue({ userId: 'admin1', role: 'admin' })
    mockCanManagePermissions.mockResolvedValue(true)
    expect((await DELETE(createBodyRequest('DELETE', body))).status).toBe(400)
    expect(mockCanManagePermissions).not.toHaveBeenCalled()
    expect(mockDeletePerm).not.toHaveBeenCalled()
  })

  it('should return 401 when not authenticated', async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ success: false }, { status: 401 })
    )
    const res = await DELETE(createBodyRequest('DELETE', {}))
    expect(res.status).toBe(401)
  })

  it('should return 400 when fields are missing', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'admin1', role: 'admin' })
    const res = await DELETE(createBodyRequest('DELETE', { userId: '507f1f77bcf86cd799439012' }))
    expect(res.status).toBe(400)
  })

  it('should return 403 when cannot manage permissions', async () => {
    mockRequireAuth.mockResolvedValue({ userId: '507f1f77bcf86cd799439012', role: 'user' })
    mockCanManagePermissions.mockResolvedValue(false)
    const res = await DELETE(createBodyRequest('DELETE', { userId: '507f1f77bcf86cd799439013', cragId: 'c1' }))
    expect(res.status).toBe(403)
  })

  it('should return 404 when permission not found', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'admin1', role: 'admin' })
    mockCanManagePermissions.mockResolvedValue(true)
    mockDeletePerm.mockResolvedValue(false)

    const res = await DELETE(createBodyRequest('DELETE', { userId: '507f1f77bcf86cd799439012', cragId: 'c1' }))
    expect(res.status).toBe(404)
  })

  it('should delete permission and return 200', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'admin1', role: 'admin' })
    mockCanManagePermissions.mockResolvedValue(true)
    mockDeletePerm.mockResolvedValue(true)

    const res = await DELETE(createBodyRequest('DELETE', { userId: '507f1f77bcf86cd799439012', cragId: 'c1' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
  })
})
