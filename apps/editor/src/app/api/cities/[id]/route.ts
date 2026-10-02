import { NextRequest, NextResponse } from 'next/server'
import { updateCity, deleteCity } from '@bloctop/shared/db'
import { getAuth } from '@/lib/auth'
import { createModuleLogger } from '@bloctop/shared/logger'
import { revalidateHomePage } from '@/lib/revalidate-pwa'

const log = createModuleLogger('API:Cities')

/**
 * PATCH /api/cities/:id
 * 更新城市 (需要 admin 权限)
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

    const city = await updateCity(id, updates)
    if (!city) {
      return NextResponse.json(
        { success: false, error: '城市不存在' },
        { status: 404 },
      )
    }

    log.info(`City updated: ${id}`, {
      action: 'PATCH /api/cities/:id',
      metadata: { cityId: id, fields: Object.keys(updates) },
    })

    await revalidateHomePage()

    return NextResponse.json({ success: true, city })
  } catch (error) {
    log.error('Failed to update city', error, { action: 'PATCH /api/cities/:id' })
    return NextResponse.json(
      { success: false, error: '更新城市失败' },
      { status: 500 },
    )
  }
}

/**
 * DELETE /api/cities/:id
 * 删除城市 (需要 admin 权限)
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
    const deleted = await deleteCity(id)

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: '城市不存在' },
        { status: 404 },
      )
    }

    log.info(`City deleted: ${id}`, {
      action: 'DELETE /api/cities/:id',
    })

    await revalidateHomePage()

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error('Failed to delete city', error, { action: 'DELETE /api/cities/:id' })
    return NextResponse.json(
      { success: false, error: '删除城市失败' },
      { status: 500 },
    )
  }
}
