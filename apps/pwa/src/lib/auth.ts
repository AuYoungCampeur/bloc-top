import { betterAuth } from 'better-auth'
import { mongodbAdapter } from 'better-auth/adapters/mongodb'
import { magicLink, admin } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { Resend } from 'resend'
import { getDatabase, getClientPromise } from '@/lib/mongodb'
import { magicLinkEmailTemplate } from '@/lib/email-templates'
import { getAuthRuntimeConfig } from '@bloctop/shared/auth-runtime'

/**
 * Lazy singleton — auth 实例仅在首次请求时初始化，
 * 避免 top-level await 在 Vercel 构建期间触发 DB 连接或
 * 因缺少 BETTER_AUTH_SECRET 而崩溃。
 */
let _auth: ReturnType<typeof betterAuth> | null = null
let _promise: Promise<ReturnType<typeof betterAuth>> | null = null

export function getAuth(): Promise<ReturnType<typeof betterAuth>> {
  if (_auth) return Promise.resolve(_auth)
  if (!_promise) {
    _promise = (async () => {
      console.log('[Auth] Initializing better-auth...')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const client = await getClientPromise()
      const db = await getDatabase()
      const runtime = getAuthRuntimeConfig('pwa', process.env)
      console.log('[Auth] MongoDB connected, creating auth instance')

      const instance = betterAuth({
        database: mongodbAdapter(db, { client }),

        appName: '寻岩记 BlocTop',
        // 不设 baseURL — 让 better-auth 从请求 Host header 自动推断，
        // 避免 bouldering.top 与 www.bouldering.top 的 origin 校验失败
        trustedOrigins: runtime.trustedOrigins,

        // 邮箱+密码（内置核心功能，非插件）
        // 注册只走 Magic Link 确保邮箱真实性，密码通过 setPassword 后补
        emailAndPassword: {
          enabled: true,
          minPasswordLength: 4,
        },

        // 账号关联 — 同一邮箱的 Magic Link / Password / Passkey 共享用户记录
        account: {
          accountLinking: {
            enabled: true,
          },
        },

        user: {
          additionalFields: {
            name: {
              type: 'string',
              required: false,
            },
            height: {
              type: 'number',
              required: false,
            },
            reach: {
              type: 'number',
              required: false,
            },
          },
        },

        plugins: [
          admin({
            defaultRole: 'user',
            adminRoles: ['admin'],
          }),

          magicLink({
            expiresIn: 600, // 10 minutes
            sendMagicLink: async ({ email, url }) => {
              // 使用环境变量控制发件人，域名验证完成后在 Vercel 设置
              // RESEND_FROM_EMAIL=noreply@bouldering.top
              const from = process.env.RESEND_FROM_EMAIL
                ? `寻岩记 <${process.env.RESEND_FROM_EMAIL}>`
                : '寻岩记 <onboarding@resend.dev>'
              console.log('[Auth] Sending Magic Link to:', email, 'from:', from)
              const { error } = await resend.emails.send({
                from,
                to: email,
                subject: '登录寻岩记 BlocTop',
                html: magicLinkEmailTemplate(url),
              })
              if (error) {
                console.error('[Auth] Magic Link email failed:', JSON.stringify(error))
                throw new Error(error.message)
              }
              console.log('[Auth] Magic Link sent successfully to:', email)
            },
          }),

          passkey({
            ...runtime.passkey,
            rpName: '寻岩记 BlocTop',
          }),
        ],

        session: {
          expiresIn: 60 * 60 * 24 * 30, // 30 days
          updateAge: 60 * 60 * 24, // refresh daily
          cookieCache: {
            enabled: true,
            maxAge: 60 * 5, // 5 min cache to reduce DB queries
          },
        },

        rateLimit: {
          window: 60,
          max: 10,
        },

        advanced: runtime.advanced,
      })

      _auth = instance
      return instance
    })().catch(error => {
      _promise = null
      throw error
    })
  }
  return _promise
}
