import { describe, expect, it } from 'vitest'
import { betterAuth } from 'better-auth'
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory'
import { getAuthRuntimeConfig } from './auth-runtime'

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
})
