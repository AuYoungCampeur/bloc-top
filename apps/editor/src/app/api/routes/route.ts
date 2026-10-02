import { NextRequest, NextResponse } from 'next/server'
import { createRoute } from '@bloctop/shared/db'
import { requireAuth } from '@/lib/require-auth'
import { canEditCrag } from '@bloctop/shared/permissions'
import { createModuleLogger } from '@bloctop/shared/logger'
import { revalidateCragPages } from '@/lib/revalidate-pwa'

const log = createModuleLogger('API:Routes')

/**
 * POST /api/routes
 * 创建新线路 (需要岩场编辑权限)
 */
export async function POST(request: NextRequest) {
  // 认证 + 权限检查 (cragId 在 body 中，需要先解析)
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  const { userId, role } = authResult

  try {
    const body = await request.json()

    // 验证必填字段
    const { name, grade, cragId, area } = body

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json(
        { success: false, error: '线路名称不能为空' },
        { status: 400 }
      )
    }

    if (!grade || typeof grade !== 'string') {
      return NextResponse.json(
        { success: false, error: '难度不能为空' },
        { status: 400 }
      )
    }

    if (!cragId || typeof cragId !== 'string') {
      return NextResponse.json(
        { success: false, error: '岩场 ID 不能为空' },
        { status: 400 }
      )
    }

    if (!area || typeof area !== 'string') {
      return NextResponse.json(
        { success: false, error: '区域不能为空' },
        { status: 400 }
      )
    }

    // 权限检查：用户是否可以编辑此岩场
    if (!(await canEditCrag(userId, cragId, role))) {
      return NextResponse.json(
        { success: false, error: '无权编辑此岩场' },
        { status: 403 }
      )
    }

    const routeData = {
      name: name.trim(),
      grade,
      cragId,
      area: area.trim(),
      setter: body.setter?.trim() || undefined,
      FA: body.FA?.trim() || undefined,
      description: body.description?.trim() || undefined,
      faceId: body.faceId || undefined,
    }

    const route = await createRoute(routeData)

    log.info('Route created', {
      action: 'POST /api/routes',
      metadata: { routeId: route.id, name: route.name, cragId: route.cragId },
    })

    const publication = await revalidateCragPages(route.cragId)

    return NextResponse.json({ success: true, route, ...(publication?.ok === false ? { refreshPending: true } : {}) }, { status: 201 })
  } catch (error) {
    log.error('Failed to create route', error, {
      action: 'POST /api/routes',
    })
    return NextResponse.json(
      { success: false, error: '创建线路失败' },
      { status: 500 }
    )
  }
}
