/**
 * 统一缓存配置
 *
 * 本文件集中管理项目中所有的缓存 TTL 配置
 * 修改缓存策略时只需要在这里调整即可
 *
 * 设计原则:
 * 1. 单一数据源 - 所有 TTL 值从这里导出
 * 2. 语义化命名 - 用常量名替代魔法数字
 * 3. 分层组织 - 按功能域分组
 */

// ==================== 时间常量 (基础单位) ====================

/** 秒级时间单位 - 用于 ISR、HTTP Cache-Control、SW 缓存等 */
export const SECONDS = {
  MINUTE: 60,
  HOUR: 60 * 60,
  DAY: 60 * 60 * 24,
  WEEK: 60 * 60 * 24 * 7,
  MONTH: 60 * 60 * 24 * 30,
  YEAR: 60 * 60 * 24 * 365,
} as const

/** 毫秒级时间单位 - 用于 API 内存缓存、setTimeout 等 */
export const MILLISECONDS = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 60 * 60 * 24 * 1000,
} as const

// ==================== ISR 缓存配置 ====================

/**
 * Next.js ISR (Incremental Static Regeneration) 重新验证时间
 * 单位: 秒
 *
 * ⚠️ 注意：Next.js 不支持在 `export const revalidate` 中使用变量引用
 * 构建时会报错 "Unsupported node type MemberExpression"
 * 页面中需要直接使用字面量值 (如 2592000)
 *
 * 此处仅作为配置值的文档记录和计算参考。
 * 修改此值时，需同步更新以下文件中的字面量：
 * - src/app/[locale]/page.tsx (HOME = 86400)
 * - src/app/[locale]/route/page.tsx (PAGE = 2592000)
 * - src/app/[locale]/crag/[id]/page.tsx (DETAIL = 2592000)
 */
export const ISR_REVALIDATE = {
  /** 首页 ISR 安全网 - 即使 revalidatePath 失败也会在 1 天内刷新 */
  HOME: SECONDS.DAY, // 86400 秒 = 1 天

  /** 列表页面 ISR - 线路列表等 */
  PAGE: SECONDS.MONTH, // 2592000 秒 = 30 天

  /** 详情页面 ISR - 岩场详情、线路详情等 */
  DETAIL: SECONDS.MONTH, // 2592000 秒 = 30 天
} as const

// ==================== Service Worker 缓存配置 ====================

/**
 * Service Worker 运行时缓存配置
 *
 * 使用场景: Serwist ExpirationPlugin
 */
export const SW_CACHE = {
  /** R2 图片缓存配置 */
  R2_IMAGES: {
    /** 最大缓存条目数 */
    maxEntries: 200,
    /** 缓存过期时间 (秒) - 有版本号可随时刷新，设置为 1 年 */
    maxAgeSeconds: SECONDS.YEAR, // 1 年 (31536000 秒)
  },
} as const

// ==================== Next.js Image 配置 ====================

/**
 * Next.js Image 组件优化缓存配置
 * 单位: 秒
 *
 * 使用场景: next.config.ts images.minimumCacheTTL
 */
export const IMAGE_CACHE = {
  /** 远程图片最小缓存时间 - 有版本号可随时刷新，设置为 1 年 */
  MINIMUM_TTL: SECONDS.YEAR, // 1 年 (31536000 秒)
} as const

// ==================== API 内存缓存配置 ====================

/**
 * API 路由内存缓存 TTL 配置
 * 单位: 毫秒
 *
 * 使用场景: Map-based 内存缓存 expireAt 计算
 */
export const API_CACHE = {
  /** 天气 API 内存缓存 TTL */
  WEATHER_TTL: MILLISECONDS.HOUR, // 1 小时
} as const

// ==================== HTTP 响应头配置 ====================

/**
 * HTTP Cache-Control 响应头配置
 * 单位: 秒
 *
 * 使用场景: NextResponse headers Cache-Control max-age
 */
export const HTTP_CACHE = {
  /** 天气 API 响应 max-age */
  WEATHER_MAX_AGE: SECONDS.HOUR, // 1 小时
} as const

// ==================== 离线缓存配置 ====================

/**
 * 离线功能缓存配置
 *
 * 使用场景: 岩场离线下载功能
 */
export const OFFLINE_CACHE = {
  /** 离线图片缓存名称 */
  CACHE_NAME: 'offline-crag-images',
  /** 最大缓存条目数 (估计每个岩场约 25 张图) */
  MAX_ENTRIES: 500,
  /** 缓存过期时间 (秒) - 离线内容长期有效 */
  MAX_AGE_SECONDS: SECONDS.YEAR,
} as const

// ==================== Service Worker 缓存策略配置 ====================

/**
 * HTML 页面缓存配置
 *
 * 使用场景: Service Worker NetworkFirst 策略
 * 策略: 优先网络请求，超时后回退缓存
 */
export const HTML_CACHE = {
  /** 缓存名称 */
  CACHE_NAME: 'html-pages',
  /** 最大缓存条目数 */
  MAX_ENTRIES: 50,
  /** 缓存过期时间 (秒) - 7 天 */
  MAX_AGE_SECONDS: SECONDS.WEEK,
  /** 网络超时时间 (秒) - 超时后回退缓存 */
  NETWORK_TIMEOUT: 5,
} as const

/**
 * API 数据缓存配置 (Service Worker 层)
 *
 * 使用场景: Service Worker NetworkFirst 策略
 * 注意: 与 API_CACHE 不同，这是 SW 运行时缓存配置
 */
export const SW_API_CACHE = {
  /** 缓存名称 */
  CACHE_NAME: 'api-data',
  /** 最大缓存条目数 */
  MAX_ENTRIES: 100,
  /** 缓存过期时间 (秒) - 1 天 */
  MAX_AGE_SECONDS: SECONDS.DAY,
  /** 网络超时时间 (秒) */
  NETWORK_TIMEOUT: 3,
} as const
