export type AuthApp = 'pwa' | 'editor'

interface AuthEnvironment {
  NODE_ENV?: string
  VERCEL_ENV?: string
  VERCEL_URL?: string
  NEXT_PUBLIC_APP_URL?: string
  NEXT_PUBLIC_PWA_URL?: string
  NEXT_PUBLIC_EDITOR_URL?: string
}

const PRODUCTION_ORIGINS = [
  'https://bouldering.top',
  'https://www.bouldering.top',
  'https://editor.bouldering.top',
]
const LOCAL_ORIGINS = ['http://localhost:3000', 'http://localhost:3001']

function configuredOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('认证应用 URL 必须是 http/https 地址且不能包含凭据')
  }
  return url.origin
}

/** Both applications must agree on origins and cookie scope to share sessions. */
export function getAuthRuntimeConfig(app: AuthApp, env: AuthEnvironment) {
  const preview = env.VERCEL_ENV === 'preview'
  const deployed = Boolean(env.VERCEL_ENV)
  const production = env.NODE_ENV === 'production' && !preview
  const pwaOrigin = configuredOrigin(env.NEXT_PUBLIC_PWA_URL)
  const editorOrigin = configuredOrigin(env.NEXT_PUBLIC_EDITOR_URL)
    ?? (app === 'editor' ? configuredOrigin(env.NEXT_PUBLIC_APP_URL) : undefined)
  const configured = [pwaOrigin, editorOrigin].filter((value): value is string => Boolean(value))
  // A local production build must remain usable through next start over HTTP.
  const localBuild = production && !deployed && configured.length > 0
    && configured.every(origin => new URL(origin).hostname === 'localhost')
  const local = !production && !preview || localBuild
  const previewOrigin = preview && env.VERCEL_URL
    ? configuredOrigin(`https://${env.VERCEL_URL}`)
    : undefined
  const origins = local ? LOCAL_ORIGINS : preview ? [] : PRODUCTION_ORIGINS
  const trustedOrigins = [...new Set([...origins, ...configured, ...(previewOrigin ? [previewOrigin] : [])])]
  if (!local && trustedOrigins.some(origin => new URL(origin).protocol !== 'https:')) {
    throw new Error('部署环境的认证应用 URL 必须使用 HTTPS')
  }
  const previewHost = previewOrigin ? new URL(previewOrigin).hostname : undefined
  return {
    trustedOrigins,
    passkey: {
      rpID: local ? 'localhost' : preview ? previewHost : 'bouldering.top',
      origin: trustedOrigins,
    },
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
      useSecureCookies: !local,
      crossSubDomainCookies: local || preview
        ? { enabled: false as const }
        : { enabled: true as const, domain: '.bouldering.top' },
    },
  }
}
