import { MongoClient, Db } from 'mongodb'

// MongoDB 连接选项 - 针对 Vercel Serverless 优化
const options = {
  maxPoolSize: 10,       // Serverless 推荐值，防止连接过多
  minPoolSize: 1,
  maxIdleTimeMS: 60000,  // 60秒空闲超时
}

// 全局变量用于在开发模式下缓存连接
// 防止 HMR (Hot Module Replacement) 导致连接泄漏
declare global {

  var _mongoClientPromise: Promise<MongoClient> | undefined
}

let _prodClientPromise: Promise<MongoClient> | null = null

function connectClient(development: boolean): Promise<MongoClient> {
  const client = new MongoClient(requireEnv('MONGODB_URI'), options)
  const pending = client.connect().catch(async error => {
    // A transient initial failure must not poison every later server request.
    // Do not clear a newer connection installed by another HMR module.
    if (development) {
      if (global._mongoClientPromise === pending) global._mongoClientPromise = undefined
    } else if (_prodClientPromise === pending) {
      _prodClientPromise = null
    }
    try { await client.close() } catch { /* Preserve the original connection error. */ }
    throw error
  })
  return pending
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`请在环境变量中设置 ${name}`)
  }
  return value
}

/**
 * Lazy 获取 MongoDB 客户端连接
 *
 * 不在 top-level 立即连接，避免构建时因缺少环境变量而失败。
 * 首次调用时才检查环境变量并创建连接。
 */
export function getClientPromise(): Promise<MongoClient> {
  if (process.env.NODE_ENV === 'development') {
    if (!global._mongoClientPromise) {
      global._mongoClientPromise = connectClient(true)
    }
    return global._mongoClientPromise
  }

  // 生产模式: 使用模块级缓存
  if (!_prodClientPromise) {
    _prodClientPromise = connectClient(false)
  }
  return _prodClientPromise
}

/**
 * 获取数据库实例
 * 用于服务端组件和 API Routes
 */
export async function getDatabase(): Promise<Db> {
  const dbName = requireEnv('MONGODB_DB_NAME')
  const client = await getClientPromise()
  return client.db(dbName)
}
