import { NextRequest, NextResponse } from 'next/server'
import { updateCragAreas } from '@bloctop/shared/db'
import { requireAuth } from '@/lib/require-auth'
import { canEditCrag } from '@bloctop/shared/permissions'
import { createModuleLogger } from '@bloctop/shared/logger'
import { revalidateCragPages } from '@/lib/revalidate-pwa'

const log = createModuleLogger('API:CragAreas')

/**
 * PATCH /api/crags/[id]/areas
 * 更新岩场的区域列表 (需要岩场编辑权限)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: cragId } = await params

  if (!cragId) {
    return NextResponse.json(
      { success: false, error: '岩场 ID 不能为空' },
      { status: 400 }
    )
  }

  // 认证 + 权限检查
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  const { userId, role } = authResult

  if (!(await canEditCrag(userId, cragId, role))) {
    return NextResponse.json(
      { success: false, error: '无权编辑此岩场' },
      { status: 403 }
    )
  }

  try {
    const body = await request.json()
    const { areas } = body

    if (!Array.isArray(areas) || !areas.every((a: unknown) => typeof a === 'string')) {
      return NextResponse.json(
        { success: false, error: 'areas 必须是字符串数组' },
        { status: 400 }
      )
    }

    const updatedAreas = await updateCragAreas(cragId, areas)

    await revalidateCragPages(cragId)

    return NextResponse.json({
      success: true,
      areas: updatedAreas,
    })
  } catch (error) {
    log.error('Failed to update crag areas', error, {
      action: 'PATCH /api/crags/[id]/areas',
      metadata: { cragId },
    })
    return NextResponse.json(
      { success: false, error: '更新区域失败' },
      { status: 500 }
    )
  }
}
