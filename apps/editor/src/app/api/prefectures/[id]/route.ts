import { NextRequest, NextResponse } from 'next/server'
import { updatePrefecture, deletePrefecture } from '@bloctop/shared/db'
import { getAuth } from '@/lib/auth'
import { createModuleLogger } from '@bloctop/shared/logger'
import { revalidateHomePage } from '@/lib/revalidate-pwa'

const log = createModuleLogger('API:Prefectures')

/**
 * PATCH /api/prefectures/:id
 * 更新地级市 (需要 admin 权限)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuth()
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session || (session.user as { role?: string }).role !== 'admin') {
      return NextResponse.json(
        { success: false, error: '需要管理员权限' },
        { status: 403 },
      )
    }

    const { id } = await params
    const updates = await request.json()

    const prefecture = await updatePrefecture(id, updates)
    if (!prefecture) {
      return NextResponse.json(
        { success: false, error: '地级市不存在' },
        { status: 404 },
      )
    }

    log.info(`Prefecture updated: ${id}`, {
      action: 'PATCH /api/prefectures/:id',
      metadata: { prefectureId: id, fields: Object.keys(updates) },
    })

    await revalidateHomePage()

    return NextResponse.json({ success: true, prefecture })
  } catch (error) {
    log.error('Failed to update prefecture', error, { action: 'PATCH /api/prefectures/:id' })
    return NextResponse.json(
      { success: false, error: '更新地级市失败' },
      { status: 500 },
    )
  }
}

/**
 * DELETE /api/prefectures/:id
 * 删除地级市 (需要 admin 权限)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuth()
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session || (session.user as { role?: string }).role !== 'admin') {
      return NextResponse.json(
        { success: false, error: '需要管理员权限' },
        { status: 403 },
      )
    }

    const { id } = await params
    const deleted = await deletePrefecture(id)

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: '地级市不存在' },
        { status: 404 },
      )
    }

    log.info(`Prefecture deleted: ${id}`, {
      action: 'DELETE /api/prefectures/:id',
    })

    await revalidateHomePage()

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error('Failed to delete prefecture', error, { action: 'DELETE /api/prefectures/:id' })
    return NextResponse.json(
      { success: false, error: '删除地级市失败' },
      { status: 500 },
    )
  }
}
