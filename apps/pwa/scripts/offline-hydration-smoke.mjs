/** Direct Next HTML regression: no proxy/SW, isolated browser storage, loopback only. */
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const application = new URL(process.env.OFFLINE_SMOKE_URL ?? 'http://127.0.0.1:4100')
assert(['localhost', '127.0.0.1'].includes(application.hostname) && application.protocol === 'http:' && !application.username && !application.password, 'Only a local HTTP application is permitted')
const rounds = Number(process.env.OFFLINE_HYDRATION_ROUNDS ?? 60)
assert(Number.isInteger(rounds) && rounds >= 1 && rounds <= 200, 'Hydration rounds must be between 1 and 200')
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const errors = [], unexpected = [], prefetches = []
let round = 0

// Exercise a supported feature-absence path. Playwright serviceWorkers:'block' instead
// causes this Serwist version's register() to dereference an undefined registration.
await context.addInitScript(() => { delete Navigator.prototype.serviceWorker })
context.on('page', page => page.on('pageerror', error => errors.push({ round, url: page.url(), error: error.message, stack: error.stack })))
if (process.env.OFFLINE_SMOKE_DIAGNOSE === '1') {
  const { diagnoseHydration } = await import('./offline-hydration-diagnostics.mjs')
  await diagnoseHydration(context, data => console.error('Hydration diagnostic', JSON.stringify({ round, ...data })))
}
await context.route('**/*', route => {
  const request = route.request(), url = new URL(request.url())
  if (url.origin !== application.origin || request.method() !== 'GET') { unexpected.push(`${request.method()} ${url.href}`); return route.abort() }
  if (url.pathname === '/api/cities') return route.fulfill({ json: { success: true, cities: [], prefectures: [] } })
  if (url.pathname === '/api/geo') return route.fulfill({ json: {} }) // The existing detector selects en.
  if (/^\/(zh|en|fr)(?:\/(route|profile))?$/.test(url.pathname) && request.headers().rsc === '1') {
    prefetches.push(url.pathname)
    return route.fulfill({ status: 503, json: { error: 'SSR prefetch is outside this isolated offline regression' } })
  }
  if (url.pathname === '/en/offline' || url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || ['/favicon.ico', '/manifest.json'].includes(url.pathname)) return route.continue()
  unexpected.push(`${request.method()} ${url.href}`)
  return route.abort()
})

try {
  for (round = 0; round < rounds; round++) {
    const page = await context.newPage()
    const response = await page.goto(new URL('/en/offline?offlineCrag=missing-local-fixture', application).href, { waitUntil: 'domcontentloaded' })
    assert.equal(response.status(), 200)
    assert((await response.headerValue('content-type'))?.startsWith('text/html'), 'Document navigation must receive HTML, never an RSC response')
    assert.equal(await page.evaluate(() => 'serviceWorker' in navigator), false)
    // Both main and phase 3 SSR only the loading spinner (isLoading starts true).
    // This exact empty-list panel appears after hydration and the local IDB read,
    // so translated/fallback copy differences must not cause a false timeout.
    await page.locator('#app-shell main > div.glass-light.text-center.py-8.px-4').waitFor({ state: 'visible' })
    await page.waitForTimeout(250)
    assert.deepEqual(errors, [], 'Every page error fails the direct hydration regression')
    assert.deepEqual(unexpected, [], 'No external request or database-backed route is permitted')
    await page.close()
  }
  console.log(JSON.stringify({ passed: true, rounds, pageErrors: errors.length, externalRequests: 0, directNextHTML: true, serviceWorkerFeatureAbsent: true, fixtureProxyUsed: false, blockedSSRPrefetches: prefetches.length }))
} catch (error) {
  console.error('Direct hydration failure', { round, errors, unexpected })
  throw error
} finally { await context.close(); await browser.close() }
