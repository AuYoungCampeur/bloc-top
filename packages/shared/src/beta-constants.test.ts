import { describe, it, expect } from 'vitest'
import {
  extractUrlFromText,
  isXiaohongshuUrl,
  isXiaohongshuShortUrl,
  detectPlatformFromUrl,
  extractXiaohongshuNoteId,
  normalizeXiaohongshuNoteUrl,
} from './beta-constants'

describe('beta-constants', () => {
  describe('extractUrlFromText', () => {
    it('应该从小红书分享文本中提取 URL', () => {
      const shareText = '福州罗源野抱 - 圆通寺 云外苍天V5 前半段不翻顶在横... http://xhslink.com/o/6L6IwtxYi13 复制后打开【小红书】查看笔记！'
      expect(extractUrlFromText(shareText)).toBe('http://xhslink.com/o/6L6IwtxYi13')
    })

    it('应该处理纯 URL 输入', () => {
      const url = 'https://www.xiaohongshu.com/explore/6789abcdef123456'
      expect(extractUrlFromText(url)).toBe(url)
    })

    it('应该处理 https 短链接', () => {
      const url = 'https://xhslink.com/abc123'
      expect(extractUrlFromText(url)).toBe(url)
    })

    it('应该从小红书 .cn 分享文本及 Markdown 链接中提取短链', () => {
      const text = '福州罗源野抱 - 晨钟暮鼓 V6 身高臂展在能让线路难度... [https://xhslink.cn/o/AsU8BTN9oIl](https://xhslink.cn/o/AsU8BTN9oIl) Copy and open rednote to view the note'
      expect(extractUrlFromText(text)).toBe('https://xhslink.cn/o/AsU8BTN9oIl')
    })

    it('应该清理 URL 末尾的中文标点', () => {
      const text = '看这个视频 http://xhslink.com/test，很厉害'
      expect(extractUrlFromText(text)).toBe('http://xhslink.com/test')
    })

    it('应该返回 null 当没有 URL 时', () => {
      expect(extractUrlFromText('这是一段没有链接的文字')).toBeNull()
    })

    it('应该返回 null 当输入为空时', () => {
      expect(extractUrlFromText('')).toBeNull()
      expect(extractUrlFromText(null as unknown as string)).toBeNull()
      expect(extractUrlFromText(undefined as unknown as string)).toBeNull()
    })

    it('应该优先返回小红书链接', () => {
      const text = 'http://example.com/other https://xhslink.com/target'
      expect(extractUrlFromText(text)).toBe('https://xhslink.com/target')
    })
  })

  describe('isXiaohongshuUrl', () => {
    it('应该识别 xiaohongshu.com 域名', () => {
      expect(isXiaohongshuUrl('https://www.xiaohongshu.com/explore/123')).toBe(true)
      expect(isXiaohongshuUrl('https://xiaohongshu.com/explore/123')).toBe(true)
    })

    it('应该识别 xhslink.com 短链接域名', () => {
      expect(isXiaohongshuUrl('http://xhslink.com/abc')).toBe(true)
      expect(isXiaohongshuUrl('https://xhslink.com/abc')).toBe(true)
    })

    it('应该识别 xhslink.cn 短链接域名', () => {
      expect(isXiaohongshuUrl('https://xhslink.cn/o/AsU8BTN9oIl')).toBe(true)
      expect(isXiaohongshuShortUrl('https://xhslink.cn/o/AsU8BTN9oIl')).toBe(true)
      expect(isXiaohongshuShortUrl('https://xhslink.com/abc')).toBe(true)
      expect(isXiaohongshuShortUrl('https://www.xiaohongshu.com/explore/123')).toBe(false)
    })

    it('应该对其他域名返回 false', () => {
      expect(isXiaohongshuUrl('https://www.douyin.com/video/123')).toBe(false)
      expect(isXiaohongshuUrl('https://www.bilibili.com/video/123')).toBe(false)
      expect(isXiaohongshuUrl('https://xhslink.cn.evil.example/o/abc')).toBe(false)
      expect(isXiaohongshuUrl('https://evil.example/?url=xiaohongshu.com')).toBe(false)
      expect(isXiaohongshuUrl('javascript:xhslink.cn')).toBe(false)
      expect(isXiaohongshuShortUrl('https://xhslink.com.evil.example/o/abc')).toBe(false)
    })

    it('应该不区分大小写', () => {
      expect(isXiaohongshuUrl('https://XIAOHONGSHU.COM/explore/123')).toBe(true)
      expect(isXiaohongshuUrl('https://XHSLINK.COM/abc')).toBe(true)
    })
  })

  describe('detectPlatformFromUrl', () => {
    it('应该检测小红书平台', () => {
      expect(detectPlatformFromUrl('https://www.xiaohongshu.com/explore/123')).toBe('xiaohongshu')
      expect(detectPlatformFromUrl('http://xhslink.com/abc')).toBe('xiaohongshu')
    })

    it('应该对非小红书链接返回 null', () => {
      expect(detectPlatformFromUrl('https://www.douyin.com/video/123')).toBeNull()
    })
  })

  describe('extractXiaohongshuNoteId', () => {
    it('应该从 /explore/ 路径提取笔记 ID', () => {
      const url = 'https://www.xiaohongshu.com/explore/6789abcdef1234567890abcd'
      expect(extractXiaohongshuNoteId(url)).toBe('6789abcdef1234567890abcd')
    })

    it('应该从 /discovery/item/ 路径提取笔记 ID', () => {
      const url = 'https://www.xiaohongshu.com/discovery/item/6789abcdef1234567890abcd'
      expect(extractXiaohongshuNoteId(url)).toBe('6789abcdef1234567890abcd')
    })

    it('应该处理带查询参数的 URL', () => {
      const url = 'https://www.xiaohongshu.com/explore/6789abcdef1234567890abcd?xsec_token=xxx'
      expect(extractXiaohongshuNoteId(url)).toBe('6789abcdef1234567890abcd')
    })

    it('应该将 ID 转为小写', () => {
      const url = 'https://www.xiaohongshu.com/explore/ABCDEF1234567890ABCDEF12'
      expect(extractXiaohongshuNoteId(url)).toBe('abcdef1234567890abcdef12')
    })

    it('应该对短链接返回 null', () => {
      expect(extractXiaohongshuNoteId('http://xhslink.com/abc')).toBeNull()
    })

    it('应该对无效 URL 返回 null', () => {
      expect(extractXiaohongshuNoteId('not a url')).toBeNull()
    })

    it('应该对非小红书域名返回 null', () => {
      expect(extractXiaohongshuNoteId('https://example.com/explore/6789abcdef1234567890abcd')).toBeNull()
      expect(extractXiaohongshuNoteId('https://xiaohongshu.com.evil.example/explore/6789abcdef1234567890abcd')).toBeNull()
    })
  })

  describe('normalizeXiaohongshuNoteUrl', () => {
    it('应该从小红书登录跳转地址还原笔记链接', () => {
      const target = 'http://www.xiaohongshu.com/discovery/item/6797869e0000000029017615?type=video&xsec_token=abc'
      const loginUrl = `https://www.xiaohongshu.com/login?redirectPath=${encodeURIComponent(target)}`
      expect(normalizeXiaohongshuNoteUrl(loginUrl)).toBe('https://www.xiaohongshu.com/discovery/item/6797869e0000000029017615?type=video&xsec_token=abc')
    })

    it('不还原其他域名或非笔记跳转', () => {
      const loginUrl = `https://www.xiaohongshu.com/login?redirectPath=${encodeURIComponent('https://xiaohongshu.com.evil.example/explore/6797869e0000000029017615')}`
      expect(normalizeXiaohongshuNoteUrl(loginUrl)).toBe(loginUrl)
    })
  })
})
