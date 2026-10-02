import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import type { Db } from 'mongodb'
import { createFaceHandlers } from './face-api'
import { FaceOperationError, type FaceObjectStore } from './face-management'

const auth = { userId: 'manager', role: 'user' as const }
const head = vi.fn<FaceObjectStore['head']>()
const store: FaceObjectStore = { head, list: vi.fn(async () => ({ keys: [] })), copy: vi.fn(), put: vi.fn(), delete: vi.fn() }
const findCrag = vi.fn(async (): Promise<{ _id: string } | null> => ({ _id: 'crag' }))
const getDatabase = vi.fn(async () => ({ collection: () => ({ findOne: findCrag, updateOne: async () => ({ matchedCount: 1 }), find: () => ({ toArray: async () => [] }) }) }) as unknown as Db)
const getObjectStore = vi.fn(() => store)
const requireAuth = vi.fn(async (): Promise<typeof auth | NextResponse> => auth)
const canEditCrag = vi.fn(async () => true)
const revalidateCragPages = vi.fn(async () => {})
const handlers = createFaceHandlers({ getDatabase, getObjectStore, requireAuth, canEditCrag, revalidateCragPages })
const identity = { cragId: 'crag', area: '北 区', faceId: '岩面' }
const bodyRequest = (method: string, body: unknown) => new NextRequest('http://localhost/api/faces', { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
function upload(extra: Record<string, string> = {}, file = true) {
  const form = new FormData()
  for (const [name, value] of Object.entries({ ...identity, ...extra })) form.set(name, value)
  if (file) form.set('file', new File([new Uint8Array([1, 2])], 'photo.png', { type: 'image/png' }))
  return new NextRequest('http://localhost/api/upload', { method: 'POST', body: form })
}

beforeEach(() => { vi.clearAllMocks(); requireAuth.mockResolvedValue(auth); canEditCrag.mockResolvedValue(true); head.mockResolvedValue(null); findCrag.mockResolvedValue({ _id: 'crag' }) })

describe('NextRequest face/upload boundary', () => {
  it.each(['GET', 'PATCH', 'DELETE', 'POST'] as const)('%s rejects unauthenticated requests before storage/database access', async method => {
    requireAuth.mockResolvedValue(NextResponse.json({ success: false }, { status: 401 }))
    expect((await handlers[method](new NextRequest('http://localhost/api/faces?cragId=crag'))).status).toBe(401)
    expect(getDatabase).not.toHaveBeenCalled(); expect(getObjectStore).not.toHaveBeenCalled()
  })
  it.each(['GET', 'PATCH', 'DELETE', 'POST'] as const)('%s checks crag permission before touching storage', async method => {
    canEditCrag.mockResolvedValue(false)
    const request = method === 'GET' ? new NextRequest('http://localhost/api/faces?cragId=crag')
      : method === 'POST' ? upload() : bodyRequest(method, { ...identity, oldFaceId: '岩面', newFaceId: 'new' })
    expect((await handlers[method](request)).status).toBe(403)
    expect(getDatabase).not.toHaveBeenCalled(); expect(getObjectStore).not.toHaveBeenCalled()
  })
  it.each(['GET', 'PATCH', 'DELETE', 'POST'] as const)('%s denies a nonexistent crag even when admin/dangling permission allows it', async method => {
    findCrag.mockResolvedValue(null)
    const request = method === 'GET' ? new NextRequest('http://localhost/api/faces?cragId=crag')
      : method === 'POST' ? upload({ checkOnly: 'true' }, false) : bodyRequest(method, { ...identity, oldFaceId: '岩面', newFaceId: 'new' })
    const response = await handlers[method](request)
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'CRAG_NOT_FOUND' })
    expect(getObjectStore).not.toHaveBeenCalled()
  })
  it.each([null, [], {}, { ...identity, area: '../other' }, { ...identity, faceId: {} }])('malformed delete body returns 400: %j', async body => {
    expect((await handlers.DELETE(bodyRequest('DELETE', body))).status).toBe(400)
    expect(getDatabase).not.toHaveBeenCalled()
  })
  it('malformed JSON is 400', async () => {
    const response = await handlers.PATCH(new NextRequest('http://localhost/api/faces', { method: 'PATCH', body: '{' }))
    expect(response.status).toBe(400)
  })
  it('check-only returns authoritative ETag and no-store', async () => {
    head.mockResolvedValue({ etag: '"version"' })
    const response = await handlers.POST(upload({ checkOnly: 'true' }, false))
    expect(await response.json()).toMatchObject({ exists: true, etag: '"version"', key: 'crag/北 区/岩面.jpg' })
    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect(findCrag).toHaveBeenCalled()
  })
  it('HEAD failure is 503, never reported as absence', async () => {
    head.mockRejectedValueOnce(new Error('AccessDenied'))
    const response = await handlers.POST(upload({ checkOnly: 'true' }, false))
    expect(response.status).toBe(503)
    expect(await response.json()).not.toHaveProperty('exists')
    expect(store.put).not.toHaveBeenCalled()
  })
  it('create preserves actual content type and encodes URL segments', async () => {
    const response = await handlers.POST(upload())
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.url).toContain('/crag/%E5%8C%97%20%E5%8C%BA/%E5%B2%A9%E9%9D%A2.jpg?')
    expect(result.mediaRevision).toEqual(expect.any(String))
    expect(store.put).toHaveBeenCalledWith('crag/北 区/岩面.jpg', expect.any(Uint8Array), { contentType: 'image/png', ifNoneMatch: '*' })
    expect(revalidateCragPages).toHaveBeenCalledWith('crag')
  })
  it('existing image requires explicit overwrite and matching ETag', async () => {
    head.mockResolvedValue({ etag: 'old' })
    expect((await handlers.POST(upload())).status).toBe(409)
    expect((await handlers.POST(upload({ overwrite: 'true', expectedEtag: 'stale' }))).status).toBe(409)
    expect((await handlers.POST(upload({ overwrite: 'true', expectedEtag: 'old' }))).status).toBe(200)
    expect(store.put).toHaveBeenCalledTimes(1)
  })
  it('transport version conflict is visible as 409', async () => {
    vi.mocked(store.put).mockRejectedValueOnce(new FaceOperationError(409, 'FACE_VERSION_CONFLICT', 'Conflict'))
    expect((await handlers.POST(upload())).status).toBe(409)
  })
  it('FormData File where a string identity is expected is a 400', async () => {
    const form = new FormData(); form.set('cragId', new File(['x'], 'id')); form.set('area', 'B'); form.set('faceId', 'wall')
    expect((await handlers.POST(new NextRequest('http://localhost/api/upload', { method: 'POST', body: form }))).status).toBe(400)
  })
})
