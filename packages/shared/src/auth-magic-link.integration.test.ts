import { describe, expect, it } from 'vitest'
import { betterAuth } from 'better-auth'
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory'
import { admin, magicLink } from 'better-auth/plugins'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthRuntimeConfig } from './auth-runtime'
import { createAuthRouteHandlers } from './auth-route'
import { createRequireAuth } from './require-auth'
import { legacyAuthFixture } from './test-fixtures/better-auth-1.4.18'

interface AuthHandler {
  handler: (request: Request) => Promise<Response>
}

const cookieFrom = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
function post(auth: AuthHandler, path: string, body: object, cookie = '', port = 3000) {
  return auth.handler(new Request(`http://localhost:${port}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: `http://localhost:${port}`, Cookie: cookie },
    body: JSON.stringify(body),
  }))
}

function fixture(hashVerificationIdentifiers = false) {
  const database: MemoryDB = { user: [], session: [], account: [], verification: [] }
  const delivered: Array<{ email: string; url: string }> = []
  const createAuth = (app: 'pwa' | 'editor') => {
    const runtime = getAuthRuntimeConfig(app, { NODE_ENV: 'development' })
    return betterAuth({
      baseURL: `http://localhost:${app === 'pwa' ? 3000 : 3001}`,
      database: memoryAdapter(database),
      secret: 'bloctop-isolated-auth-integration-test-secret',
      trustedOrigins: runtime.trustedOrigins,
      advanced: runtime.advanced,
      session: runtime.session,
      emailAndPassword: { enabled: true, minPasswordLength: 4 },
      account: { accountLinking: { enabled: true } },
      verification: { storeIdentifier: hashVerificationIdentifiers ? 'hashed' : 'plain' },
      plugins: [
        admin({ defaultRole: 'user', adminRoles: ['admin'] }),
        ...(app === 'pwa' ? [magicLink({
          expiresIn: 600,
          // An in-memory mail collector: no email SDK or external request.
          sendMagicLink: async ({ email, url }) => { delivered.push({ email, url }) },
        })] : []),
      ],
    })
  }
  const pwa = createAuth('pwa')
  const editor = createAuth('editor')
  const routes = createAuthRouteHandlers(async () => pwa, 'isolated-magic-link')
  const requireEditor = createRequireAuth(() => editor)
  const getSession = (cookie: string, auth: AuthHandler = pwa, port = 3000) => auth.handler(new Request(`http://localhost:${port}/api/auth/get-session`, {
    headers: { Cookie: cookie, Origin: `http://localhost:${port}` },
  }))
  const requestLink = async (email: string) => {
    expect((await post(pwa, 'sign-in/magic-link', { email, callbackURL: '/profile' })).status).toBe(200)
    const delivery = delivered.at(-1)!
    expect(delivery.email).toBe(email)
    return delivery.url
  }
  const verify = (url: string) => routes.GET(new Request(url, { headers: { Origin: 'http://localhost:3000' } }))
  return { database, pwa, editor, delivered, getSession, requestLink, verify, requireEditor }
}

describe('isolated Better Auth Magic Link security and compatibility', () => {
  it('accepts real 1.4.18 password hashes and signed production cookies without a user/session migration', async () => {
    const now = new Date()
    const database: MemoryDB = {
      user: [{ ...legacyAuthFixture.user, createdAt: now, updatedAt: now }],
      account: [{ ...legacyAuthFixture.account, createdAt: now, updatedAt: now }],
      session: [{ ...legacyAuthFixture.session, createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 86_400_000) }],
      verification: [],
    }
    // Only renew timestamps, so this compatibility vector stays useful after
    // the original fixture's expiry. Hash, token and cookie remain unchanged.
    const createAuth = (app: 'pwa' | 'editor') => {
      const runtime = getAuthRuntimeConfig(app, { NODE_ENV: 'production', VERCEL_ENV: 'production' })
      return betterAuth({
        baseURL: app === 'pwa' ? 'https://bouldering.top' : 'https://editor.bouldering.top',
        database: memoryAdapter(database),
        secret: 'bloctop-isolated-auth-integration-test-secret',
        trustedOrigins: runtime.trustedOrigins,
        advanced: runtime.advanced,
        session: runtime.session,
        emailAndPassword: { enabled: true, minPasswordLength: 4 },
        plugins: [admin({ defaultRole: 'user', adminRoles: ['admin'] })],
      })
    }
    for (const app of ['pwa', 'editor'] as const) {
      const auth = createAuth(app)
      const origin = app === 'pwa' ? 'https://bouldering.top' : 'https://editor.bouldering.top'
      const response = await auth.handler(new Request(`${origin}/api/auth/get-session`, { headers: { Cookie: legacyAuthFixture.cookie } }))
      expect(response.status).toBe(200)
      expect((await response.json()).user.id).toBe(legacyAuthFixture.user.id)
      const requireAuth = createRequireAuth(() => auth)
      expect(await requireAuth(new NextRequest(`${origin}/api/private`, { headers: { Cookie: legacyAuthFixture.cookie } }))).toEqual({ userId: legacyAuthFixture.user.id, role: 'user' })
      const passwordLogin = await auth.handler(new Request(`${origin}/api/auth/sign-in/email`, {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: legacyAuthFixture.user.email, password: legacyAuthFixture.password }),
      }))
      expect(passwordLogin.status).toBe(200)
      expect((await passwordLogin.json()).user.id).toBe(legacyAuthFixture.user.id)
      expect(database.account[0].password).toBe(legacyAuthFixture.account.password)
      // Legacy cached profile cannot prevent the shared helper observing a role change.
      database.user[0].role = 'admin'
      expect(await requireAuth(new NextRequest(`${origin}/api/private`, { headers: { Cookie: legacyAuthFixture.cookie } }))).toEqual({ userId: legacyAuthFixture.user.id, role: 'admin' })
      database.user[0].role = 'user'
    }
  }, 15000)

  it('proves the mailbox, clears an unverified preregistration password and revokes all prior sessions', async () => {
    const f = fixture()
    const email = 'mailbox-owner@example.test'
    const plantedPassword = 'unverified-password-123'
    const preregistration = await post(f.pwa, 'sign-up/email', { email, password: plantedPassword, name: 'Unproven owner' })
    expect(preregistration.status).toBe(200)
    const { user } = await preregistration.json()
    expect(user.emailVerified).toBe(false)
    const oldCookie = cookieFrom(preregistration)
    const secondLogin = await post(f.pwa, 'sign-in/email', { email, password: plantedPassword })
    expect(secondLogin.status).toBe(200)
    const secondCookie = cookieFrom(secondLogin)
    expect(f.database.session.filter(row => row.userId === user.id)).toHaveLength(2)

    const url = await f.requestLink(email)
    const verified = await f.verify(url)
    expect(verified.status).toBe(302)
    expect(verified.headers.get('Location')).toBe('http://localhost:3000/profile')
    expect(verified.headers.get('Cache-Control')).toContain('no-store')
    const ownerCookie = cookieFrom(verified)
    const ownerSession = await (await f.getSession(ownerCookie)).json()
    expect(ownerSession.user).toMatchObject({ id: user.id, email, emailVerified: true })
    expect(f.database.account.filter(row => row.userId === user.id && row.providerId === 'credential')).toHaveLength(0)
    expect(f.database.session.filter(row => row.userId === user.id)).toHaveLength(1)
    expect((await post(f.pwa, 'sign-in/email', { email, password: plantedPassword })).status).toBe(401)

    for (const cookie of [oldCookie, secondCookie]) {
      expect(await (await f.getSession(cookie)).json()).toBeNull()
      expect(await (await f.getSession(cookie, f.editor, 3001)).json()).toBeNull()
      const denied = await f.requireEditor(new NextRequest('http://localhost:3001/api/private', { headers: { Cookie: cookie } }))
      expect(denied).toBeInstanceOf(NextResponse)
      expect((denied as NextResponse).status).toBe(401)
    }
    expect(await f.requireEditor(new NextRequest('http://localhost:3001/api/private', { headers: { Cookie: ownerCookie } }))).toEqual({ userId: user.id, role: 'user' })

    // The verified owner can explicitly establish their own password afterward.
    const replacement = 'verified-owner-password-456'
    // Mirrors the existing PWA /api/auth/set-password server-only wrapper.
    await f.pwa.api.setPassword({ body: { newPassword: replacement }, headers: new Headers({ Cookie: ownerCookie }) })
    expect((await post(f.pwa, 'sign-in/email', { email, password: replacement })).status).toBe(200)
    const replay = await f.verify(url)
    expect(new URL(replay.headers.get('Location')!).searchParams.get('error')).toBe('INVALID_TOKEN')
    expect(cookieFrom(replay)).toBe('')
  }, 15000)

  it('keeps the password and existing sessions of an already verified account', async () => {
    const f = fixture()
    const email = 'verified-owner@example.test'
    const password = 'verified-password-123'
    const signup = await post(f.pwa, 'sign-up/email', { email, password, name: 'Verified owner' })
    const { user } = await signup.json()
    // Represents a previously verified persisted account, not a verification bypass in the app.
    await (await f.pwa.$context).internalAdapter.updateUser(user.id, { emailVerified: true })
    const oldCookie = cookieFrom(await post(f.pwa, 'sign-in/email', { email, password }))
    const beforeHash = f.database.account.find(row => row.userId === user.id && row.providerId === 'credential')!.password
    const verified = await f.verify(await f.requestLink(email))
    expect(verified.status).toBe(302)
    expect((await (await f.getSession(oldCookie)).json()).user.id).toBe(user.id)
    expect((await (await f.getSession(oldCookie, f.editor, 3001)).json()).user.id).toBe(user.id)
    const passwordLogin = await post(f.pwa, 'sign-in/email', { email, password })
    expect(passwordLogin.status).toBe(200)
    expect((await passwordLogin.json()).user.id).toBe(user.id)
    expect(f.database.account.find(row => row.userId === user.id && row.providerId === 'credential')!.password).toBe(beforeHash)
  }, 15000)

  it.each([false, true])('isolates verification purposes and rejects legacy links (identifier hashing=%s)', async hashIdentifiers => {
    const f = fixture(hashIdentifiers)
    const adapter = (await f.pwa.$context).internalAdapter
    const expiresAt = new Date(Date.now() + 600_000)
    const email = 'isolated-purpose@example.test'
    // Project OAuth providers remain disabled. These are stored-record fixtures
    // for the fixed purpose boundary, not an OAuth sign-in integration claim.
    for (const [token, identifier, value] of [
      ['legacy-pending-link', 'legacy-pending-link', { email, name: 'Old link' }],
      ['other-purpose-state', 'auth-state:other-purpose-state', { state: 'other-purpose-state', email }],
      ['wrong-purpose-record', 'magic-link:wrong-purpose-record', { type: 'auth-state', email }],
    ] as const) {
      await adapter.createVerificationValue({ identifier, value: JSON.stringify(value), expiresAt })
      const before = await adapter.findVerificationValue(identifier)
      expect(before).not.toBeNull()
      const result = await f.verify(`http://localhost:3000/api/auth/magic-link/verify?token=${token}&callbackURL=/profile`)
      expect(result.status).toBe(302)
      expect(new URL(result.headers.get('Location')!).searchParams.get('error')).toBe('INVALID_TOKEN')
      expect(cookieFrom(result)).toBe('')
      expect(f.database.user).toHaveLength(0)
      expect(f.database.session).toHaveLength(0)
      expect(await adapter.findVerificationValue(identifier)).not.toBeNull()
    }
    const valid = await f.verify(await f.requestLink(email))
    expect(valid.status).toBe(302)
    expect((await (await f.getSession(cookieFrom(valid))).json()).user).toMatchObject({ email, emailVerified: true })
  }, 15000)
})
