import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/mongodb'
import { detectPlatformFromUrl, isXiaohongshuUrl, isXiaohongshuShortUrl, extractXiaohongshuNoteId, extractUrlFromText, normalizeXiaohongshuNoteUrl } from '@/lib/beta-constants'
import { checkRateLimit, BETA_RATE_LIMIT_CONFIG } from '@/lib/rate-limit'
import { HTTP_CACHE } from '@/lib/cache-config'
import { createModuleLogger } from '@/lib/logger'
import { API_ERROR_CODES, createErrorResponse } from '@/lib/api-error-codes'
import { getClientIp } from '@/lib/request-utils'
import { requireAuth } from '@/lib/require-auth'
import { canEditCrag } from '@/lib/permissions'
import type { Document } from 'mongodb'

// 创建 API 模块专用 logger
const log = createModuleLogger('API')

/**
 * 解析小红书短链接，获取最终 URL
 * 通过跟踪重定向获取最终目标地址
 *
 * 注意：小红书会根据 User-Agent 返回不同响应，
 * 需要使用移动端 UA 才能正常解析
 */
async function resolveShortUrl(url: string): Promise<string> {
  // 仅解析经过域名验证的小红书短链接（xhslink.com / xhslink.cn）
  if (!isXiaohongshuShortUrl(url)) {
    return url
  }

  try {
    // 使用移动端 User-Agent（小红书等平台需要）
    const mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'

    // 使用 GET 请求跟踪重定向（某些平台不支持 HEAD）
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': mobileUA,
      },
      signal: AbortSignal.timeout(10000), // 10秒超时
    })

    // 返回最终 URL
    const finalUrl = response.url
    log.debug(`Resolved short URL: ${url} -> ${finalUrl}`, {
      action: 'resolveShortUrl',
    })
    return normalizeXiaohongshuNoteUrl(finalUrl)
  } catch (error) {
    // 解析失败时返回原 URL
    log.warn(`Failed to resolve short URL: ${url}`, {
      action: 'resolveShortUrl',
      metadata: { error: error instanceof Error ? error.message : String(error) },
    })
    return url
  }
}

/**
 * POST /api/beta
 * 创建新的 Beta 链接
 *
 * 改进功能：
 * - IP 级别 Rate Limiting（每分钟 5 次）
 * - 基于笔记 ID 的去重（静默成功）
 */
export async function POST(request: NextRequest) {
  const start = Date.now()
  const clientIp = getClientIp(request)

  // ==================== 0. 认证检查 ====================
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  try {
    // ==================== 1. Rate Limiting ====================
    const rateLimitResult = checkRateLimit(`beta:${clientIp}`, BETA_RATE_LIMIT_CONFIG)

    if (!rateLimitResult.allowed) {
      log.warn('Rate limit exceeded', {
        action: 'POST /api/beta',
        duration: Date.now() - start,
        metadata: { ip: clientIp, retryAfter: rateLimitResult.retryAfter },
      })
      return NextResponse.json(
        {
          ...createErrorResponse(API_ERROR_CODES.RATE_LIMITED),
          retryAfter: rateLimitResult.retryAfter,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimitResult.retryAfter),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(rateLimitResult.resetTime),
          },
        }
      )
    }

    // ==================== 2. 请求验证 ====================
    const body = await request.json()
    const { routeId, url: rawUrl, author, climberHeight, climberReach } = body

    // 验证必填字段
    if (!routeId || !rawUrl) {
      return NextResponse.json(
        createErrorResponse(API_ERROR_CODES.MISSING_FIELDS),
        { status: 400 }
      )
    }

    // 尝试从文本中提取 URL（容错处理：用户可能粘贴了带描述的文本）
    const url = extractUrlFromText(rawUrl) || rawUrl

    // 验证 URL 格式
    try {
      new URL(url)
    } catch {
      return NextResponse.json(
        createErrorResponse(API_ERROR_CODES.INVALID_URL),
        { status: 400 }
      )
    }

    // 验证是否为小红书链接
    if (!isXiaohongshuUrl(url)) {
      return NextResponse.json(
        createErrorResponse(API_ERROR_CODES.ONLY_XIAOHONGSHU),
        { status: 400 }
      )
    }

    // 验证身体数据范围（如果提供）
    if (climberHeight !== undefined && (climberHeight < 100 || climberHeight > 250)) {
      return NextResponse.json(
        createErrorResponse(API_ERROR_CODES.INVALID_HEIGHT),
        { status: 400 }
      )
    }
    if (climberReach !== undefined && (climberReach < 100 || climberReach > 250)) {
      return NextResponse.json(
        createErrorResponse(API_ERROR_CODES.INVALID_REACH),
        { status: 400 }
      )
    }

    // ==================== 3. 解析短链接 & 提取笔记 ID ====================
    // 并行启动：短链解析（网络 IO）和数据库连接（连接池）互不依赖
    const [resolvedUrl, db] = await Promise.all([
      resolveShortUrl(url),
      getDatabase(),
    ])

    // 从解析后的 URL 提取笔记 ID
    const noteId = extractXiaohongshuNoteId(resolvedUrl)

    if (!noteId) {
      return NextResponse.json(
        createErrorResponse(API_ERROR_CODES.CANNOT_PARSE_NOTE),
        { status: 400 }
      )
    }

    // ==================== 4. 去重检查 ====================

    // 检查线路是否存在，并获取现有的 betaLinks
    const route = await db.collection('routes').findOne(
      { _id: routeId as unknown as Document['_id'] },
      { projection: { betaLinks: 1 } }
    )

    if (!route) {
      return NextResponse.json(
        createErrorResponse(API_ERROR_CODES.ROUTE_NOT_FOUND),
        { status: 404 }
      )
    }

    // 检查是否已存在相同的笔记 ID
    const existingBetas = route.betaLinks || []
    const isDuplicate = existingBetas.some(
      (beta: { noteId?: string }) => beta.noteId === noteId
    )

    if (isDuplicate) {
      // 返回冲突错误：该 Beta 已被分享过
      log.info('Duplicate beta submission rejected', {
        action: 'POST /api/beta',
        duration: Date.now() - start,
        metadata: { routeId, noteId, ip: clientIp },
      })
      return NextResponse.json(
        createErrorResponse(API_ERROR_CODES.DUPLICATE_BETA),
        { status: 409 } // 409 Conflict
      )
    }

    // ==================== 5. 存储新 Beta ====================
    const betaId = `beta_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    const platform = detectPlatformFromUrl(url)

    const newBeta = {
      id: betaId,
      platform,
      noteId, // 存储笔记 ID 用于去重
      url: resolvedUrl,
      originalUrl: url !== resolvedUrl ? url : undefined,
      ...(author && typeof author === 'string' && { author: author.trim().slice(0, 30) }),
      ...(climberHeight && { climberHeight }),
      ...(climberReach && { climberReach }),
      createdAt: new Date(),
    }

    const result = await db.collection('routes').updateOne(
      { _id: routeId as unknown as Document['_id'] },
      {
        $push: { betaLinks: newBeta },
        $set: { updatedAt: new Date() }
      }
    )

    if (result.modifiedCount === 0) {
      log.error('Beta update failed', undefined, {
        action: 'POST /api/beta',
        duration: Date.now() - start,
        metadata: { routeId, betaId },
      })
      return NextResponse.json(
        createErrorResponse(API_ERROR_CODES.UPDATE_FAILED),
        { status: 500 }
      )
    }

    log.info('Beta created successfully', {
      action: 'POST /api/beta',
      duration: Date.now() - start,
      metadata: { routeId, betaId, noteId, ip: clientIp },
    })

    return NextResponse.json(
      {
        success: true,
        beta: newBeta,
      },
      {
        status: 201,
        headers: {
          'X-RateLimit-Remaining': String(rateLimitResult.remaining),
          'X-RateLimit-Reset': String(rateLimitResult.resetTime),
        },
      }
    )
  } catch (error) {
    log.error('Beta creation failed', error, {
      action: 'POST /api/beta',
      duration: Date.now() - start,
      metadata: { ip: clientIp },
    })
    return NextResponse.json(
      createErrorResponse(API_ERROR_CODES.SERVER_ERROR),
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/beta
 * 更新 Beta 链接的可编辑字段 (title, author, climberHeight, climberReach)
 * 需要登录 + 岩场编辑权限
 */
export async function PATCH(request: NextRequest) {
  const start = Date.now()

  // 认证检查
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  const { userId, role } = authResult

  try {
    const body = await request.json()
    const { routeId, betaId, title, author, climberHeight, climberReach } = body

    if (!routeId || !betaId) {
      return NextResponse.json(
        createErrorResponse(API_ERROR_CODES.MISSING_BETA_ID),
        { status: 400 }
      )
    }

    // 验证身体数据范围
    if (climberHeight !== undefined && (climberHeight < 100 || climberHeight > 250)) {
      return NextResponse.json(
        createErrorResponse(API_ERROR_CODES.INVALID_HEIGHT),
        { status: 400 }
      )
    }
    if (climberReach !== undefined && (climberReach < 100 || climberReach > 250)) {
      return NextResponse.json(
        createErrorResponse(API_ERROR_CODES.INVALID_REACH),
        { status: 400 }
      )
    }

    const db = await getDatabase()

    // 查找线路获取 cragId 以验证权限
    const route = await db.collection('routes').findOne(
      { _id: routeId as unknown as Document['_id'] },
      { projection: { cragId: 1 } }
    )
    if (!route) {
      return NextResponse.json(
        createErrorResponse(API_ERROR_CODES.ROUTE_NOT_FOUND),
        { status: 404 }
      )
    }
    if (!(await canEditCrag(userId, route.cragId, role))) {
      return NextResponse.json(
        { success: false, error: '无权编辑此岩场的 Beta' },
        { status: 403 }
      )
    }

    // 构建 $set 更新对象，仅更新提供的字段
    const setFields: Record<string, unknown> = { updatedAt: new Date() }
    if (title !== undefined) setFields['betaLinks.$[elem].title'] = typeof title === 'string' ? title.trim().slice(0, 100) || undefined : undefined
    if (author !== undefined) setFields['betaLinks.$[elem].author'] = typeof author === 'string' ? author.trim().slice(0, 30) || undefined : undefined
    if (climberHeight !== undefined) setFields['betaLinks.$[elem].climberHeight'] = climberHeight || undefined
    if (climberReach !== undefined) setFields['betaLinks.$[elem].climberReach'] = climberReach || undefined

    const result = await db.collection('routes').updateOne(
      { _id: routeId as unknown as Document['_id'] },
      { $set: setFields },
      { arrayFilters: [{ 'elem.id': betaId }] }
    )

    if (result.matchedCount === 0) {
      return NextResponse.json(
        createErrorResponse(API_ERROR_CODES.ROUTE_NOT_FOUND),
        { status: 404 }
      )
    }

    if (result.modifiedCount === 0) {
      return NextResponse.json(
        createErrorResponse(API_ERROR_CODES.BETA_NOT_FOUND),
        { status: 404 }
      )
    }

    log.info('Beta updated successfully', {
      action: 'PATCH /api/beta',
      duration: Date.now() - start,
      metadata: { routeId, betaId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error('Beta update failed', error, {
      action: 'PATCH /api/beta',
      duration: Date.now() - start,
    })
    return NextResponse.json(
      createErrorResponse(API_ERROR_CODES.SERVER_ERROR),
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/beta
 * 从线路中移除指定的 Beta 链接
 * 需要登录 + 岩场编辑权限
 */
export async function DELETE(request: NextRequest) {
  const start = Date.now()

  // 认证检查
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  const { userId, role } = authResult

  try {
    const body = await request.json()
    const { routeId, betaId } = body

    if (!routeId || !betaId) {
      return NextResponse.json(
        createErrorResponse(API_ERROR_CODES.MISSING_BETA_ID),
        { status: 400 }
      )
    }

    const db = await getDatabase()

    // 查找线路获取 cragId 以验证权限
    const route = await db.collection('routes').findOne(
      { _id: routeId as unknown as Document['_id'] },
      { projection: { cragId: 1 } }
    )
    if (!route) {
      return NextResponse.json(
        createErrorResponse(API_ERROR_CODES.ROUTE_NOT_FOUND),
        { status: 404 }
      )
    }
    if (!(await canEditCrag(userId, route.cragId, role))) {
      return NextResponse.json(
        { success: false, error: '无权删除此岩场的 Beta' },
        { status: 403 }
      )
    }

    const result = await db.collection('routes').updateOne(
      { _id: routeId as unknown as Document['_id'] },
      {
        $pull: { betaLinks: { id: betaId } } as Document,
        $set: { updatedAt: new Date() },
      }
    )

    if (result.matchedCount === 0) {
      return NextResponse.json(
        createErrorResponse(API_ERROR_CODES.ROUTE_NOT_FOUND),
        { status: 404 }
      )
    }

    if (result.modifiedCount === 0) {
      return NextResponse.json(
        createErrorResponse(API_ERROR_CODES.BETA_NOT_FOUND),
        { status: 404 }
      )
    }

    log.info('Beta deleted successfully', {
      action: 'DELETE /api/beta',
      duration: Date.now() - start,
      metadata: { routeId, betaId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error('Beta deletion failed', error, {
      action: 'DELETE /api/beta',
      duration: Date.now() - start,
    })
    return NextResponse.json(
      createErrorResponse(API_ERROR_CODES.SERVER_ERROR),
      { status: 500 }
    )
  }
}

/**
 * GET /api/beta?routeId=123
 * 获取指定线路的所有 Beta
 */
export async function GET(request: NextRequest) {
  const start = Date.now()

  try {
    const { searchParams } = new URL(request.url)
    const routeId = searchParams.get('routeId')

    if (!routeId) {
      return NextResponse.json(
        createErrorResponse(API_ERROR_CODES.MISSING_ROUTE_ID),
        { status: 400 }
      )
    }

    const db = await getDatabase()
    const routeIdNum = parseInt(routeId, 10)
    const route = await db.collection('routes').findOne(
      { _id: routeIdNum as unknown as Document['_id'] },
      { projection: { betaLinks: 1 } }
    )

    if (!route) {
      return NextResponse.json(
        createErrorResponse(API_ERROR_CODES.ROUTE_NOT_FOUND),
        { status: 404 }
      )
    }

    const betaCount = route.betaLinks?.length || 0
    log.debug(`Fetched ${betaCount} betas for route ${routeId}`, {
      action: 'GET /api/beta',
      duration: Date.now() - start,
    })

    return NextResponse.json(
      {
        success: true,
        betaLinks: route.betaLinks || [],
      },
      {
        headers: {
          'Cache-Control': `public, max-age=${HTTP_CACHE.BETA_MAX_AGE}`,
        },
      }
    )
  } catch (error) {
    log.error('Beta fetch failed', error, {
      action: 'GET /api/beta',
      duration: Date.now() - start,
    })
    return NextResponse.json(
      createErrorResponse(API_ERROR_CODES.SERVER_ERROR),
      { status: 500 }
    )
  }
}
