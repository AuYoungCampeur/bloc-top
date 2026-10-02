import { NextRequest, NextResponse } from 'next/server'
import { getAllPrefectures, createPrefecture } from '@bloctop/shared/db'
import { getAuth } from '@/lib/auth'
import { createModuleLogger } from '@bloctop/shared/logger'
import { revalidateHomePage } from '@/lib/revalidate-pwa'

const log = createModuleLogger('API:Prefectures')

/**
 * GET /api/prefectures
 * 返回所有地级市
 */
export async function GET() {
  try {
    const prefectures = await getAllPrefectures()

    return NextResponse.json(
      { success: true, prefectures },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      },
    )
  } catch (error) {
    log.error('Failed to get prefectures', error, { action: 'GET /api/prefectures' })
    return NextResponse.json(
      { success: false, error: '获取地级市列表失败' },
      { status: 500 },
    )
  }
}

/**
 * POST /api/prefectures
 * 创建地级市 (需要 admin 权限)
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
    const { id, name, shortName, districts, defaultDistrict, sortOrder } = body

    if (!id || !name || !shortName || !districts || !defaultDistrict) {
      return NextResponse.json(
        { success: false, error: '缺少必填字段' },
        { status: 400 },
      )
    }

    const prefecture = await createPrefecture({
      id,
      name,
      shortName,
      districts,
      defaultDistrict,
      sortOrder,
    })

    log.info('Prefecture created', {
      action: 'POST /api/prefectures',
      metadata: { prefectureId: id, name },
    })

    await revalidateHomePage()

    return NextResponse.json({ success: true, prefecture }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建地级市失败'
    const status = message.includes('已存在') ? 409 : 500
    log.error('Failed to create prefecture', error, { action: 'POST /api/prefectures' })
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
