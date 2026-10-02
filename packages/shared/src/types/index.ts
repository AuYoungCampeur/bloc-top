// ==================== 城市/地级市配置类型 ====================

/**
 * 城市 ID 类型（迁移到 MongoDB 后改为 string，不再自动推导）
 */
export type CityId = string

/**
 * 城市配置接口
 */
export interface CityConfig {
  id: string
  name: string              // 显示名称
  shortName: string         // 简称（用于 UI 空间紧张时）
  adcode: string            // 高德 adcode（用于天气 API）
  coordinates: Coordinates  // 中心坐标（用于地图、IP 定位匹配）
  available: boolean        // 是否有数据可用
  prefectureId?: string     // 所属地级市 ID
  sortOrder?: number        // 显示排序
}

/**
 * 地级市配置接口
 */
export interface PrefectureConfig {
  id: string
  name: string
  shortName: string
  /** 该地级市下的区/县 CityId 列表（有序） */
  districts: string[]
  /** IP 定位命中市级 adcode 时默认选中的区 */
  defaultDistrict: string
  sortOrder?: number        // 显示排序
}

/**
 * 城市选择状态（支持地级市聚合浏览）
 * - type: 'city' → 选中单个区/县
 * - type: 'prefecture' → 选中整个地级市（聚合其下所有区/县）
 */
export type CitySelection =
  | { type: 'city'; id: string }
  | { type: 'prefecture'; id: string }

// ==================== Topo 编辑器类型 ====================

/**
 * Topo 线路上的点 (归一化坐标 0-1)
 */
export interface TopoPoint {
  x: number  // 0-1 归一化 X 坐标
  y: number  // 0-1 归一化 Y 坐标
}

// 单张图的 topo 标注数据（多图标注功能用）
export interface RouteTopoAnnotation {
  faceId: string
  area: string
  topoLine: TopoPoint[]     // 有效值：至少 2 个点
  topoTension?: number      // Catmull-Rom 张力 0-1
}

// ==================== 核心数据类型 ====================

// 线路数据类型
export interface Route {
  id: number
  name: string
  grade: string // V0-V13 或 "？"
  cragId: string
  area: string
  faceId?: string // 岩面 ID，同一 faceId 的线路共享图片
  faceArea?: string // 兼容单图区域；新数组的第一条标注区域优先
  setter?: string
  FA?: string
  description?: string
  image?: string
  betaLinks?: BetaLink[] // Beta 视频链接
  topoLine?: TopoPoint[] // Topo 线路标注 (归一化坐标)
  topoTension?: number   // Catmull-Rom 曲线张力 0-1 (0=平滑, 1=折线, 默认 0)
  topoAnnotations?: RouteTopoAnnotation[] // 多图标注列表（新字段，空=未设置）
}

// 岩场坐标类型
export interface Coordinates {
  lng: number  // 经度
  lat: number  // 纬度
}

// 接近路径点类型 (用于 KML 导入后的路径绘制)
export interface ApproachPath {
  id: string
  name: string
  points: Coordinates[]  // 路径点数组
  color?: string         // 路径颜色
  description?: string   // 路径描述
}

// 岩场致谢人员
export interface CragCredit {
  name: string              // 人名
  contribution: string      // 贡献描述
}

// 岩场数据类型
export interface Crag {
  mediaRevision?: string // 图片/引用更新版本；旧数据可缺省
  id: string
  name: string
  cityId: string              // 所属城市 ID (如 'luoyuan', 'xiamen')
  location: string
  developmentTime?: string
  description: string
  approach: string
  coverImages?: string[]
  coordinates?: Coordinates     // 岩场坐标 (用于地图标记)
  approachPaths?: ApproachPath[] // 接近路径 (用于 KML 导入)
  areas?: string[]               // 持久化的区域列表
  credits?: CragCredit[]         // 致谢人员列表
  createdBy?: string             // 创建者 userId (RBAC)
  createdAt?: Date               // 创建时间
  updatedAt?: Date               // 更新时间
}

// 评论数据类型
export interface Comment {
  id: string
  routeId: number
  content: string
  author: string
  avatar?: string
  createdAt: Date
}

// Beta 视频类型
export interface BetaVideo {
  id: string
  routeId: number
  url: string
  author: string
  createdAt: Date
}

// 用户类型
export interface User {
  id: string
  nickName: string
  avatarUrl?: string
}

// ==================== RBAC 权限类型 ====================

/**
 * 用户角色 (better-auth Admin 插件管理)
 * - admin: 全局管理员，可管理所有岩场和用户
 * - user: 普通用户
 */
export type UserRole = 'admin' | 'user'

/**
 * 岩场级权限角色
 * - manager: 岩场管理者，可编辑线路/岩面/Beta (由 admin 分配)
 */
export type CragPermissionRole = 'manager'

/**
 * 岩场权限记录
 * 存储在 MongoDB `crag_permissions` collection
 */
export interface CragPermission {
  userId: string           // better-auth user._id (ObjectId as string)
  cragId: string           // Crag.id (e.g. 'yuan-tong-si')
  role: CragPermissionRole
  assignedBy: string       // 分配者的 userId
  createdAt: Date
}

// 难度等级范围
export const GRADE_LEVELS = [
  'V0', 'V1', 'V2', 'V3', 'V4', 'V5',
  'V6', 'V7', 'V8', 'V9', 'V10', 'V11',
  'V12', 'V13'
] as const

export type GradeLevel = typeof GRADE_LEVELS[number]

// Beta 视频平台类型（目前仅支持小红书）
export type BetaPlatform = 'xiaohongshu'

// Beta 链接数据类型
export interface BetaLink {
  id: string
  platform: BetaPlatform
  noteId: string           // 小红书笔记 ID（用于去重）
  url: string              // 解析后的最终 URL
  originalUrl?: string     // 原始短链接（如果经过解析）
  title?: string
  author?: string
  // 提交者身体数据（可选）
  climberHeight?: number  // 身高 (cm)
  climberReach?: number   // 臂长 (cm)
  createdAt?: Date
}

// ==================== 天气相关类型 ====================

/**
 * 攀岩适宜度等级
 * - excellent: 极佳 (绿色)
 * - good: 良好 (蓝色)
 * - fair: 一般 (黄色)
 * - poor: 不宜 (红色)
 */
export type ClimbingSuitability = 'excellent' | 'good' | 'fair' | 'poor'

/**
 * 天气实况数据 (当前天气)
 */
export interface WeatherLive {
  weather: string           // 天气现象 (晴、多云、阴、雨等)
  temperature: number       // 温度 (摄氏度)
  humidity: number          // 湿度 (百分比)
  windDirection: string     // 风向
  windPower: string         // 风力等级
  reportTime: string        // 数据发布时间
}

/**
 * 天气预报数据 (单日)
 */
export interface WeatherForecast {
  date: string              // 日期 (YYYY-MM-DD)
  week: string              // 星期
  dayWeather: string        // 白天天气
  nightWeather: string      // 夜间天气
  dayTemp: number           // 白天温度
  nightTemp: number         // 夜间温度
  dayWind: string           // 白天风向
  nightWind: string         // 夜间风向
  dayPower: string          // 白天风力
  nightPower: string        // 夜间风力
  climbing?: ClimbingCondition // 预报天攀岩适宜度
}

/**
 * 攀岩适宜度评估结果
 */
export interface ClimbingCondition {
  level: ClimbingSuitability  // 适宜度等级
  label: string               // 显示标签 (适合攀岩、谨慎出行等)
  description: string         // 详细描述
  factors: string[]           // 影响因素列表
}

/**
 * 完整天气响应数据
 */
export interface WeatherData {
  adcode: string              // 城市编码
  city: string                // 城市名称
  live: WeatherLive           // 实况天气
  forecasts?: WeatherForecast[] // 未来天气预报 (可选)
  climbing: ClimbingCondition // 攀岩适宜度评估
  updatedAt: string           // 数据更新时间 (ISO 8601)
}

// ==================== 用户反馈类型 ====================

/**
 * 用户反馈/留言数据 (极简设计)
 */
export interface Feedback {
  id: string                  // 唯一标识 (MongoDB ObjectId)
  content: string             // 留言内容
  createdAt: Date             // 创建时间
}

// ==================== 访问统计类型 ====================

/**
 * 访问统计数据
 * 按省份记录 App 打开次数（不去重，每次打开都计数）
 * 海外用户统一记录到「海外」
 */
export interface VisitStats {
  provinces: Record<string, number>  // 省份 -> 访问次数（包含「海外」）
  total: number                      // App 打开总次数
  lastUpdated: Date                  // 最后更新时间
}

// ==================== 离线下载类型 ====================

/**
 * 下载进度状态
 */
export type DownloadStatus = 'idle' | 'downloading' | 'completed' | 'failed' | 'stale'

/**
 * 下载进度信息
 */
export interface DownloadProgress {
  cragId: string
  status: DownloadStatus
  totalImages: number
  downloadedImages: number
  error?: string
}

/**
 * 已下载岩场的元数据 (用于列表展示)
 */
export interface OfflineCragMeta {
  cragId: string
  cragName: string
  routeCount: number
  downloadedAt: string
  imageCount: number
}

/**
 * Topo 线路数据 (用于编辑器)
 */
export interface TopoRoute {
  id: string
  name: string
  grade: string
  color: string
  line: TopoPoint[]
}

/**
 * 完整的 Topo 数据 (图片 + 线路)
 */
export interface TopoData {
  imageUrl: string       // base64 或 URL
  routes: TopoRoute[]
}
