/** Internal grant identity shared by the grant and crag creation services. */
export function normalizeCragGrantUserId(userId: string): string {
  return /^[a-f\d]{24}$/i.test(userId) ? userId.toLowerCase() : userId
}

export function getCragGrantId(userId: string, cragId: string): string {
  return `crag-grant:${encodeURIComponent(normalizeCragGrantUserId(userId))}:${encodeURIComponent(cragId)}`
}

/** Match legacy ObjectId spellings without broadening opaque user IDs. */
export function getCragGrantUserFilter(userId: string): string | { $in: (string | RegExp)[] } {
  const canonical = normalizeCragGrantUserId(userId)
  return /^[a-f\d]{24}$/i.test(userId)
    ? { $in: [canonical, new RegExp(`^${canonical}$`, 'i')] }
    : userId
}

export class CragPermissionConflictError extends Error {
  readonly code = 11000

  constructor() {
    super('权限记录已存在')
    this.name = 'CragPermissionConflictError'
  }
}
