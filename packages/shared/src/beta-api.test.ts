import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import type { Db } from 'mongodb'
import type { AuthInfo } from './require-auth'
import type { BetaLink } from './types'
import { createBetaHandlers } from './beta-api'
import { checkRateLimit } from './rate-limit'

vi.mock('./logger', () => ({
  createModuleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('./rate-limit', () => ({
  checkRateLimit: vi.fn(),
  BETA_RATE_LIMIT_CONFIG: { maxRequests: 5, windowMs: 60000 },
}))

const NOTE_ID = '6797869e0000000029017615'
const NOTE_URL = `https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=original`
const BETA: BetaLink = { id: 'beta-1', platform: 'xiaohongshu', noteId: NOTE_ID, url: NOTE_URL, author: 'Alice' }
type RouteDocument = { _id: number; cragId: string; betaLinks?: BetaLink[]; updatedAt?: Date }
type Filter = { _id: number; cragId?: string; 'betaLinks.noteId'?: { $ne: string }; 'betaLinks.id'?: string }
type Update = { $push?: { betaLinks: BetaLink }; $pull?: { betaLinks: { id: string } }; $set?: Record<string, unknown>; $unset?: Record<string, unknown> }
type Options = { arrayFilters?: { 'elem.id': string }[]; returnDocument?: string; projection?: unknown }

let route: RouteDocument | null
const requireAuth = vi.fn<(request: NextRequest) => Promise<AuthInfo | NextResponse>>()
const canEditCrag = vi.fn().mockResolvedValue(true)
const getDatabase = vi.fn<() => Promise<Db>>()
const findOne = vi.fn()
const updateOne = vi.fn()
const findOneAndUpdate = vi.fn()
const handlers = createBetaHandlers({ requireAuth, getDatabase, canEditCrag })

function matches(filter: Filter): boolean {
  if (!route || route._id !== filter._id || (filter.cragId !== undefined && route.cragId !== filter.cragId)) return false
  if (filter['betaLinks.noteId'] && route.betaLinks?.some(beta => beta.noteId === filter['betaLinks.noteId']?.$ne)) return false
  if (filter['betaLinks.id'] !== undefined && !route.betaLinks?.some(beta => beta.id === filter['betaLinks.id'])) return false
  return true
}

/** Apply the Mongo predicates and operators used by this contract at the write. */
function applyAtomicUpdate(filter: Filter, update: Update, options?: Options) {
  if (!matches(filter) || !route) return { matchedCount: 0, modifiedCount: 0 }
  if (update.$push) (route.betaLinks ??= []).push(update.$push.betaLinks)
  if (update.$pull) route.betaLinks = route.betaLinks?.filter(beta => beta.id !== update.$pull?.betaLinks.id)
  const elementId = options?.arrayFilters?.[0]['elem.id']
  for (const [path, value] of Object.entries(update.$set ?? {})) {
    if (path === 'updatedAt') route.updatedAt = value as Date
    if (path.startsWith('betaLinks.$[elem].')) {
      const beta = route.betaLinks?.find(link => link.id === elementId)
      if (beta) Object.assign(beta, { [path.split('.').at(-1)!]: value })
    }
  }
  for (const path of Object.keys(update.$unset ?? {})) {
    const beta = route.betaLinks?.find(link => link.id === elementId)
    if (beta) delete (beta as unknown as Record<string, unknown>)[path.split('.').at(-1)!]
  }
  return { matchedCount: 1, modifiedCount: 1 }
}

function request(method: 'POST' | 'PATCH' | 'DELETE', body: unknown) {
  return new NextRequest('http://localhost:3000/api/beta', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  route = { _id: 39, cragId: 'crag-a', betaLinks: [] }
  requireAuth.mockResolvedValue({ userId: 'user-1', role: 'user' })
  canEditCrag.mockResolvedValue(true)
  vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, remaining: 4, resetTime: 123456, retryAfter: 0 })
  findOne.mockImplementation(async (filter: Filter) => matches(filter) ? route : null)
  updateOne.mockImplementation(async (filter: Filter, update: Update, options?: Options) => applyAtomicUpdate(filter, update, options))
  findOneAndUpdate.mockImplementation(async (filter: Filter, update: Update, options?: Options) => {
    const result = applyAtomicUpdate(filter, update, options)
    return result.matchedCount ? route : null
  })
  getDatabase.mockResolvedValue({ collection: () => ({ findOne, updateOne, findOneAndUpdate }) } as unknown as Db)
})

describe('shared Beta API authentication and input contract', () => {
  it.each(['POST', 'PATCH', 'DELETE'] as const)('%s rejects unauthenticated writes before database or rate limiting', async method => {
    requireAuth.mockResolvedValue(NextResponse.json({ success: false, error: '未登录' }, { status: 401 }))
    const response = await handlers[method](request(method, { routeId: 39, url: NOTE_URL, betaId: BETA.id }))
    expect(response.status).toBe(401)
    expect(getDatabase).not.toHaveBeenCalled()
    expect(checkRateLimit).not.toHaveBeenCalled()
  })

  it.each(['POST', 'PATCH', 'DELETE'] as const)('%s classifies malformed JSON as 400', async method => {
    const response = await handlers[method](new NextRequest('http://localhost/api/beta', { method, body: '{' }))
    expect(response.status).toBe(400)
    expect(getDatabase).not.toHaveBeenCalled()
  })

  it.each([null, [], 39, 'text'])('rejects non-object JSON body %j', async body => {
    expect((await handlers.POST(request('POST', body))).status).toBe(400)
    expect(getDatabase).not.toHaveBeenCalled()
  })

  it.each(['39junk', 39.5, 0, -1, null, {}, true, Number.MAX_SAFE_INTEGER + 1])('POST rejects malformed route ID %j before writing', async routeId => {
    expect((await handlers.POST(request('POST', { routeId, url: NOTE_URL }))).status).toBe(400)
    expect(getDatabase).not.toHaveBeenCalled()
  })

  it.each(['PATCH', 'DELETE'] as const)('%s rejects malformed route and Beta IDs', async method => {
    for (const body of [{ routeId: '39junk', betaId: BETA.id }, { routeId: 39, betaId: {} }, { routeId: 39, betaId: ' ' }]) {
      expect((await handlers[method](request(method, body))).status).toBe(400)
    }
    expect(getDatabase).not.toHaveBeenCalled()
  })

  it.each(['POST', 'PATCH', 'DELETE'] as const)('%s catches authentication infrastructure failures', async method => {
    requireAuth.mockRejectedValueOnce(new Error('Auth unavailable'))
    expect((await handlers[method](request(method, {}))).status).toBe(500)
    expect(getDatabase).not.toHaveBeenCalled()
  })
})

describe('POST /api/beta', () => {
  it('lets a logged-in user submit without management permission and returns the persisted Beta', async () => {
    canEditCrag.mockResolvedValue(false)
    const response = await handlers.POST(request('POST', { routeId: '39', url: `分享文案 [${NOTE_URL}]`, author: ' Alice ', climberHeight: 175, climberReach: 180 }))
    expect(response.status).toBe(201)
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('4')
    const { beta } = await response.json()
    expect(beta).toMatchObject({ noteId: NOTE_ID, url: NOTE_URL, platform: 'xiaohongshu', author: 'Alice', climberHeight: 175, climberReach: 180 })
    expect(route?.betaLinks).toHaveLength(1)
    expect(route?.betaLinks?.[0].id).toBe(beta.id)
    expect(canEditCrag).not.toHaveBeenCalled()
    expect(updateOne.mock.calls[0][0]).toEqual({ _id: 39, 'betaLinks.noteId': { $ne: NOTE_ID } })
  })

  it('concurrent submissions of one note atomically create one Beta and return 409 for the other', async () => {
    const responses = await Promise.all([
      handlers.POST(request('POST', { routeId: 39, url: NOTE_URL })),
      handlers.POST(request('POST', { routeId: 39, url: `https://www.xiaohongshu.com/discovery/item/${NOTE_ID}` })),
    ])
    expect(responses.map(response => response.status).sort()).toEqual([201, 409])
    expect(route?.betaLinks).toHaveLength(1)
    expect(await responses.find(response => response.status === 409)!.json()).toMatchObject({ code: 'DUPLICATE_BETA' })
    expect(updateOne).toHaveBeenCalledTimes(2)
  })

  it('permits different notes submitted concurrently', async () => {
    const responses = await Promise.all(['6797869e0000000029017615', '69888b980000000015021e7b'].map(noteId =>
      handlers.POST(request('POST', { routeId: 39, url: `https://www.xiaohongshu.com/explore/${noteId}` })),
    ))
    expect(responses.map(response => response.status)).toEqual([201, 201])
    expect(route?.betaLinks).toHaveLength(2)
  })

  it('distinguishes a missing route from duplicate note after conditional update misses', async () => {
    route = null
    const response = await handlers.POST(request('POST', { routeId: 39, url: NOTE_URL }))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'ROUTE_NOT_FOUND' })
  })

  it('rejects existing duplicates without changing route timestamps', async () => {
    route!.betaLinks = [{ ...BETA }]
    const previousTimestamp = new Date('2026-09-01')
    route!.updatedAt = previousTimestamp
    expect((await handlers.POST(request('POST', { routeId: 39, url: NOTE_URL }))).status).toBe(409)
    expect(route?.updatedAt).toBe(previousTimestamp)
  })

  it('resolves xhslink.cn shares and retains the original short URL', async () => {
    const shortUrl = 'https://xhslink.cn/o/AsU8BTN9oIl'
    const fetchMock = vi.fn().mockResolvedValue({ url: `https://www.xiaohongshu.com/login?redirectPath=${encodeURIComponent(NOTE_URL)}` })
    vi.stubGlobal('fetch', fetchMock)
    const response = await handlers.POST(request('POST', { routeId: 39, url: `复制并打开 ${shortUrl}` }))
    expect(response.status).toBe(201)
    expect((await response.json()).beta).toMatchObject({ url: NOTE_URL, originalUrl: shortUrl, noteId: NOTE_ID })
    expect(fetchMock).toHaveBeenCalledWith(shortUrl, expect.objectContaining({ redirect: 'follow', signal: expect.any(AbortSignal) }))
  })

  it('returns a parse error without writing when short-link resolution fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network unavailable')))
    const response = await handlers.POST(request('POST', { routeId: 39, url: 'https://xhslink.com/o/share' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'CANNOT_PARSE_NOTE' })
    expect(updateOne).not.toHaveBeenCalled()
  })

  it.each([
    [{ url: {} }, 'INVALID_URL'],
    [{ url: 'invalid-url' }, 'INVALID_URL'],
    [{ url: 'https://example.com/explore/6797869e0000000029017615' }, 'ONLY_XIAOHONGSHU'],
    [{ url: 'https://www.xiaohongshu.com/user/profile/6797869e0000000029017615' }, 'CANNOT_PARSE_NOTE'],
    [{ climberHeight: '175' }, 'INVALID_HEIGHT'],
    [{ climberHeight: null }, 'INVALID_HEIGHT'],
    [{ climberHeight: 99 }, 'INVALID_HEIGHT'],
    [{ climberReach: {} }, 'INVALID_REACH'],
    [{ climberReach: 251 }, 'INVALID_REACH'],
  ])('rejects invalid submission fields %j', async (overrides, code) => {
    const response = await handlers.POST(request('POST', { routeId: 39, url: NOTE_URL, ...overrides }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code })
    expect(updateOne).not.toHaveBeenCalled()
  })

  it('keeps rate-limit status and retry headers', async () => {
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: false, remaining: 0, resetTime: 123456, retryAfter: 30 })
    const response = await handlers.POST(request('POST', { routeId: 39, url: NOTE_URL }))
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('30')
    expect(await response.json()).toMatchObject({ code: 'RATE_LIMITED', retryAfter: 30 })
    expect(getDatabase).not.toHaveBeenCalled()
  })
})

describe('PATCH and DELETE /api/beta', () => {
  beforeEach(() => { route!.betaLinks = [{ ...BETA }, { ...BETA, id: 'beta-2', noteId: '69888b980000000015021e7b' }] })

  it.each(['PATCH', 'DELETE'] as const)('%s denies a manager without permission for the current route crag', async method => {
    canEditCrag.mockResolvedValue(false)
    const response = await handlers[method](request(method, { routeId: 39, betaId: BETA.id, author: 'Bob' }))
    expect(response.status).toBe(403)
    expect(canEditCrag).toHaveBeenCalledWith('user-1', 'crag-a', 'user')
    expect(updateOne).not.toHaveBeenCalled()
    expect(findOneAndUpdate).not.toHaveBeenCalled()
  })

  it.each(['PATCH', 'DELETE'] as const)('%s returns Beta 404 and does not touch route timestamps for an absent Beta', async method => {
    const response = await handlers[method](request(method, { routeId: 39, betaId: 'missing-beta', author: 'Bob' }))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'BETA_NOT_FOUND' })
    expect(route?.updatedAt).toBeUndefined()
    expect(route?.betaLinks).toHaveLength(2)
    const filter = method === 'PATCH' ? findOneAndUpdate.mock.calls[0][0] : updateOne.mock.calls[0][0]
    expect(filter).toEqual({ _id: 39, cragId: 'crag-a', 'betaLinks.id': 'missing-beta' })
  })

  it.each(['PATCH', 'DELETE'] as const)('%s returns route 404 when the route is missing', async method => {
    route = null
    const response = await handlers[method](request(method, { routeId: 39, betaId: BETA.id }))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'ROUTE_NOT_FOUND' })
    expect(canEditCrag).not.toHaveBeenCalled()
  })

  it.each(['PATCH', 'DELETE'] as const)('%s detects deletion of the route between permission check and write', async method => {
    canEditCrag.mockImplementationOnce(async () => { route = null; return true })
    const response = await handlers[method](request(method, { routeId: 39, betaId: BETA.id, author: 'Bob' }))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'ROUTE_NOT_FOUND' })
  })

  it('PATCH returns the authoritative edited Beta and leaves other Betas unchanged', async () => {
    const response = await handlers.PATCH(request('PATCH', { routeId: '39', betaId: BETA.id, title: ' New title ', author: ' Bob ', climberHeight: 180 }))
    expect(response.status).toBe(200)
    expect((await response.json()).beta).toMatchObject({ ...BETA, title: 'New title', author: 'Bob', climberHeight: 180 })
    expect(route?.betaLinks?.[1].author).toBe('Alice')
    expect(findOneAndUpdate.mock.calls[0][2]).toEqual({ arrayFilters: [{ 'elem.id': BETA.id }], returnDocument: 'after', projection: { betaLinks: { $elemMatch: { id: BETA.id } } } })
  })

  it('PATCH clears optional metadata explicitly while retaining identity fields', async () => {
    Object.assign(route!.betaLinks![0], { title: 'Title', climberHeight: 175, climberReach: 180 })
    const response = await handlers.PATCH(request('PATCH', { routeId: 39, betaId: BETA.id, title: '', author: null, climberHeight: null, climberReach: null }))
    expect(response.status).toBe(200)
    expect((await response.json()).beta).toEqual({ id: BETA.id, platform: BETA.platform, noteId: BETA.noteId, url: BETA.url })
    expect(findOneAndUpdate.mock.calls[0][1].$unset).toEqual({ 'betaLinks.$[elem].title': '', 'betaLinks.$[elem].author': '', 'betaLinks.$[elem].climberHeight': '', 'betaLinks.$[elem].climberReach': '' })
  })

  it('DELETE removes only the requested Beta', async () => {
    const response = await handlers.DELETE(request('DELETE', { routeId: 39, betaId: BETA.id }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(route?.betaLinks?.map(beta => beta.id)).toEqual(['beta-2'])
  })

  it('PATCH rejects invalid metadata rather than storing coerced values', async () => {
    expect((await handlers.PATCH(request('PATCH', { routeId: 39, betaId: BETA.id, climberHeight: '180' }))).status).toBe(400)
    expect((await handlers.PATCH(request('PATCH', { routeId: 39, betaId: BETA.id, title: {} }))).status).toBe(400)
    expect(findOneAndUpdate).not.toHaveBeenCalled()
  })
})

describe('GET /api/beta', () => {
  it('publicly returns fresh persisted Betas with no-store', async () => {
    route!.betaLinks = [{ ...BETA }]
    const response = await handlers.GET(new NextRequest('http://localhost/api/beta?routeId=39'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store, max-age=0')
    expect((await response.json()).betaLinks).toEqual([BETA])
    expect(requireAuth).not.toHaveBeenCalled()
  })

  it.each(['39junk', '1.5', '0', '-39', '1e2', '', '9007199254740992'])('rejects query route ID %s before reading the database', async routeId => {
    const response = await handlers.GET(new NextRequest(`http://localhost/api/beta?routeId=${routeId}`))
    expect(response.status).toBe(400)
    expect(getDatabase).not.toHaveBeenCalled()
  })

  it('returns an empty list for a legacy route without betaLinks', async () => {
    delete route!.betaLinks
    expect((await (await handlers.GET(new NextRequest('http://localhost/api/beta?routeId=39'))).json()).betaLinks).toEqual([])
  })

  it('returns 404 for an absent route', async () => {
    route = null
    expect((await handlers.GET(new NextRequest('http://localhost/api/beta?routeId=39'))).status).toBe(404)
  })

  it('returns a stable server error on database failure', async () => {
    getDatabase.mockRejectedValueOnce(new Error('Database unavailable'))
    const response = await handlers.GET(new NextRequest('http://localhost/api/beta?routeId=39'))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'SERVER_ERROR', code: 'SERVER_ERROR' })
  })
})
