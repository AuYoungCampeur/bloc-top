import { NextRequest, NextResponse } from 'next/server'
import type { Collection, Db } from 'mongodb'
import { API_ERROR_CODES, createErrorResponse, type ApiErrorCode } from './api-error-codes'
import {
  detectPlatformFromUrl,
  extractUrlFromText,
  extractXiaohongshuNoteId,
  isXiaohongshuShortUrl,
  isXiaohongshuUrl,
  normalizeXiaohongshuNoteUrl,
} from './beta-constants'
import { createModuleLogger } from './logger'
import { BETA_RATE_LIMIT_CONFIG, checkRateLimit } from './rate-limit'
import { getClientIp } from './request-utils'
import type { AuthInfo } from './require-auth'
import type { BetaLink, UserRole } from './types'

interface BetaRouteDocument {
  _id: number
  cragId: string
  betaLinks?: BetaLink[]
  updatedAt?: Date
}

interface BetaApiDependencies {
  requireAuth: (request: NextRequest) => Promise<AuthInfo | NextResponse>
  getDatabase: () => Promise<Db>
  canEditCrag: (userId: string, cragId: string, role: UserRole) => Promise<boolean>
}

const log = createModuleLogger('API:Beta')

function errorResponse(code: ApiErrorCode, status: number) {
  return NextResponse.json(createErrorResponse(code), { status })
}

/** Reject partial parses ("39abc"), fractions, objects and unsafe integers. */
function parseRouteId(value: unknown): number | null {
  if (typeof value === 'string' && !/^[1-9]\d*$/.test(value)) return null
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

async function readBody(request: NextRequest): Promise<Record<string, unknown> | NextResponse> {
  try {
    const body: unknown = await request.json()
    if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>
    }
  } catch {
    // Invalid JSON is a client error, not a failed database operation.
  }
  return errorResponse(API_ERROR_CODES.MISSING_FIELDS, 400)
}

function validateMeasurements(body: Record<string, unknown>, allowClear = false): NextResponse | null {
  for (const [field, code] of [
    ['climberHeight', API_ERROR_CODES.INVALID_HEIGHT],
    ['climberReach', API_ERROR_CODES.INVALID_REACH],
  ] as const) {
    const value = body[field]
    if (value === undefined || (allowClear && value === null)) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 100 || value > 250) {
      return errorResponse(code, 400)
    }
  }
  return null
}

async function resolveShortUrl(url: string): Promise<string> {
  if (!isXiaohongshuShortUrl(url)) return url
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      },
      signal: AbortSignal.timeout(10000),
    })
    return normalizeXiaohongshuNoteUrl(response.url)
  } catch (error) {
    log.warn('Failed to resolve Xiaohongshu short URL', {
      action: 'resolveShortUrl',
      metadata: { error: error instanceof Error ? error.message : String(error) },
    })
    return url
  }
}

function withErrorHandling(method: string, handler: (request: NextRequest) => Promise<NextResponse>) {
  return async (request: NextRequest) => {
    const start = Date.now()
    try {
      return await handler(request)
    } catch (error) {
      log.error('Beta request failed', error, {
        action: `${method} /api/beta`,
        duration: Date.now() - start,
      })
      return errorResponse(API_ERROR_CODES.SERVER_ERROR, 500)
    }
  }
}

/**
 * One API contract for PWA and Editor. Reads are public; submission requires
 * login, and management requires permission for the route's current crag.
 * Mongo update predicates enforce uniqueness/existence at the write itself.
 */
export function createBetaHandlers(dependencies: BetaApiDependencies) {
  const { requireAuth, getDatabase, canEditCrag } = dependencies

  async function authorizedRoute(routeId: number, auth: AuthInfo, operation: '编辑' | '删除') {
    const db = await getDatabase()
    const collection = db.collection<BetaRouteDocument>('routes')
    const route = await collection.findOne({ _id: routeId }, { projection: { cragId: 1 } })
    if (!route) return errorResponse(API_ERROR_CODES.ROUTE_NOT_FOUND, 404)
    if (!(await canEditCrag(auth.userId, route.cragId, auth.role))) {
      return NextResponse.json({ success: false, error: `无权${operation}此岩场的 Beta` }, { status: 403 })
    }
    return { collection, cragId: route.cragId }
  }

  async function missingBetaResponse(collection: Collection<BetaRouteDocument>, routeId: number) {
    const route = await collection.findOne({ _id: routeId }, { projection: { _id: 1 } })
    return errorResponse(route ? API_ERROR_CODES.BETA_NOT_FOUND : API_ERROR_CODES.ROUTE_NOT_FOUND, 404)
  }

  const POST = withErrorHandling('POST', async request => {
    const auth = await requireAuth(request)
    if (auth instanceof NextResponse) return auth

    const rateLimit = checkRateLimit(`beta:${getClientIp(request)}`, BETA_RATE_LIMIT_CONFIG)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { ...createErrorResponse(API_ERROR_CODES.RATE_LIMITED), retryAfter: rateLimit.retryAfter },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimit.retryAfter),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(rateLimit.resetTime),
          },
        },
      )
    }

    const body = await readBody(request)
    if (body instanceof NextResponse) return body
    const routeId = parseRouteId(body.routeId)
    if (routeId === null || !body.url) return errorResponse(API_ERROR_CODES.MISSING_FIELDS, 400)
    if (typeof body.url !== 'string') return errorResponse(API_ERROR_CODES.INVALID_URL, 400)

    const url = extractUrlFromText(body.url) || body.url
    try {
      new URL(url)
    } catch {
      return errorResponse(API_ERROR_CODES.INVALID_URL, 400)
    }
    const platform = detectPlatformFromUrl(url)
    if (!isXiaohongshuUrl(url) || !platform) return errorResponse(API_ERROR_CODES.ONLY_XIAOHONGSHU, 400)
    const invalidMeasurements = validateMeasurements(body)
    if (invalidMeasurements) return invalidMeasurements

    const [resolvedUrl, db] = await Promise.all([resolveShortUrl(url), getDatabase()])
    const noteId = extractXiaohongshuNoteId(resolvedUrl)
    if (!noteId) return errorResponse(API_ERROR_CODES.CANNOT_PARSE_NOTE, 400)

    const newBeta: BetaLink = {
      id: `beta_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      platform,
      noteId,
      url: resolvedUrl,
      ...(url !== resolvedUrl && { originalUrl: url }),
      ...(typeof body.author === 'string' && body.author.trim() && { author: body.author.trim().slice(0, 30) }),
      ...(typeof body.climberHeight === 'number' && { climberHeight: body.climberHeight }),
      ...(typeof body.climberReach === 'number' && { climberReach: body.climberReach }),
      createdAt: new Date(),
    }
    const collection = db.collection<BetaRouteDocument>('routes')
    const result = await collection.updateOne(
      { _id: routeId, 'betaLinks.noteId': { $ne: noteId } },
      { $push: { betaLinks: newBeta }, $set: { updatedAt: new Date() } },
    )

    if (result.matchedCount === 0) {
      const route = await collection.findOne({ _id: routeId }, { projection: { _id: 1 } })
      return errorResponse(route ? API_ERROR_CODES.DUPLICATE_BETA : API_ERROR_CODES.ROUTE_NOT_FOUND, route ? 409 : 404)
    }
    if (result.modifiedCount === 0) return errorResponse(API_ERROR_CODES.UPDATE_FAILED, 500)

    log.info('Beta created', { action: 'POST /api/beta', metadata: { routeId, betaId: newBeta.id, noteId } })
    return NextResponse.json({ success: true, beta: newBeta }, {
      status: 201,
      headers: {
        'X-RateLimit-Remaining': String(rateLimit.remaining),
        'X-RateLimit-Reset': String(rateLimit.resetTime),
      },
    })
  })

  const PATCH = withErrorHandling('PATCH', async request => {
    const auth = await requireAuth(request)
    if (auth instanceof NextResponse) return auth
    const body = await readBody(request)
    if (body instanceof NextResponse) return body
    const routeId = parseRouteId(body.routeId)
    const betaId = body.betaId
    if (routeId === null || typeof betaId !== 'string' || !betaId.trim()) {
      return errorResponse(API_ERROR_CODES.MISSING_BETA_ID, 400)
    }
    const invalidMeasurements = validateMeasurements(body, true)
    if (invalidMeasurements) return invalidMeasurements
    for (const field of ['title', 'author'] as const) {
      if (body[field] !== undefined && body[field] !== null && typeof body[field] !== 'string') {
        return errorResponse(API_ERROR_CODES.MISSING_FIELDS, 400)
      }
    }

    const authorized = await authorizedRoute(routeId, auth, '编辑')
    if (authorized instanceof NextResponse) return authorized
    const setFields: Record<string, unknown> = { updatedAt: new Date() }
    const unsetFields: Record<string, ''> = {}
    for (const field of ['title', 'author', 'climberHeight', 'climberReach'] as const) {
      const value = body[field]
      if (value === undefined) continue
      const path = `betaLinks.$[elem].${field}`
      if (value === null || (typeof value === 'string' && !value.trim())) {
        unsetFields[path] = ''
      } else {
        setFields[path] = typeof value === 'string' ? value.trim().slice(0, field === 'title' ? 100 : 30) : value
      }
    }
    const updatedRoute = await authorized.collection.findOneAndUpdate(
      { _id: routeId, cragId: authorized.cragId, 'betaLinks.id': betaId },
      { $set: setFields, ...(Object.keys(unsetFields).length > 0 && { $unset: unsetFields }) },
      {
        arrayFilters: [{ 'elem.id': betaId }],
        returnDocument: 'after',
        projection: { betaLinks: { $elemMatch: { id: betaId } } },
      },
    )
    if (!updatedRoute) return missingBetaResponse(authorized.collection, routeId)
    const beta = updatedRoute.betaLinks?.find(link => link.id === betaId)
    if (!beta) return errorResponse(API_ERROR_CODES.UPDATE_FAILED, 500)
    // An idempotent edit may match without changing any values. It is successful.
    log.info('Beta updated', { action: 'PATCH /api/beta', metadata: { routeId, betaId } })
    return NextResponse.json({ success: true, beta })
  })

  const DELETE = withErrorHandling('DELETE', async request => {
    const auth = await requireAuth(request)
    if (auth instanceof NextResponse) return auth
    const body = await readBody(request)
    if (body instanceof NextResponse) return body
    const routeId = parseRouteId(body.routeId)
    const betaId = body.betaId
    if (routeId === null || typeof betaId !== 'string' || !betaId.trim()) {
      return errorResponse(API_ERROR_CODES.MISSING_BETA_ID, 400)
    }
    const authorized = await authorizedRoute(routeId, auth, '删除')
    if (authorized instanceof NextResponse) return authorized
    const result = await authorized.collection.updateOne(
      { _id: routeId, cragId: authorized.cragId, 'betaLinks.id': betaId },
      { $pull: { betaLinks: { id: betaId } }, $set: { updatedAt: new Date() } },
    )
    if (result.matchedCount === 0) return missingBetaResponse(authorized.collection, routeId)
    log.info('Beta deleted', { action: 'DELETE /api/beta', metadata: { routeId, betaId } })
    return NextResponse.json({ success: true })
  })

  const GET = withErrorHandling('GET', async request => {
    const routeId = parseRouteId(new URL(request.url).searchParams.get('routeId'))
    if (routeId === null) return errorResponse(API_ERROR_CODES.MISSING_ROUTE_ID, 400)
    const db = await getDatabase()
    const route = await db.collection<BetaRouteDocument>('routes').findOne(
      { _id: routeId },
      { projection: { betaLinks: 1 } },
    )
    if (!route) return errorResponse(API_ERROR_CODES.ROUTE_NOT_FOUND, 404)
    return NextResponse.json({ success: true, betaLinks: route.betaLinks || [] }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    })
  })

  return { POST, PATCH, DELETE, GET }
}
