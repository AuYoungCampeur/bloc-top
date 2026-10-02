import { NextRequest, NextResponse } from 'next/server'
import { getAllCities, getAllPrefectures, createCity } from '@bloctop/shared/db'
import { getAuth } from '@/lib/auth'
import { createModuleLogger } from '@bloctop/shared/logger'
import { revalidateHomePage } from '@/lib/revalidate-pwa'

const log = createModuleLogger('API:Cities')

/**
 * GET /api/cities
 * 返回所有城市和地级市
 */
export async function GET() {
  try {
    const [cities, prefectures] = await Promise.all([
      getAllCities(),
      getAllPrefectures(),
    ])

    return NextResponse.json(
      { success: true, cities, prefectures },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      },
    )
  } catch (error) {
    log.error('Failed to get cities', error, { action: 'GET /api/cities' })
    return NextResponse.json(
      { success: false, error: '获取城市列表失败' },
      { status: 500 },
    )
  }
}

/**
 * POST /api/cities
 * 创建城市 (需要 admin 权限)
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuth()
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session || (session.user as { role?: string }).role !== 'admin') {
      return NextResponse.json(
        { success: false, error: '需要管理员权限' },
        { status: 403 },
      )
    }

    const body = await request.json()
    const { id, name, shortName, adcode, coordinates, available, prefectureId, sortOrder } = body

    if (!id || !name || !shortName || !adcode) {
      return NextResponse.json(
        { success: false, error: '缺少必填字段 (id, name, shortName, adcode)' },
        { status: 400 },
      )
    }

    const city = await createCity({
      id,
      name,
      shortName,
      adcode,
      coordinates: coordinates ?? { lng: 0, lat: 0 },
      available: available ?? false,
      prefectureId,
      sortOrder,
    })

    log.info('City created', {
      action: 'POST /api/cities',
      metadata: { cityId: id, name },
    })

    await revalidateHomePage()

    return NextResponse.json({ success: true, city }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建城市失败'
    const status = message.includes('已存在') ? 409 : 500
    log.error('Failed to create city', error, { action: 'POST /api/cities' })
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
