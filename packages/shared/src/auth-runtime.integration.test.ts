import { describe, expect, it } from 'vitest'
import { betterAuth } from 'better-auth'
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory'
import { getAuthRuntimeConfig } from './auth-runtime'
import { admin } from 'better-auth/plugins'
import { NextRequest, NextResponse } from 'next/server'
import { createRequireAuth } from './require-auth'

// Auth<Options> carries invariant adapter/plugin types in Better Auth 1.7.
// This helper only needs its public Request → Response handler.
interface AuthHandler {
  handler: (request: Request) => Promise<Response>
}

describe('localhost PWA → Editor session flow', () => {
  it('creates a usable shared session, rejects an external origin and revokes it on logout', async () => {
    const database: MemoryDB = { user: [], session: [], account: [], verification: [] }
    const createAuth = (app: 'pwa' | 'editor') => {
      const runtime = getAuthRuntimeConfig(app, { NODE_ENV: 'development' })
      return betterAuth({
        baseURL: app === 'pwa' ? 'http://localhost:3000' : 'http://localhost:3001',
        database: memoryAdapter(database),
        secret: 'bloctop-isolated-auth-integration-test-secret',
        trustedOrigins: runtime.trustedOrigins,
        advanced: runtime.advanced,
        session: runtime.session,
        emailAndPassword: { enabled: true },
      })
    }
    const pwa = createAuth('pwa')
    const editor = createAuth('editor')
    const response = await pwa.handler(new Request('http://localhost:3000/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email: 'manager@example.test', password: 'test-password-123', name: 'Manager' }),
    }))
    expect(response.status).toBe(200)
    const cookies = response.headers.getSetCookie()
    expect(cookies.some(cookie => cookie.startsWith('better-auth.session_token='))).toBe(true)
    expect(cookies.join(';')).not.toMatch(/Domain=|; Secure/i)
    const cookie = cookies.map(value => value.split(';')[0]).join('; ')
    const sessionResponse = await editor.handler(new Request('http://localhost:3001/api/auth/get-session', {
      headers: { Cookie: cookie, Origin: 'http://localhost:3001' },
    }))
    expect(sessionResponse.status).toBe(200)
    expect((await sessionResponse.json()).user.email).toBe('manager@example.test')

    const rejected = await editor.handler(new Request('http://localhost:3001/api/auth/sign-out', {
      method: 'POST', headers: { Cookie: cookie, Origin: 'https://external.example', 'Content-Type': 'application/json' },
      body: '{}',
    }))
    expect(rejected.status).toBe(403)
    const signOut = await editor.handler(new Request('http://localhost:3001/api/auth/sign-out', {
      method: 'POST', headers: { Cookie: cookie, Origin: 'http://localhost:3001', 'Content-Type': 'application/json' },
      body: '{}',
    }))
    expect(signOut.status).toBe(200)
    const revoked = await pwa.handler(new Request('http://localhost:3000/api/auth/get-session', {
      headers: { Cookie: cookie, Origin: 'http://localhost:3000' },
    }))
    expect(await revoked.json()).toBeNull()
  // Real password hashing and multiple auth handlers share CPU with workspace
  // checks. This verifies session behavior, not an authentication latency SLA.
  }, 15000)

  it('rejects legacy cached admin cookies immediately after demotion, logout and session disabling', async () => {
    const database: MemoryDB = { user: [], session: [], account: [], verification: [] }
    const createAuth = (app: 'pwa' | 'editor', legacyCache = false) => {
      const runtime = getAuthRuntimeConfig(app, { NODE_ENV: 'development' })
      return betterAuth({
        baseURL: `http://localhost:${app === 'pwa' ? 3000 : 3001}`,
        database: memoryAdapter(database),
        secret: 'bloctop-isolated-auth-integration-test-secret',
        trustedOrigins: runtime.trustedOrigins,
        advanced: runtime.advanced,
        session: legacyCache ? { ...runtime.session, cookieCache: { enabled: true, maxAge: 300 } } : runtime.session,
        emailAndPassword: { enabled: true },
        plugins: [admin({ defaultRole: 'user', adminRoles: ['admin'] })],
      })
    }
    const pwa = createAuth('pwa')
    const editor = createAuth('editor')
    const legacyPwa = createAuth('pwa', true)
    const cookieFrom = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const post = (auth: AuthHandler, port: number, path: string, body: object, cookie = '') => auth.handler(new Request(`http://localhost:${port}/api/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://localhost:${port}`, Cookie: cookie },
      body: JSON.stringify(body),
    }))
    const password = 'test-password-123'
    const users: Array<{ id: string; email: string }> = []
    for (const name of ['Owner', 'Demoted', 'Disabled']) {
      const response = await post(pwa, 3000, 'sign-up/email', { email: `${name.toLowerCase()}@example.test`, password, name })
      expect(response.status).toBe(200)
      const { user } = await response.json()
      users.push(user)
      // Fixture bootstrap only; subsequent role changes use the real admin handler.
      database.user.find(record => record.id === user.id)!.role = 'admin'
    }
    const signIn = (email: string, legacy = false) => post(legacy ? legacyPwa : pwa, 3000, 'sign-in/email', { email, password })
    const ownerCookie = cookieFrom(await signIn(users[0].email))
    const legacyResponse = await signIn(users[1].email, true)
    expect(legacyResponse.headers.getSetCookie().some(cookie => cookie.startsWith('better-auth.session_data='))).toBe(true)
    const oldAdminCookie = cookieFrom(legacyResponse)
    const authRequest = (cookie: string) => new NextRequest('http://localhost:3001/api/private', { headers: { Cookie: cookie } })
    const requireAuth = createRequireAuth(() => editor)
    // Prove the actual installed library's query bypass also works with caching enabled.
    const legacyRequireAuth = createRequireAuth(() => legacyPwa)
    expect(await requireAuth(authRequest(oldAdminCookie))).toEqual({ userId: users[1].id, role: 'admin' })
    const demotion = await post(editor, 3001, 'admin/set-role', { userId: users[1].id, role: 'user' }, ownerCookie)
    expect(demotion.status).toBe(200)
    expect(await requireAuth(authRequest(oldAdminCookie))).toEqual({ userId: users[1].id, role: 'user' })
    expect(await legacyRequireAuth(authRequest(oldAdminCookie))).toEqual({ userId: users[1].id, role: 'user' })

    for (const [auth, port] of [[pwa, 3000], [editor, 3001]] as const) {
      const listUsers = await auth.handler(new Request(`http://localhost:${port}/api/auth/admin/list-users`, { headers: { Cookie: oldAdminCookie } }))
      expect(listUsers.status).toBe(403)
      const forbiddenRole = await post(auth, port, 'admin/set-role', { userId: users[0].id, role: 'user' }, oldAdminCookie)
      expect(forbiddenRole.status).toBe(403)
    }
    expect(database.user.find(record => record.id === users[0].id)?.role).toBe('admin')

    expect((await post(editor, 3001, 'sign-out', {}, oldAdminCookie)).status).toBe(200)
    expect(await requireAuth(authRequest(oldAdminCookie))).toBeInstanceOf(NextResponse)
    expect((await requireAuth(authRequest(oldAdminCookie)) as NextResponse).status).toBe(401)
    expect(await legacyRequireAuth(authRequest(oldAdminCookie))).toBeInstanceOf(NextResponse)

    const disabledCookie = cookieFrom(await signIn(users[2].email, true))
    expect((await post(editor, 3001, 'admin/ban-user', { userId: users[2].id, banReason: 'isolated fixture' }, ownerCookie)).status).toBe(200)
    expect((await requireAuth(authRequest(disabledCookie)) as NextResponse).status).toBe(401)
    expect((await editor.handler(new Request('http://localhost:3001/api/auth/admin/list-users', { headers: { Cookie: disabledCookie } }))).status).toBe(401)
  }, 30000)
})
