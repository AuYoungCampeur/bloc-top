import { NextRequest, NextResponse } from 'next/server'
import type { UserRole } from './types'

export interface AuthInfo {
  userId: string
  role: UserRole
}

/**
 * Auth instance interface — matches the subset of better-auth API used here.
 * Each app provides its own auth instance via getAuth().
 */
export interface AuthInstance {
  api: {
    getSession: (opts: { headers: Headers; query: { disableCookieCache: true } }) => Promise<{ user?: { id?: string; role?: string | null } | null } | null>
  }
}

/**
 * Creates a requireAuth function bound to a specific auth provider.
 * This allows each app to use its own better-auth instance.
 *
 * Usage:
 *   const requireAuth = createRequireAuth(() => getAuth())
 */
export function createRequireAuth(
  getAuth: () => Promise<AuthInstance> | AuthInstance
): (request: NextRequest) => Promise<AuthInfo | NextResponse> {
  return async (request: NextRequest) => {
    const auth = await getAuth()
    // Authorization must observe current roles and revoked sessions, including
    // cookies issued by an older deployment with session-data caching enabled.
    const session = await auth.api.getSession({
      headers: request.headers,
      query: { disableCookieCache: true },
    })

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: '未登录' },
        { status: 401 }
      )
    }

    return {
      userId: session.user.id,
      role: (session.user.role || 'user') as UserRole,
    }
  }
}
