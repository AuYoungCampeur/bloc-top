import { describe, it, expect } from 'vitest'
import { getAuthRuntimeConfig } from '@bloctop/shared/auth-runtime'
import { isTrustedCallbackURL } from './trusted-url'

const production = getAuthRuntimeConfig('pwa', { NODE_ENV: 'production', VERCEL_ENV: 'production' }).trustedOrigins
const local = getAuthRuntimeConfig('pwa', { NODE_ENV: 'development' }).trustedOrigins

describe('isTrustedCallbackURL', () => {
  it.each(['/', '/profile', '/auth/security-setup'])('accepts same-site relative path %s', url => {
    expect(isTrustedCallbackURL(url, production)).toBe(true)
  })

  it.each([
    'https://bouldering.top/', 'https://www.bouldering.top/zh/profile', 'https://editor.bouldering.top/crags',
  ])('accepts the configured production origin %s', url => {
    expect(isTrustedCallbackURL(url, production)).toBe(true)
  })

  it('agrees with the auth runtime on development and production localhost callbacks', () => {
    for (const url of ['http://localhost:3000/', 'http://localhost:3001/crags']) {
      expect(isTrustedCallbackURL(url, local)).toBe(true)
      expect(isTrustedCallbackURL(url, production)).toBe(false)
    }
    expect(isTrustedCallbackURL('http://localhost:9999/', local)).toBe(false)
  })

  it('agrees with preview and local production-build auth origins', () => {
    const preview = getAuthRuntimeConfig('pwa', {
      NODE_ENV: 'production', VERCEL_ENV: 'preview', VERCEL_URL: 'pwa-preview.vercel.app',
      NEXT_PUBLIC_EDITOR_URL: 'https://editor-preview.vercel.app',
    }).trustedOrigins
    expect(isTrustedCallbackURL('https://pwa-preview.vercel.app/profile', preview)).toBe(true)
    expect(isTrustedCallbackURL('https://editor-preview.vercel.app/crags', preview)).toBe(true)
    expect(isTrustedCallbackURL('https://bouldering.top/profile', preview)).toBe(false)
    const build = getAuthRuntimeConfig('pwa', {
      NODE_ENV: 'production', NEXT_PUBLIC_EDITOR_URL: 'http://localhost:3001',
    }).trustedOrigins
    expect(isTrustedCallbackURL('http://localhost:3001/crags', build)).toBe(true)
  })

  it.each([
    'https://evil.com', 'https://bouldering.top.evil.com', 'https://notbouldering.top',
    '//evil.com', '/\\evil.com', '/\n/evil.com', 'javascript:alert(1)', 'not-a-url',
    'https://user:password@bouldering.top', 'https://unconfigured.bouldering.top', 'http://bouldering.top',
    '',
  ])('rejects unsafe or unconfigured callback %s', url => {
    expect(isTrustedCallbackURL(url, production)).toBe(false)
  })

  it('returns false for nullish input', () => {
    expect(isTrustedCallbackURL(null as unknown as string, production)).toBe(false)
    expect(isTrustedCallbackURL(undefined as unknown as string, production)).toBe(false)
  })
})
