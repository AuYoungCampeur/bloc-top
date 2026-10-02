import type { NextConfig } from "next";
import { execSync } from "child_process";
import withSerwistInit from "@serwist/next";
import createNextIntlPlugin from "next-intl/plugin";
import { IMAGE_CACHE } from "./src/lib/cache-config";

// next-intl 插件 - 指向 i18n 配置文件
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isDev = process.env.NODE_ENV !== "production";

// 获取 git revision 作为缓存版本号
function getGitRevision(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    // 如果无法获取 git revision，使用时间戳作为 fallback
    return Date.now().toString();
  }
}

const revision = getGitRevision();

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: isDev,
  // 预缓存离线页面，确保离线时可访问（所有支持的语言）
  additionalPrecacheEntries: [
    { url: "/zh/offline", revision },
    { url: "/en/offline", revision },
    { url: "/fr/offline", revision },
  ],
});

const nextConfig: NextConfig = {
  turbopack: {},
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.bouldering.top",
      },
    ],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: IMAGE_CACHE.MINIMUM_TTL,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "geolocation=(), microphone=(), camera=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://webapi.amap.com https://*.amap.com",
              "worker-src 'self' blob:",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: https: blob:",
              "font-src 'self' https://fonts.gstatic.com",
              "connect-src 'self' https://img.bouldering.top https://restapi.amap.com https://*.amap.com https://*.is.autonavi.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

// 开发环境：仅用 next-intl 包装（使用 Turbopack，无 webpack 配置）
// 生产环境：用 next-intl + Serwist 包装（启用 Service Worker，需要 webpack）
export default isDev
  ? withNextIntl(nextConfig)
  : withNextIntl(withSerwist(nextConfig));
