import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements } from 'better-auth/plugins/admin/access'
import type { CragPermission, UserRole } from './types'
import { getDatabase } from './mongodb'
import { getCragGrantUserFilter } from './crag-grant'

// ============ Access Control 定义 ============

const statement = {
  ...defaultStatements,
  editor: ["access"] as const,
  crag:   ["create", "update", "delete"] as const,
  route:  ["create", "update", "delete"] as const,
  face:   ["upload", "rename", "delete"] as const,
  beta:   ["approve", "delete"] as const,
} as const

export const ac = createAccessControl(statement)

export const roles = {
  user: ac.newRole({}),

  admin: ac.newRole({
    user: ["create", "list", "set-role", "ban", "impersonate", "delete", "set-password", "get", "update"],
    session: ["list", "revoke", "delete"],
    editor: ["access"],
    crag:   ["create", "update", "delete"],
    route:  ["create", "update", "delete"],
    face:   ["upload", "rename", "delete"],
    beta:   ["approve", "delete"],
  }),
}

// ============ 纯函数 — 无 DB 依赖 ============

/**
 * 判断用户是否可以创建岩场 (仅 admin)
 */
export function canCreateCrag(userRole: UserRole): boolean {
  return userRole === 'admin'
}

// ============ DB 查询权限函数 ============

/**
 * 判断用户是否可以编辑指定岩场
 * admin 可编辑所有岩场；creator/manager 可编辑被分配的岩场
 * 回退: crag.createdBy === userId 也授予编辑权 (防止 permission 记录创建失败的边界情况)
 */
export async function canEditCrag(userId: string, cragId: string, userRole: UserRole): Promise<boolean> {
  if (userRole === 'admin') return true
  const db = await getDatabase()
  const perm = await db.collection<CragPermission>('crag_permissions').findOne({ userId: getCragGrantUserFilter(userId), cragId })
  if (perm) return true
  // 回退: 检查 createdBy 字段
  const crag = await db.collection<{ _id: string; createdBy?: string }>('crags').findOne(
    { _id: cragId, createdBy: userId },
    { projection: { _id: 1 } }
  )
  return crag !== null
}

/**
 * 判断用户是否可以删除指定岩场 (仅 admin)
 */
export async function canDeleteCrag(userId: string, cragId: string, userRole: UserRole): Promise<boolean> {
  return userRole === 'admin'
}

/**
 * 判断用户是否可以管理岩场权限（分配/移除 manager）(仅 admin)
 */
export async function canManagePermissions(userId: string, cragId: string, userRole: UserRole): Promise<boolean> {
  return userRole === 'admin'
}

/**
 * 判断用户是否可以进入编辑器
 * admin 始终可以；有岩场授权或是岩场创建者的 user 也可以
 */
export async function canAccessEditor(userId: string, userRole: UserRole): Promise<boolean> {
  if (userRole === 'admin') return true
  // Use the same existing-crag boundary as the editor's list. A deleted crag's
  // leftover permission must not grant editor access by itself.
  return (await getEditableCragIds(userId, userRole)).length > 0
}

/**
 * 获取用户可编辑的岩场 ID 列表
 * admin 返回 'all'；其他用户返回实际存在的获授权/自己创建的岩场
 */
export async function getEditableCragIds(userId: string, userRole: UserRole): Promise<string[] | 'all'> {
  if (userRole === 'admin') return 'all'
  const db = await getDatabase()
  const perms = await db.collection<CragPermission>('crag_permissions').find({ userId: getCragGrantUserFilter(userId) }).toArray()
  const crags = await db.collection<{ _id: string; createdBy?: string }>('crags').find({
    $or: [{ _id: { $in: perms.map(p => p.cragId) } }, { createdBy: userId }],
  }, { projection: { _id: 1 } }).toArray()
  return [...new Set(crags.map(crag => crag._id))]
}
