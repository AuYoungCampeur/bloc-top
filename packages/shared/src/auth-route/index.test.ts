import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockHandlers = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }))
vi.mock('better-auth/next-js', () => ({ toNextJsHandler: () => mockHandlers }))
import { createAuthRouteHandlers } from './index'

const auth = { handler: async () => new Response() }
beforeEach(() => {
  vi.clearAllMocks()
  mockHandlers.GET.mockReset()
  mockHandlers.POST.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('private auth route responses', () => {
  it.each(['GET', 'POST'] as const)('preserves %s payload and both cookies with no-store', async method => {
    const response = Response.json({ session: 'fixture-session' })
    response.headers.append('Set-Cookie', 'session=one; HttpOnly; Secure')
    response.headers.append('Set-Cookie', 'csrf=two; Secure')
    response.headers.set('Cache-Control', 'public, max-age=3600')
    mockHandlers[method].mockResolvedValueOnce(response)
    const request = new Request('https://example.invalid/api/auth/get-session')
    const result = await createAuthRouteHandlers(async () => auth, 'fixture')[method](request)
    expect(await result.json()).toEqual({ session: 'fixture-session' })
    expect(result.headers.getSetCookie()).toEqual(response.headers.getSetCookie())
    expect(result.headers.get('Cache-Control')).toBe('private, no-store, max-age=0')
    expect(mockHandlers[method]).toHaveBeenCalledWith(request)
  })

  it('preserves an immutable redirect without converting login into an error', async () => {
    mockHandlers.GET.mockResolvedValueOnce(Response.redirect('https://example.invalid/complete', 302))
    const result = await createAuthRouteHandlers(async () => auth, 'fixture').GET(new Request('https://example.invalid/login'))
    expect(result.status).toBe(302)
    expect(result.headers.get('Location')).toBe('https://example.invalid/complete')
    expect(result.headers.get('Cache-Control')).toContain('no-store')
  })

  it.each(['initialization', 'handler'])('returns an uncached error after async %s rejection', async stage => {
    const getAuth = stage === 'initialization'
      ? async () => { throw new Error('init failed') }
      : async () => auth
    mockHandlers.GET.mockRejectedValueOnce(new Error('handler failed'))
    const result = await createAuthRouteHandlers(getAuth, 'fixture').GET(new Request('https://example.invalid/session'))
    expect(result.status).toBe(500)
    expect(result.headers.get('Cache-Control')).toContain('no-store')
    expect(await result.json()).toEqual({ error: 'Auth initialization failed' })
  })
})
