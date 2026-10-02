import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { getLocale } from 'next-intl/server'
import '@bloctop/ui/styles/globals.css'

// Plus Jakarta Sans - 现代几何感字体，比 Geist 更有特色
const jakartaSans = localFont({
  src: './fonts/PlusJakartaSans.ttf',
  variable: '--font-sans',
  weight: '400 800',
  display: 'swap',
})

// JetBrains Mono - 优秀的等宽字体
const jetbrainsMono = localFont({
  src: './fonts/JetBrainsMono.ttf',
  variable: '--font-mono',
  weight: '400 600',
  display: 'swap',
})

export const metadata: Metadata = {
  title: '寻岩记',
  description: '攀岩线路分享 - 野外抱石指南',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '寻岩记',
  },
}

export const viewport: Viewport = {
  themeColor: '#667eea',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

/**
 * 根布局
 *
 * 仅负责：
 * - HTML 结构和字体配置
 * - 动态设置 lang 属性
 * - 全局样式导入
 *
 * 注意：ThemeProvider 和 App Shell 移至 [locale]/layout.tsx
 * 这样可以支持国际化的静态渲染
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = await getLocale()

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${jakartaSans.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  )
}
