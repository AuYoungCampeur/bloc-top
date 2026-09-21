import type { BetaPlatform } from './types'

/**
 * Beta 视频平台配置（目前仅支持小红书）
 */
export const BETA_PLATFORMS: Record<
  BetaPlatform,
  {
    name: string
    color: string
    iconName: string
  }
> = {
  xiaohongshu: {
    name: '小红书',
    color: '#FF2442',
    iconName: 'BookHeart',
  },
}

/**
 * 从文本中提取小红书链接
 *
 * 用户从小红书复制分享时，会带有额外的文字描述，例如：
 * "福州罗源野抱 - 圆通寺 云外苍天V5 前半段不翻顶在横... http://xhslink.com/o/6L6IwtxYi13
 *  复制后打开【小红书】查看笔记！"
 *
 * 此函数从这种混合文本中提取出真正的 URL
 *
 * @param text 用户粘贴的文本（可能是纯 URL，也可能是带描述的文本）
 * @returns 提取出的 URL，如果没有找到则返回 null
 */
export function extractUrlFromText(text: string): string | null {
  if (!text || typeof text !== 'string') {
    return null
  }

  // 正则匹配 URL（支持 http 和 https）
  // 匹配模式：http(s):// 开头，直到遇到空白字符或中文字符
  // 停在 Markdown 链接的方括号/圆括号前，避免把 ](url) 拼进 URL
  const urlPattern = /https?:\/\/[^\s\u4e00-\u9fa5<>\[\]()]+/gi
  const matches = text.match(urlPattern)

  if (!matches || matches.length === 0) {
    return null
  }

  // 优先返回小红书相关的链接
  for (const url of matches) {
    if (isXiaohongshuUrl(url)) {
      // 清理 URL 末尾可能的标点符号
      return url.replace(/[,，。！!?？]+$/, '')
    }
  }

  // 如果没有小红书链接，返回第一个 URL
  return matches[0].replace(/[,，。！!?？]+$/, '')
}

const XIAOHONGSHU_SHORT_DOMAINS = ['xhslink.com', 'xhslink.cn']

function isDomainOrSubdomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

function getHttpUrl(url: string): URL | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null
  } catch {
    return null
  }
}

/** 验证 URL 是否为小红书短链接（支持 .com 和 .cn） */
export function isXiaohongshuShortUrl(url: string): boolean {
  const parsed = getHttpUrl(url)
  return parsed !== null && XIAOHONGSHU_SHORT_DOMAINS.some(domain =>
    isDomainOrSubdomain(parsed.hostname, domain)
  )
}

/** 验证 URL 是否为小红书笔记或短链接 */
export function isXiaohongshuUrl(url: string): boolean {
  const parsed = getHttpUrl(url)
  return parsed !== null && (
    isDomainOrSubdomain(parsed.hostname, 'xiaohongshu.com') ||
    isXiaohongshuShortUrl(url)
  )
}

/**
 * 根据 URL 检测平台（目前仅支持小红书）
 * @returns 如果是小红书链接返回 'xiaohongshu'，否则返回 null
 */
export function detectPlatformFromUrl(url: string): BetaPlatform | null {
  if (isXiaohongshuUrl(url)) {
    return 'xiaohongshu'
  }
  return null
}

/**
 * 从小红书 URL 中提取笔记 ID
 *
 * 支持的 URL 格式：
 * - https://www.xiaohongshu.com/explore/6789abcdef123456
 * - https://www.xiaohongshu.com/discovery/item/6789abcdef123456
 * - https://xiaohongshu.com/explore/6789abcdef123456?xsec_token=xxx
 *
 * @param url 小红书链接（完整链接，非短链接）
 * @returns 笔记 ID 或 null（如果无法提取）
 */
export function extractXiaohongshuNoteId(url: string): string | null {
  try {
    const urlObj = new URL(url)

    // 只处理 xiaohongshu.com 域名
    if (!getHttpUrl(url) || !isDomainOrSubdomain(urlObj.hostname, 'xiaohongshu.com')) {
      return null
    }

    // 匹配路径中的笔记 ID
    // 格式: /explore/ID 或 /discovery/item/ID
    const patterns = [
      /\/explore\/([a-f0-9]{24})/i,
      /\/discovery\/item\/([a-f0-9]{24})/i,
    ]

    for (const pattern of patterns) {
      const match = urlObj.pathname.match(pattern)
      if (match && match[1]) {
        return match[1].toLowerCase()
      }
    }

    return null
  } catch {
    return null
  }
}

/**
 * 短链接偶尔会落到登录页；只在 redirectPath 指向小红书笔记时还原目标 URL。
 * 还原的是分享链接，不代表无需登录即可在小红书查看内容。
 */
export function normalizeXiaohongshuNoteUrl(url: string): string {
  const parsed = getHttpUrl(url)
  if (!parsed || !isDomainOrSubdomain(parsed.hostname, 'xiaohongshu.com') || parsed.pathname !== '/login') {
    return url
  }

  const redirectPath = parsed.searchParams.get('redirectPath')
  if (!redirectPath || !extractXiaohongshuNoteId(redirectPath)) {
    return url
  }

  const noteUrl = new URL(redirectPath)
  noteUrl.protocol = 'https:'
  return noteUrl.toString()
}
