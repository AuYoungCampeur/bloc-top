import { betterAuth } from 'better-auth'
import { mongodbAdapter } from 'better-auth/adapters/mongodb'
import { admin } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { getDatabase, getClientPromise } from '@bloctop/shared/mongodb'
import { getAuthRuntimeConfig } from '@bloctop/shared/auth-runtime'

/**
 * Editor 独立的 better-auth 实例
 *
 * 与 PWA 共享同一个 MongoDB 数据库（user/session 集合），
 * 但不包含 Magic Link 插件（登录在 PWA 完成）。
 * Editor 只需要：验证 session + 检查 admin 角色 + 支持 Passkey
 */
let _auth: ReturnType<typeof betterAuth> | null = null
let _promise: Promise<ReturnType<typeof betterAuth>> | null = null

export function getAuth(): Promise<ReturnType<typeof betterAuth>> {
  if (_auth) return Promise.resolve(_auth)
  if (!_promise) {
    _promise = (async () => {
      const client = await getClientPromise()
      const db = await getDatabase()
      const runtime = getAuthRuntimeConfig('editor', process.env)

      const instance = betterAuth({
        database: mongodbAdapter(db, { client }),

        appName: '寻岩记 BlocTop Editor',
        trustedOrigins: runtime.trustedOrigins,

        emailAndPassword: { enabled: true, minPasswordLength: 4 },

        account: {
          accountLinking: { enabled: true },
        },

        user: {
          additionalFields: {
            name: { type: 'string', required: false },
            height: { type: 'number', required: false },
            reach: { type: 'number', required: false },
          },
        },

        plugins: [
          admin({ defaultRole: 'user', adminRoles: ['admin'] }),
          passkey({
            ...runtime.passkey,
            rpName: '寻岩记 BlocTop',
          }),
        ],

        session: runtime.session,

        rateLimit: { window: 60, max: 10 },

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
