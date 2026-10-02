/**
 * createRequireAuth — shared API route auth helper factory
 *
 * 覆盖场景:
 * - 无 session → 返回 401 NextResponse
 * - session.user 存在但无 role → 默认 'user'
 * - session.user 存在且有 role → 返回对应 role
 * - 返回类型为 AuthInfo (非 NextResponse) 时包含 userId + role
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createRequireAuth, type AuthInstance } from './require-auth'

function createMockAuth(user: Record<string, unknown> | null): AuthInstance {
  return {
    api: {
      getSession: vi.fn().mockResolvedValue(user ? { user } : null),
    },
  }
}

function createRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/test')
}

describe('createRequireAuth', () => {
  let mockAuth: AuthInstance
  let requireAuth: ReturnType<typeof createRequireAuth>

  function setupAuth(user: Record<string, unknown> | null) {
    mockAuth = createMockAuth(user)
    requireAuth = createRequireAuth(async () => mockAuth)
  }

  beforeEach(() => vi.clearAllMocks())

  it('should return 401 when no session', async () => {
    setupAuth(null)
    const result = await requireAuth(createRequest())
    expect(result).toBeInstanceOf(NextResponse)
    const res = result as NextResponse
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBe('未登录')
  })

  it('should return 401 when session has no user', async () => {
    mockAuth = {
      api: {
        getSession: vi.fn().mockResolvedValue({ user: null }),
      },
    }
    requireAuth = createRequireAuth(async () => mockAuth)

    const result = await requireAuth(createRequest())
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(401)
  })

  it('should return 401 when user has no id', async () => {
    setupAuth({ name: 'test' })
    const result = await requireAuth(createRequest())
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(401)
  })

  it('should return AuthInfo with role when session is valid', async () => {
    setupAuth({ id: 'user-123', role: 'admin' })
    const result = await requireAuth(createRequest())
    expect(result).not.toBeInstanceOf(NextResponse)
    expect(result).toEqual({ userId: 'user-123', role: 'admin' })
  })

  it('should default role to user when role is missing', async () => {
    setupAuth({ id: 'user-456' })
    const result = await requireAuth(createRequest())
    expect(result).not.toBeInstanceOf(NextResponse)
    expect(result).toEqual({ userId: 'user-456', role: 'user' })
  })

  it('should default role to user when role is empty string', async () => {
    setupAuth({ id: 'user-789', role: '' })
    const result = await requireAuth(createRequest())
    expect(result).not.toBeInstanceOf(NextResponse)
    expect(result).toEqual({ userId: 'user-789', role: 'user' })
  })

  it('defaults nullable Better Auth roles to user', async () => {
    setupAuth({ id: 'user-null-role', role: null })
    expect(await requireAuth(createRequest())).toEqual({ userId: 'user-null-role', role: 'user' })
  })

  it('should pass request headers to getSession', async () => {
    const mockGetSession = vi.fn().mockResolvedValue({
      user: { id: 'u1', role: 'admin' },
    })
    mockAuth = { api: { getSession: mockGetSession } }
    requireAuth = createRequireAuth(async () => mockAuth)

    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { Authorization: 'Bearer token123' },
    })
    await requireAuth(req)

    expect(mockGetSession).toHaveBeenCalledWith({ headers: req.headers, query: { disableCookieCache: true } })
  })
})
