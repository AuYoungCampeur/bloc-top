import { NextRequest, NextResponse } from 'next/server'
import { getRouteById, updateRoute, deleteRoute } from '@bloctop/shared/db'
import { requireAuth } from '@/lib/require-auth'
import { canEditCrag } from '@bloctop/shared/permissions'
import { createModuleLogger } from '@bloctop/shared/logger'
import { revalidateCragPages } from '@/lib/revalidate-pwa'
import type { Route } from '@bloctop/shared/types'
import { parseRouteTopoUpdates, TopoValidationError } from '@bloctop/shared/route-topo-validation'
import { TopoVersionError } from '@bloctop/shared/route-topo-version'

const log = createModuleLogger('API:Routes')

/**
 * GET /api/routes/[id]
 * 获取单条线路详情
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const routeId = /^[1-9]\d*$/.test(id) ? Number(id) : NaN

  if (!Number.isSafeInteger(routeId)) {
    return NextResponse.json(
      { success: false, error: '无效的线路 ID' },
      { status: 400 }
    )
  }

  try {
    const route = await getRouteById(routeId)

    if (!route) {
      return NextResponse.json(
        { success: false, error: '线路不存在' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, route })
  } catch (error) {
    log.error('Failed to get route', error, {
      action: 'GET /api/routes/[id]',
      metadata: { routeId },
    })
    return NextResponse.json(
      { success: false, error: '获取线路失败' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/routes/[id]
 * 更新线路信息（支持部分更新）
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 认证检查
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  const { userId, role } = authResult

  const { id } = await params
  const routeId = /^[1-9]\d*$/.test(id) ? Number(id) : NaN

  if (!Number.isSafeInteger(routeId)) {
    return NextResponse.json(
      { success: false, error: '无效的线路 ID' },
      { status: 400 }
    )
  }

  // 先获取线路以得到 cragId
  const existingRoute = await getRouteById(routeId)
  if (!existingRoute) {
    return NextResponse.json(
      { success: false, error: '线路不存在' },
      { status: 404 }
    )
  }

  // 权限检查
  if (!(await canEditCrag(userId, existingRoute.cragId, role))) {
    return NextResponse.json(
      { success: false, error: '无权编辑此岩场的线路' },
      { status: 403 }
    )
  }

  try {
    let body: Record<string, unknown>
    try {
      const parsed: unknown = await request.json()
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid body')
      body = parsed as Record<string, unknown>
    } catch { return NextResponse.json({ success: false, error: '请求数据格式无效' }, { status: 400 }) }
    const expectedTopoVersion = body.expectedTopoVersion
    if (Object.hasOwn(body, 'expectedTopoVersion') && (typeof expectedTopoVersion !== 'number' || !Number.isSafeInteger(expectedTopoVersion) || expectedTopoVersion < 0)) {
      return NextResponse.json({ success: false, error: 'expectedTopoVersion 必须是非负安全整数' }, { status: 400 })
    }
    const updates: Partial<Omit<Route, 'id' | 'topoVersion'>> = {}

    // 验证并收集可更新的字段
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim() === '') {
        return NextResponse.json(
          { success: false, error: '线路名称不能为空' },
          { status: 400 }
        )
      }
      updates.name = body.name.trim()
    }

    if (body.grade !== undefined) {
      if (typeof body.grade !== 'string') {
        return NextResponse.json(
          { success: false, error: '难度格式无效' },
          { status: 400 }
        )
      }
      updates.grade = body.grade
    }

    if (body.area !== undefined) {
      if (typeof body.area !== 'string') {
        return NextResponse.json(
          { success: false, error: '区域格式无效' },
          { status: 400 }
        )
      }
      updates.area = body.area.trim()
    }

    for (const field of ['setter', 'FA', 'description', 'image'] as const) {
      if (body[field] !== undefined) {
        if (body[field] !== null && typeof body[field] !== 'string') return NextResponse.json({ success: false, error: `${field} 格式无效` }, { status: 400 })
        updates[field] = typeof body[field] === 'string' ? body[field].trim() || undefined : undefined
      }
    }

    // Server owns the array-to-legacy projection, including the image area.
    try {
      Object.assign(updates, parseRouteTopoUpdates(body))
    } catch (error) {
      if (error instanceof TopoValidationError) return NextResponse.json({ success: false, error: error.message }, { status: 400 })
      throw error
    }

    // 检查是否有需要更新的字段
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: '没有需要更新的字段' },
        { status: 400 }
      )
    }

    const updatedRoute = await updateRoute(routeId, updates, { expectedTopoVersion: expectedTopoVersion as number | undefined })

    if (!updatedRoute) {
      return NextResponse.json(
        { success: false, error: '线路不存在' },
        { status: 404 }
      )
    }

    log.info('Route updated', {
      action: 'PATCH /api/routes/[id]',
      metadata: { routeId, fields: Object.keys(updates) },
    })

    const publication = await revalidateCragPages(existingRoute.cragId)

    return NextResponse.json({
      success: true,
      route: updatedRoute,
      message: '更新成功',
      ...(publication?.ok === false ? { refreshPending: true } : {}),
    })
  } catch (error) {
    if (error instanceof TopoVersionError) {
      return NextResponse.json({ success: false, code: error.code, error: error.message,
        route: error.route, topoVersion: error.route.topoVersion }, { status: error.status })
    }
    log.error('Failed to update route', error, {
      action: 'PATCH /api/routes/[id]',
      metadata: { routeId },
    })
    return NextResponse.json(
      { success: false, error: '更新线路失败' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/routes/[id]
 * 删除线路（含内嵌的 betaLinks、topoLine）
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 认证检查
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  const { userId, role } = authResult

  const start = Date.now()
  const { id } = await params
  const routeId = /^[1-9]\d*$/.test(id) ? Number(id) : NaN

  if (!Number.isSafeInteger(routeId)) {
    return NextResponse.json(
      { success: false, error: '无效的线路 ID' },
      { status: 400 }
    )
  }

  // 先获取线路以得到 cragId
  const existingRoute = await getRouteById(routeId)
  if (!existingRoute) {
    return NextResponse.json(
      { success: false, error: '线路不存在' },
      { status: 404 }
    )
  }

  // 权限检查
  if (!(await canEditCrag(userId, existingRoute.cragId, role))) {
    return NextResponse.json(
      { success: false, error: '无权删除此岩场的线路' },
      { status: 403 }
    )
  }

  try {
    const deleted = await deleteRoute(routeId)

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: '线路不存在' },
        { status: 404 }
      )
    }

    log.info('Route deleted', {
      action: 'DELETE /api/routes/[id]',
      duration: Date.now() - start,
      metadata: { routeId },
    })

    const publication = await revalidateCragPages(existingRoute.cragId)

    return NextResponse.json({ success: true, ...(publication?.ok === false ? { refreshPending: true } : {}) })
  } catch (error) {
    log.error('Failed to delete route', error, {
      action: 'DELETE /api/routes/[id]',
      duration: Date.now() - start,
    })
    return NextResponse.json(
      { success: false, error: '删除线路失败' },
      { status: 500 }
    )
  }
}
