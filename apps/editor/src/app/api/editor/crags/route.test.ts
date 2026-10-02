import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { canAccessEditor } from '@bloctop/shared/permissions'

const fixtures = vi.hoisted(() => ({
  userId: 'user-a',
  role: 'user' as 'user' | 'admin',
  authenticated: true,
  crags: [
    { id: 'granted', name: '授权岩场', cityId: 'city' },
    { id: 'created', name: '创建者岩场', cityId: 'city', createdBy: 'user-a' },
    { id: 'other', name: '其他岩场', cityId: 'city', createdBy: 'user-b' },
  ],
  permissions: [
    { userId: 'user-a', cragId: 'granted', role: 'manager', assignedBy: 'admin', createdAt: new Date() },
    { userId: 'user-a', cragId: 'deleted', role: 'manager', assignedBy: 'admin', createdAt: new Date() },
  ],
}))
vi.mock('@/lib/require-auth', () => ({ requireAuth: vi.fn(async () => fixtures.authenticated
  ? { userId: fixtures.userId, role: fixtures.role }
  : NextResponse.json({ error: '未登录' }, { status: 401 })) }))
vi.mock('@bloctop/shared/mongodb', () => ({ getDatabase: vi.fn(async () => ({
  collection: (name: string) => ({ find: (query: { userId?: string; $or?: Array<{ _id?: { $in: string[] }; createdBy?: string }> }) => ({
    toArray: async () => name === 'crag_permissions'
      ? fixtures.permissions.filter(p => p.userId === query.userId)
      : fixtures.crags.filter(c => query.$or?.some(condition => condition._id?.$in.includes(c.id)
        || ('createdBy' in c && c.createdBy === condition.createdBy))).map(c => ({ _id: c.id })),
  }) }),
})) }))
vi.mock('@bloctop/shared/db', () => ({
  getAllCrags: vi.fn(async () => fixtures.crags),
  getCragPermissionsByUserId: vi.fn(async (userId: string) => fixtures.permissions.filter(p => p.userId === userId)),
}))
import { GET } from './route'

beforeEach(() => {
  fixtures.userId = 'user-a'
  fixtures.role = 'user'
  fixtures.authenticated = true
})

describe('EDITOR 可编辑岩场列表与真实共享入口权限', () => {
  it('创建者无grant也能进入和看到岩场，以manager展示；孤儿grant不生成岩场', async () => {
    expect(await canAccessEditor(fixtures.userId, fixtures.role)).toBe(true)
    const response = await GET(new NextRequest('http://localhost:3000/api/editor/crags'))
    const data = await response.json()
    expect(data.crags.map((c: { id: string }) => c.id)).toEqual(['granted', 'created'])
    expect(data.crags.every((c: { permissionRole: string }) => c.permissionRole === 'manager')).toBe(true)
    expect(data.role).toBe('user')
    expect(data.canCreate).toBe(false)
  })

  it('admin可见全部，保留已有岩场manager展示，其余显示admin', async () => {
    fixtures.role = 'admin'
    const response = await GET(new NextRequest('http://localhost:3000/api/editor/crags'))
    const data = await response.json()
    expect(data.crags.map((c: { permissionRole: string }) => c.permissionRole)).toEqual(['manager', 'admin', 'admin'])
    expect(data.canCreate).toBe(true)
  })

  it('无授权且非创建者不显示入口或任何岩场', async () => {
    fixtures.userId = 'unprivileged'
    expect(await canAccessEditor(fixtures.userId, fixtures.role)).toBe(false)
    const response = await GET(new NextRequest('http://localhost:3000/api/editor/crags'))
    expect((await response.json()).crags).toEqual([])
  })

  it('未登录拒绝读取', async () => {
    fixtures.authenticated = false
    expect((await GET(new NextRequest('http://localhost:3000/api/editor/crags'))).status).toBe(401)
  })
})
