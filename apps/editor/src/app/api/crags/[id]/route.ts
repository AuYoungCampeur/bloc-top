import { NextRequest, NextResponse } from 'next/server'
import { getCragById, updateCrag, getAllCities } from '@bloctop/shared/db'
import { requireAuth } from '@/lib/require-auth'
import { canEditCrag } from '@bloctop/shared/permissions'
import { createModuleLogger } from '@bloctop/shared/logger'
import { revalidateCragPages } from '@/lib/revalidate-pwa'
import { validateCragInput } from '@/lib/crag-validation'

const log = createModuleLogger('API:Crag')

/**
 * GET /api/crags/[id]
 * 获取单个岩场
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const crag = await getCragById(id)
    if (!crag) {
      return NextResponse.json(
        { success: false, error: '岩场不存在' },
        { status: 404 }
      )
    }
    return NextResponse.json({ success: true, crag })
  } catch (error) {
    log.error('Failed to get crag', error, {
      action: 'GET /api/crags/[id]',
      metadata: { cragId: id },
    })
    return NextResponse.json(
      { success: false, error: '获取岩场失败' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/crags/[id]
 * 更新岩场信息 (需要岩场编辑权限)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 认证 + 权限检查
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  const { userId, role } = authResult

  const { id } = await params

  if (!(await canEditCrag(userId, id, role))) {
    return NextResponse.json(
      { success: false, error: '无权编辑此岩场' },
      { status: 403 }
    )
  }

  try {

    const body = await request.json().catch(() => null)
    const { fields: updates, errors } = validateCragInput(body, 'patch')
    if (Object.keys(errors).length) {
      return NextResponse.json(
        { success: false, error: Object.values(errors)[0], fieldErrors: errors },
        { status: 400 }
      )
    }
    if ('cityId' in updates && !(await getAllCities()).some(city => city.id === updates.cityId)) {
      return NextResponse.json({ success: false, error: '所属城市不存在' }, { status: 400 })
    }

    const crag = await updateCrag(id, updates)
    if (!crag) {
      return NextResponse.json(
        { success: false, error: '岩场不存在' },
        { status: 404 }
      )
    }

    log.info('Crag updated', {
      action: 'PATCH /api/crags/[id]',
      metadata: { cragId: id, fields: Object.keys(updates) },
    })

    revalidateCragPages(id)

    return NextResponse.json({ success: true, crag })
  } catch (error) {
    log.error('Failed to update crag', error, {
      action: 'PATCH /api/crags/[id]',
      metadata: { cragId: id },
    })
    return NextResponse.json(
      { success: false, error: '更新岩场失败' },
      { status: 500 }
    )
  }
}
