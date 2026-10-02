import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig, RuntimeCaching } from "serwist";
import { Serwist, CacheFirst, NetworkFirst, NetworkOnly, ExpirationPlugin, Strategy, type StrategyHandler } from "serwist";
import { SW_CACHE, OFFLINE_CACHE, HTML_CACHE, SW_API_CACHE } from "@/lib/cache-config";
import { cleanupLegacyApiCaches, getApiCachePolicy, isCacheablePublicApiResponse } from "@/lib/sw-cache-policy";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * 自定义图片缓存策略
 *
 * 优先级:
 * 1. 先检查离线下载缓存 (offline-crag-images)
 * 2. 再使用 CacheFirst 策略 (r2-images)
 *
 * 这样确保离线下载的图片在断网时可用
 */
class OfflineFirstImageStrategy extends Strategy {
  private cacheFirst: CacheFirst;

  constructor() {
    super({
      cacheName: "r2-images",
    });
    this.cacheFirst = new CacheFirst({
      cacheName: "r2-images",
      plugins: [
        new ExpirationPlugin({
          maxEntries: SW_CACHE.R2_IMAGES.maxEntries,
          maxAgeSeconds: SW_CACHE.R2_IMAGES.maxAgeSeconds,
          purgeOnQuotaError: true,
        }),
      ],
    });
  }

  async _handle(request: Request, handler: StrategyHandler): Promise<Response> {
    // 1. 先检查离线下载缓存
    const offlineCache = await caches.open(OFFLINE_CACHE.CACHE_NAME);
    const offlineResponse = await offlineCache.match(request);

    if (offlineResponse && (offlineResponse.type !== "opaque" || request.mode === "no-cors")) {
      return offlineResponse;
    }

    // 2. 回退到 CacheFirst 策略
    return this.cacheFirst.handle({ request, event: handler.event });
  }
}

// The downloader owns verification and publication. Never persist unverified revision media in runtime caches.
const offlineMediaDownload: RuntimeCaching = {
  matcher: ({ url }) => url.hostname === "img.bouldering.top" && url.searchParams.has("offlineRevision"),
  handler: new NetworkOnly({ fetchOptions: { cache: "no-store" } }),
};

// R2 图片缓存策略 - 先检查离线缓存，再使用 CacheFirst
const r2ImageCache: RuntimeCaching = {
  matcher: ({ url }) => url.hostname === "img.bouldering.top",
  handler: new OfflineFirstImageStrategy(),
};

/**
 * Next.js Image 优化请求处理策略
 *
 * Next.js <Image> 组件通过 /_next/image?url=xxx 路由请求图片
 * 我们需要从 URL 参数中提取原始图片 URL，然后检查离线缓存
 *
 * 优先级:
 * 1. 从 url 参数提取原始图片 URL
 * 2. 检查离线下载缓存 (offline-crag-images)
 * 3. 如果找到，返回缓存的图片
 * 4. 否则正常走网络请求
 */
class NextImageOfflineStrategy extends Strategy {
  constructor() {
    super({
      cacheName: "next-image",
    });
  }

  async _handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const originalUrl = url.searchParams.get("url");

    // 只处理 img.bouldering.top 的图片
    if (originalUrl && originalUrl.includes("img.bouldering.top")) {
      // 检查离线缓存
      const offlineCache = await caches.open(OFFLINE_CACHE.CACHE_NAME);
      const offlineResponse = await offlineCache.match(originalUrl);

      if (offlineResponse?.ok && offlineResponse.type !== "opaque") {
        // 离线缓存命中，直接返回原始图片
        // 注意：这绕过了 Next.js 的图片优化，但在离线时这是可接受的
        return offlineResponse;
      }
    }

    // 没有离线缓存，正常请求网络
    return fetch(request);
  }
}

// Next.js Image 优化请求 - 检查离线缓存
const nextImageCache: RuntimeCaching = {
  matcher: ({ url }) =>
    url.pathname === "/_next/image" &&
    url.searchParams.get("url")?.includes("img.bouldering.top"),
  handler: new NextImageOfflineStrategy(),
};

// HTML 页面缓存策略 - NetworkFirst (优先网络，超时后回退缓存)
const htmlCache: RuntimeCaching = {
  matcher: ({ request }) => request.destination === "document",
  handler: new NetworkFirst({
    cacheName: HTML_CACHE.CACHE_NAME,
    networkTimeoutSeconds: HTML_CACHE.NETWORK_TIMEOUT,
    plugins: [
      new ExpirationPlugin({
        maxEntries: HTML_CACHE.MAX_ENTRIES,
        maxAgeSeconds: HTML_CACHE.MAX_AGE_SECONDS,
        purgeOnQuotaError: true,
      }),
    ],
  }),
};

// 只有明确公开的 GET 接口允许离线回退。
const apiCache: RuntimeCaching = {
  matcher: (context) => getApiCachePolicy(context) === "public",
  handler: new NetworkFirst({
    cacheName: SW_API_CACHE.CACHE_NAME,
    networkTimeoutSeconds: SW_API_CACHE.NETWORK_TIMEOUT,
    plugins: [
      {
        cacheWillUpdate: async ({ response }) => isCacheablePublicApiResponse(response) ? response : null,
      },
      new ExpirationPlugin({
        maxEntries: SW_API_CACHE.MAX_ENTRIES,
        maxAgeSeconds: SW_API_CACHE.MAX_AGE_SECONDS,
        purgeOnQuotaError: true,
      }),
    ],
  }),
};

// 排在 HTML 和 defaultCache 前，防止私有 API、Beta 或新增 API 落入宽泛规则。
const networkOnlyApi: RuntimeCaching = {
  matcher: ({ url }) => url.pathname === "/api" || url.pathname.startsWith("/api/"),
  handler: new NetworkOnly({ fetchOptions: { cache: "no-store" } }),
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // 顺序重要：
  // 1. API allowlist 和 NetworkOnly 拦截先于其他规则
  // 2. htmlCache 处理页面
  // 3. r2ImageCache/nextImageCache 处理图片
  // 4. defaultCache 处理其他资源
  runtimeCaching: [apiCache, networkOnlyApi, htmlCache, offlineMediaDownload, r2ImageCache, nextImageCache, ...defaultCache],
  // 离线 fallback 配置 - 当导航失败时显示对应语言的离线页面
  fallbacks: {
    entries: [
      {
        url: "/zh/offline",
        matcher({ request }) {
          const url = new URL(request.url);
          return request.destination === "document" && url.pathname.startsWith("/zh");
        },
      },
      {
        url: "/en/offline",
        matcher({ request }) {
          const url = new URL(request.url);
          return request.destination === "document" && url.pathname.startsWith("/en");
        },
      },
      {
        url: "/fr/offline",
        matcher({ request }) {
          const url = new URL(request.url);
          return request.destination === "document" && url.pathname.startsWith("/fr");
        },
      },
      {
        // 默认 fallback (无语言前缀的请求)
        url: "/zh/offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

self.addEventListener("activate", (event) => {
  event.waitUntil(cleanupLegacyApiCaches(caches, SW_API_CACHE.CACHE_NAME, self.location.origin));
});

serwist.addEventListeners();
