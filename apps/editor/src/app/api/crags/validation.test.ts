import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ObjectId } from 'mongodb'

const fixtures = vi.hoisted(() => ({
  session: { user: { id: '507f1f77bcf86cd799439011', role: 'admin' } } as { user: { id: string; role: string } } | null,
  cities: vi.fn(), crag: vi.fn(), create: vi.fn(), update: vi.fn(),
  createPermission: vi.fn(), deletePermission: vi.fn(), permissions: vi.fn(), user: vi.fn(), mongo: vi.fn(),
  users: vi.fn(), findUsers: vi.fn(),
  grantUserId: '507f1f77bcf86cd799439012',
}))
vi.mock('@/lib/auth', () => ({ getAuth: async () => ({ api: { getSession: async () => fixtures.session } }) }))
vi.mock('@bloctop/shared/mongodb', () => ({ getDatabase: fixtures.mongo }))
vi.mock('@bloctop/shared/db', () => ({
  getAllCities: fixtures.cities, getCragById: fixtures.crag, updateCrag: fixtures.update,
  getAllCrags: vi.fn(), getCragsByCityId: vi.fn(),
  createCragPermission: fixtures.createPermission, deleteCragPermission: fixtures.deletePermission,
  getCragPermissionsByCragId: fixtures.permissions,
}))
vi.mock('@bloctop/shared/crag-creation', async importOriginal => ({
  ...await importOriginal<typeof import('@bloctop/shared/crag-creation')>(), createCragWithCreatorPermission: fixtures.create,
}))
vi.mock('@/lib/revalidate-pwa', () => ({ revalidateHomePage: vi.fn(), revalidateCragPages: vi.fn() }))
vi.mock('@bloctop/shared/logger', () => ({ createModuleLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))

import { POST } from './route'
import { PATCH } from './[id]/route'
import { GET as getPermissions, POST as assignPermission, DELETE as removePermission } from '../crag-permissions/route'
import { CragCreationConflictError } from '@bloctop/shared/crag-creation'

const userId = '507f1f77bcf86cd799439012'
const valid = { id: 'crag-a', name: '岩场 A', cityId: 'new-city', location: '位置', description: '描述', approach: '接近' }
const permissionBody = { userId, cragId: 'crag-a', role: 'manager' }
function request(path: string, method: string, body: unknown) {
  return new NextRequest(`http://localhost:3001/api/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
const context = (id = 'crag-a') => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  fixtures.session = { user: { id: '507f1f77bcf86cd799439011', role: 'admin' } }
  fixtures.grantUserId = userId
  fixtures.cities.mockResolvedValue([{ id: 'new-city', available: false }])
  fixtures.crag.mockImplementation(async id => id === 'crag-a' ? valid : null)
  fixtures.create.mockResolvedValue({ crag: valid, replayed: false })
  fixtures.update.mockResolvedValue(valid)
  fixtures.createPermission.mockResolvedValue(permissionBody)
  fixtures.deletePermission.mockResolvedValue(true)
  fixtures.permissions.mockResolvedValue([])
  fixtures.user.mockResolvedValue({ _id: userId })
  fixtures.users.mockResolvedValue([])
  fixtures.mongo.mockResolvedValue({ collection: (name: string) => {
    if (name === 'user') return { findOne: fixtures.user, find: (query: unknown) => {
      fixtures.findUsers(query)
      return { project: () => ({ toArray: fixtures.users }) }
    } }
    if (name === 'crag_permissions') return { findOne: async ({ userId: id, cragId }: { userId: string | { $in: (string | RegExp)[] }; cragId: string }) => {
      const matches = typeof id === 'string' ? id === fixtures.grantUserId : id.$in.some(value =>
        value instanceof RegExp ? value.test(fixtures.grantUserId) : value === fixtures.grantUserId)
      return matches && cragId === 'crag-a' ? { ...permissionBody, userId: fixtures.grantUserId } : null
    } }
    return { findOne: async () => null }
  } })
})

describe('Editor 岩场与权限真实 handler 边界', () => {
  it('缺少 session 时创建与授权均拒绝，零写入', async () => {
    fixtures.session = null
    expect((await POST(request('crags', 'POST', valid))).status).toBe(401)
    expect((await assignPermission(request('crag-permissions', 'POST', permissionBody))).status).toBe(401)
    expect(fixtures.create).not.toHaveBeenCalled()
    expect(fixtures.createPermission).not.toHaveBeenCalled()
  })

  it('manager 可编辑自己的岩场，但不能创建、读取名单或分配/移除权限', async () => {
    fixtures.session = { user: { id: userId, role: 'user' } }
    expect((await PATCH(request('crags/crag-a', 'PATCH', { name: '新名称' }), context())).status).toBe(200)
    expect((await PATCH(request('crags/crag-b', 'PATCH', { name: '无权名称' }), context('crag-b'))).status).toBe(403)
    expect((await POST(request('crags', 'POST', valid))).status).toBe(403)
    expect((await getPermissions(new NextRequest('http://localhost:3001/api/crag-permissions?cragId=crag-a'))).status).toBe(403)
    expect((await assignPermission(request('crag-permissions', 'POST', permissionBody))).status).toBe(403)
    expect((await removePermission(request('crag-permissions', 'DELETE', permissionBody))).status).toBe(403)
    expect(fixtures.update).toHaveBeenCalledTimes(1)
    expect(fixtures.create).not.toHaveBeenCalled()
    expect(fixtures.createPermission).not.toHaveBeenCalled()
    expect(fixtures.deletePermission).not.toHaveBeenCalled()
  })

  it('规范登录 ID 能通过历史大写授权编辑对应岩场，仍不能编辑其他岩场', async () => {
    fixtures.session = { user: { id: userId, role: 'user' } }
    fixtures.grantUserId = userId.toUpperCase()
    expect((await PATCH(request('crags/crag-a', 'PATCH', { name: '新名称' }), context())).status).toBe(200)
    expect((await PATCH(request('crags/crag-b', 'PATCH', { name: '无权名称' }), context('crag-b'))).status).toBe(403)
    expect(fixtures.update).toHaveBeenCalledTimes(1)
  })

  it.each([
    null, [], { ...valid, id: 123 }, { ...valid, id: 'UPPER' }, { ...valid, name: {} },
    { ...valid, name: '  ' }, { ...valid, cityId: 'absent' },
    { ...valid, coordinates: { lng: 181, lat: 26 } }, { ...valid, coordinates: { lng: 119, lat: '26' } },
  ])('创建拒绝无效内容 %j，不调用持久化', async body => {
    expect((await POST(request('crags', 'POST', body))).status).toBe(400)
    expect(fixtures.create).not.toHaveBeenCalled()
  })

  it('首次返回201，重试恢复返回200，冲突返回409，未启用城市可录入', async () => {
    expect((await POST(request('crags', 'POST', valid))).status).toBe(201)
    fixtures.create.mockResolvedValueOnce({ crag: valid, replayed: true })
    const replay = await POST(request('crags', 'POST', valid))
    expect(replay.status).toBe(200)
    expect((await replay.json()).replayed).toBe(true)
    fixtures.create.mockRejectedValueOnce(new CragCreationConflictError('crag-a'))
    expect((await POST(request('crags', 'POST', valid))).status).toBe(409)
    expect(fixtures.create).toHaveBeenCalledWith(valid, '507f1f77bcf86cd799439011')
  })

  it.each([null, [], {}, { id: 'other' }, { createdBy: userId }, { name: [] }, { name: '' }, { cityId: 'absent' }, { coordinates: { lat: 100, lng: 119 } }, { coverImages: ['javascript:alert(1)'] }])('PATCH 拒绝无效内容 %j，零更新', async body => {
    expect((await PATCH(request('crags/crag-a', 'PATCH', body), context())).status).toBe(400)
    expect(fixtures.update).not.toHaveBeenCalled()
  })

  it('PATCH 规范化文本、允许清空坐标、不存在岩场返回404', async () => {
    expect((await PATCH(request('crags/crag-a', 'PATCH', { name: ' 新名称 ', coordinates: null }), context())).status).toBe(200)
    expect(fixtures.update).toHaveBeenCalledWith('crag-a', { name: '新名称', coordinates: null })
    fixtures.update.mockResolvedValueOnce(null)
    expect((await PATCH(request('crags/absent', 'PATCH', { name: '名称' }), context('absent'))).status).toBe(404)
  })

  it.each([null, [], { ...permissionBody, userId: 'not-an-objectid' }, { ...permissionBody, cragId: {} }, { ...permissionBody, role: 'admin' }, { ...permissionBody, role: 'creator' }, { ...permissionBody, role: ['manager'] }])('授权拒绝无效目标/角色 %j', async body => {
    expect((await assignPermission(request('crag-permissions', 'POST', body))).status).toBe(400)
    expect(fixtures.createPermission).not.toHaveBeenCalled()
  })

  it('授权要求用户和岩场真实存在，重复授权返回稳定409', async () => {
    expect((await assignPermission(request('crag-permissions', 'POST', { ...permissionBody, cragId: 'absent' }))).status).toBe(404)
    fixtures.user.mockResolvedValueOnce(null)
    expect((await assignPermission(request('crag-permissions', 'POST', permissionBody))).status).toBe(404)
    expect(fixtures.createPermission).not.toHaveBeenCalled()
    fixtures.createPermission.mockRejectedValueOnce({ code: 11000 })
    const conflict = await assignPermission(request('crag-permissions', 'POST', permissionBody))
    expect(conflict.status).toBe(409)
    expect((await conflict.json()).error).toBe('该用户已拥有此岩场权限')
  })

  it('读取不存在岩场返回404，删除允许清理已删除用户的残余授权', async () => {
    expect((await getPermissions(new NextRequest('http://localhost:3001/api/crag-permissions?cragId=absent'))).status).toBe(404)
    fixtures.user.mockResolvedValue(null)
    expect((await removePermission(request('crag-permissions', 'DELETE', permissionBody))).status).toBe(200)
    expect(fixtures.deletePermission).toHaveBeenCalledWith(userId, 'crag-a')
    expect(fixtures.user).not.toHaveBeenCalled()
  })

  it('大写 ObjectId 授权以规范值查用户并存储 grant，不创造大小写不同的用户身份', async () => {
    fixtures.createPermission.mockImplementationOnce(async permission => permission)
    const response = await assignPermission(request('crag-permissions', 'POST', { ...permissionBody, userId: userId.toUpperCase() }))
    expect(response.status).toBe(201)
    expect(fixtures.user).toHaveBeenCalledWith({ _id: new ObjectId(userId) }, { projection: { _id: 1 } })
    expect(fixtures.createPermission).toHaveBeenCalledWith({ ...permissionBody, assignedBy: '507f1f77bcf86cd799439011' })
    expect((await response.json()).permission.userId).toBe(userId)
  })

  it('历史大写 grant 正确补全用户名，保留原始值供撤销；非法历史 ID 不阻断名单', async () => {
    fixtures.permissions.mockResolvedValueOnce([
      { ...permissionBody, userId: userId.toUpperCase() },
      { ...permissionBody, userId: 'legacy-invalid' },
    ])
    fixtures.users.mockResolvedValueOnce([{ _id: new ObjectId(userId), name: '管理员名字', email: 'fixture@example.invalid' }])
    const response = await getPermissions(new NextRequest('http://localhost:3001/api/crag-permissions?cragId=crag-a'))
    expect(response.status).toBe(200)
    expect(fixtures.findUsers).toHaveBeenCalledWith({ _id: { $in: [new ObjectId(userId)] } })
    expect((await response.json()).permissions).toMatchObject([
      { userId: userId.toUpperCase(), user: { name: '管理员名字', email: 'fixture@example.invalid' } },
      { userId: 'legacy-invalid', user: { name: '', email: '' } },
    ])
  })

  it('撤销大写历史 grant 把原输入交服务，同时允许服务清理规范记录', async () => {
    const response = await removePermission(request('crag-permissions', 'DELETE', { ...permissionBody, userId: userId.toUpperCase() }))
    expect(response.status).toBe(200)
    expect(fixtures.deletePermission).toHaveBeenCalledWith(userId.toUpperCase(), 'crag-a')
    expect(fixtures.user).not.toHaveBeenCalled()
  })
})
