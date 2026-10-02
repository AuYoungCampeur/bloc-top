import { NextRequest, NextResponse } from 'next/server'
import { getAllCrags, getCragsByCityId, getAllCities } from '@bloctop/shared/db'
import { createCragWithCreatorPermission, CragCreationConflictError, type NewCragInput } from '@bloctop/shared/crag-creation'
import { isCityValid } from '@bloctop/shared/city-utils'
import { requireAuth } from '@/lib/require-auth'
import { canCreateCrag } from '@bloctop/shared/permissions'
import { createModuleLogger } from '@bloctop/shared/logger'
import { revalidateHomePage } from '@/lib/revalidate-pwa'
import { validateCragInput } from '@/lib/crag-validation'

const log = createModuleLogger('API:Crags')

/**
 * GET /api/crags
 * GET /api/crags?cityId=luoyuan
 * 获取岩场列表（可选按城市过滤）
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const cityId = searchParams.get('cityId')

    const cities = await getAllCities()
    const crags = cityId && isCityValid(cities, cityId)
      ? await getCragsByCityId(cityId)
      : await getAllCrags()

    return NextResponse.json({
      success: true,
      crags,
    })
  } catch (error) {
    log.error('Failed to get crags', error, {
      action: 'GET /api/crags',
    })
    return NextResponse.json(
      { success: false, error: '获取岩场列表失败' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/crags
 * 创建新岩场 (需要 admin 权限)
 */
export async function POST(request: NextRequest) {
  // 认证 + 角色检查
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  const { userId, role } = authResult

  if (!canCreateCrag(role)) {
    return NextResponse.json(
      { success: false, error: '需要管理员权限' },
      { status: 403 }
    )
  }

  try {
    const body = await request.json().catch(() => null)
    const { fields, errors } = validateCragInput(body, 'create')
    if (Object.keys(errors).length) {
      return NextResponse.json(
        { success: false, error: Object.values(errors)[0], fieldErrors: errors },
        { status: 400 }
      )
    }
    const cities = await getAllCities()
    if (!cities.some(city => city.id === fields.cityId)) {
      return NextResponse.json(
        { success: false, error: '所属城市不存在', fieldErrors: { cityId: '所属城市不存在，请重新选择' } },
        { status: 400 }
      )
    }
    const { id, name } = fields as { id: string; name: string }
    const { crag, replayed } = await createCragWithCreatorPermission(fields as NewCragInput, userId)

    log.info('Crag created', {
      action: 'POST /api/crags',
      metadata: { cragId: id, name, createdBy: userId },
    })

    revalidateHomePage()

    return NextResponse.json({ success: true, crag, replayed }, { status: replayed ? 200 : 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建岩场失败'
    const status = error instanceof CragCreationConflictError ? 409 : 500
    log.error('Failed to create crag', error, { action: 'POST /api/crags' })
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
