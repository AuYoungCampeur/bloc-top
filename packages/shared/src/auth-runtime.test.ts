import { describe, expect, it } from 'vitest'
import { getCookies } from 'better-auth/cookies'
import { getAuthRuntimeConfig } from './auth-runtime'

describe('shared authentication runtime', () => {
  it('uses the same host-only cookie and trusted origins on both localhost ports', () => {
    const pwa = getAuthRuntimeConfig('pwa', { NODE_ENV: 'development' })
    const editor = getAuthRuntimeConfig('editor', { NODE_ENV: 'development' })
    expect(editor).toEqual(pwa)
    expect(pwa.trustedOrigins).toEqual(['http://localhost:3000', 'http://localhost:3001'])
    const cookie = getCookies(pwa).sessionToken
    expect(cookie.name).toBe('better-auth.session_token')
    expect(cookie.attributes.domain).toBeUndefined()
    expect(cookie.attributes.secure).toBe(false)
    expect(pwa.passkey.rpID).toBe('localhost')
    expect(pwa.session).toEqual({
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    })
  })

  it('preserves existing secure production cookies without trusting localhost', () => {
    const config = getAuthRuntimeConfig('pwa', { NODE_ENV: 'production', VERCEL_ENV: 'production' })
    const cookie = getCookies(config).sessionToken
    expect(cookie.name).toBe('__Secure-better-auth.session_token')
    expect(cookie.attributes.domain).toBe('.bouldering.top')
    expect(cookie.attributes.secure).toBe(true)
    expect(config.trustedOrigins).not.toContain('http://localhost:3000')
    expect(config.passkey.rpID).toBe('bouldering.top')
  })

  it('supports a local production build without production cookie attributes', () => {
    const env = {
      NODE_ENV: 'production',
      NEXT_PUBLIC_PWA_URL: 'http://localhost:3000',
      NEXT_PUBLIC_EDITOR_URL: 'http://localhost:3001',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3001',
    }
    const pwa = getAuthRuntimeConfig('pwa', env)
    const editor = getAuthRuntimeConfig('editor', env)
    expect(pwa).toEqual(editor)
    expect(getCookies(pwa).sessionToken.attributes.domain).toBeUndefined()
    expect(pwa.advanced.useSecureCookies).toBe(false)
  })

  it('isolates preview cookies to the deployment host', () => {
    const config = getAuthRuntimeConfig('pwa', {
      NODE_ENV: 'production', VERCEL_ENV: 'preview', VERCEL_URL: 'bloc-preview.vercel.app',
    })
    expect(config.trustedOrigins).toEqual(['https://bloc-preview.vercel.app'])
    expect(config.passkey.rpID).toBe('bloc-preview.vercel.app')
    expect(getCookies(config).sessionToken.attributes.domain).toBeUndefined()
    expect(config.advanced.useSecureCookies).toBe(true)
  })

  it('normalizes configured origins and rejects unsafe deployment URLs', () => {
    const config = getAuthRuntimeConfig('editor', {
      NODE_ENV: 'development', NEXT_PUBLIC_APP_URL: 'http://localhost:3101/path',
    })
    expect(config.trustedOrigins).toContain('http://localhost:3101')
    expect(() => getAuthRuntimeConfig('pwa', { NEXT_PUBLIC_EDITOR_URL: 'javascript:alert(1)' })).toThrow()
    expect(() => getAuthRuntimeConfig('pwa', {
      NODE_ENV: 'production', VERCEL_ENV: 'production', NEXT_PUBLIC_EDITOR_URL: 'http://localhost:3001',
    })).toThrow('HTTPS')
  })
})
