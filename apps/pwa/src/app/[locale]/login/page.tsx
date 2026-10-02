import { getAuthRuntimeConfig } from '@bloctop/shared/auth-runtime'
import { isTrustedCallbackURL } from '@/lib/trusted-url'
import LoginClient from './login-client'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackURL?: string | string[] }>
}) {
  const { callbackURL: rawCallback } = await searchParams
  const { trustedOrigins } = getAuthRuntimeConfig('pwa', process.env)
  const callbackURL = typeof rawCallback === 'string' && isTrustedCallbackURL(rawCallback, trustedOrigins)
    ? rawCallback
    : '/'
  return <LoginClient callbackURL={callbackURL} />
}
