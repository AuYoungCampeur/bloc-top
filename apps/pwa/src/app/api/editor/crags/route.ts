import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/require-auth'
import { canCreateCrag, getEditableCragIds } from '@/lib/permissions'
import { getAllCrags, getCragPermissionsByUserId } from '@/lib/db'

/**
 * GET /api/editor/crags
 * 返回当前用户可编辑的岩场列表（编辑器专用）
 * 同时返回 role、canCreate、每个岩场的用户权限角色
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  const { userId, role } = authResult

  const isAdmin = role === 'admin'

  // admin 也查 permission 表，以显示岩场级具体角色
  const [allCrags, permissions, editableIds] = await Promise.all([
    getAllCrags(),
    getCragPermissionsByUserId(userId),
    getEditableCragIds(userId, role),
  ])

  // 构建 cragId → permission role 映射
  const permMap = new Map(permissions.map(p => [p.cragId, p.role]))

  const crags = isAdmin
    // admin 看到所有岩场，优先显示岩场级角色，无记录则 fallback 为 'admin'
    ? allCrags.map(c => ({ ...c, permissionRole: permMap.get(c.id) ?? 'admin' as const }))
    : allCrags
        .filter(c => editableIds.includes(c.id))
        .map(c => ({ ...c, permissionRole: permMap.get(c.id) ?? 'manager' as const }))

  return NextResponse.json({
    crags,
    role,
    canCreate: canCreateCrag(role),
  })
}
