/** Native browser download/Cache/IDB smoke. All APIs and media are loopback fixtures. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'

const app = new URL(process.env.OFFLINE_SMOKE_URL ?? 'http://127.0.0.1:4100')
assert(['127.0.0.1', 'localhost'].includes(app.hostname) && app.protocol === 'http:' && !app.username && !app.password, 'Only a local HTTP application is permitted')
const origin = 'http://localhost:4101'
const media = 'http://127.0.0.1:4102'
const id = 'download-fixture'
const readerRepeats = Number(process.env.OFFLINE_READER_REPEAT_COUNT ?? 1)
assert(Number.isInteger(readerRepeats) && readerRepeats >= 1 && readerRepeats <= 10, 'Reader repeat count must be between 1 and 10')
const state = { revision: 'one', failure: null, snapshotStatus: 200, delayed: [], requests: [], unexpected: [], blockedPrefetches: [] }
const failures = ['corrupt', 'http', 'cors']

function png(color) {
  const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0) } return (value ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const name = Buffer.from(type), size = Buffer.alloc(4), sum = Buffer.alloc(4); size.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([name, data]))); return Buffer.concat([size, name, data, sum]) }
  const header = Buffer.alloc(13); header.writeUInt32BE(4); header.writeUInt32BE(4, 4); header[8] = 8; header[9] = 2
  const pixels = Buffer.alloc(52)
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) pixels.set(color, row * 13 + 1 + col * 3)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}
const images = { one: png([80, 140, 180]), two: png([200, 40, 70]) }
const face = name => `https://img.bouldering.top/${id}/${encodeURIComponent('照片区')}/${encodeURIComponent(name)}.jpg?v=fixture`
const sources = [`https://img.bouldering.top/CragSurface/${id}/0.jpg?v=fixture`, `https://img.bouldering.top/${id}/Legacy%20fixture.jpg?v=fixture`, face('单图'), face('甲'), face('乙')]
function snapshot() {
  const points = [{ x: 0.1, y: 0.1 }, { x: 0.8, y: 0.9 }]
  const common = { cragId: id, area: '显示区', grade: 'V3', description: `完整线路说明 ${state.revision}`, setter: '本地测试开线者' }
  return {
    schemaVersion: 2, revision: state.revision,
    crag: { id, name: '离线下载测试岩场', cityId: 'fixture-city', location: '本地', developmentTime: '2026', description: `完整岩场介绍 ${state.revision}`, approach: '完整接近说明', coverImages: [sources[0]] },
    routes: [{ ...common, id: 92001, name: 'Legacy fixture' }, { ...common, id: 92002, name: 'Face fixture', faceId: '单图', faceArea: '照片区' }, { ...common, id: 92003, name: 'Multi fixture', topoAnnotations: [{ faceId: '甲', area: '照片区', topoLine: points }, { faceId: '乙', area: '照片区', topoLine: points }] }],
    images: sources.map(sourceUrl => ({ sourceUrl, cacheUrl: `${media}${new URL(sourceUrl).pathname}?offlineRevision=${state.revision}` })),
  }
}
function json(response, body, status = 200) { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)) }
const bundle = await build({ entryPoints: [fileURLToPath(new URL('./offline-download-fixture.tsx', import.meta.url))], absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), tsconfig: 'tsconfig.json', bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } })
const mediaServer = createServer((request, response) => {
  const url = new URL(request.url, media)
  const revision = url.searchParams.get('offlineRevision')
  if (request.method !== 'GET' || !sources.some(source => new URL(source).pathname === url.pathname) || !Object.hasOwn(images, revision)) {
    state.unexpected.push(`media ${request.method} ${url.pathname}`)
    response.writeHead(404); response.end(); return
  }
  state.requests.push({ url: url.href, origin: request.headers.origin, mode: request.headers['sec-fetch-mode'], cookie: request.headers.cookie })
  const isLast = url.pathname === new URL(sources.at(-1)).pathname
  if (isLast && state.failure === 'delay') { state.delayed.push({ request, response, revision }); return }
  const headers = { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', Vary: 'Origin' }
  if (!(isLast && state.failure === 'cors')) headers['Access-Control-Allow-Origin'] = origin
  if (isLast && state.failure === 'http') { response.writeHead(503, headers); response.end('unavailable'); return }
  response.writeHead(200, headers)
  response.end(isLast && state.failure === 'corrupt' ? Buffer.from('invalid png') : images[revision] ?? images.one)
})
const appServer = createServer(async (request, response) => {
  const url = new URL(request.url, origin)
  try {
    assert(request.method === 'GET', `Unapproved method: ${request.method}`)
    if (url.pathname === '/__offline-fixture') { response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store', 'Content-Security-Policy': `default-src 'self'; script-src 'self'; connect-src 'self' ${media}; style-src 'self' 'unsafe-inline'; img-src 'self' blob:` }); response.end('<!doctype html><html lang="zh"><head><meta charset="utf-8"></head><body><div id="fixture-root"></div><script type="module" src="/__offline-fixture.js"></script></body></html>'); return }
    if (url.pathname === '/__offline-fixture.js') { response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' }); response.end(bundle.outputFiles[0].contents); return }
    if (url.pathname === `/api/crags/${id}/offline`) return json(response, { success: state.snapshotStatus === 200, snapshot: snapshot() }, state.snapshotStatus)
    if (url.pathname === `/api/crags/${id}/version`) return json(response, { success: true, revision: state.revision, routeCount: snapshot().routes.length })
    if (url.pathname === '/api/cities') return json(response, { success: true, cities: [], prefectures: [] })
    if (url.pathname === '/api/geo') return json(response, { countryCode: 'CN' })
    assert(!url.pathname.startsWith('/api/'), `Unapproved fixture API: ${url.pathname}`)
    // The reader's real tab bar can prefetch unrelated SSR pages. Keep these failures explicit
    // and local; they must never reach database-backed routes on the application server.
    if (/^\/(zh|en|fr)(?:\/(route|profile))?$/.test(url.pathname) && request.headers.rsc === '1') {
      state.blockedPrefetches.push(url.pathname)
      return json(response, { error: 'SSR navigation is outside the offline fixture' }, 503)
    }
    // Do not allow fixture navigation to enter a database-backed application page.
    assert(url.pathname !== '/_next/image', 'Remote optimizer fetches are forbidden in this fixture')
    assert(['/sw.js', '/manifest.json', '/favicon.ico', '/apple-touch-icon.png'].includes(url.pathname) || url.pathname.startsWith('/_next/') || /^\/(zh|en|fr)\/offline$/.test(url.pathname) || url.pathname.startsWith('/icons/'), `Unapproved upstream path: ${url.pathname}`)
    const forwarded = {}
    for (const key of ['user-agent', 'accept', 'accept-language', 'rsc', 'next-router-prefetch', 'next-router-state-tree', 'next-url']) if (request.headers[key]) forwarded[key] = request.headers[key]
    const upstream = await fetch(new URL(`${url.pathname}${url.search}`, app), { redirect: 'manual', headers: forwarded })
    assert(![301, 302, 303, 307, 308].includes(upstream.status), 'Upstream redirects are not permitted')
    const headers = Object.fromEntries(upstream.headers)
    delete headers['content-length']; delete headers['content-encoding']
    if (headers['content-security-policy']) headers['content-security-policy'] = headers['content-security-policy'].replace("connect-src 'self'", `connect-src 'self' ${media}`)
    let body = Buffer.from(await upstream.arrayBuffer())
    if (url.pathname === '/sw.js') {
      const source = body.toString()
      assert(source.includes('img.bouldering.top'), 'Expected production image matcher in built SW')
      body = Buffer.from(source.replaceAll('img.bouldering.top', '127.0.0.1'))
    }
    response.writeHead(upstream.status, headers); response.end(body)
  } catch (error) { state.unexpected.push(error.message); json(response, { error: error.message }, 500) }
})
async function listen(server, port, host) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve) }) }
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
const browser = await chromium.launch({ headless: true })
const errors = [], external = [], completed = []
let phase = 'install'
let context
async function fresh({ disableLocks = false, denyNotifications = false } = {}) {
  if (context) await context.close()
  context = await browser.newContext({ serviceWorkers: 'allow' })
  if (disableLocks || denyNotifications) await context.addInitScript(({ disableLocks, denyNotifications }) => {
    if (disableLocks) Object.defineProperty(navigator, 'locks', { value: undefined })
    if (denyNotifications) Object.defineProperty(window, 'BroadcastChannel', { value: class { constructor() { throw new DOMException('Storage policy', 'SecurityError') } } })
  }, { disableLocks, denyNotifications })
  context.on('page', page => page.on('pageerror', error => errors.push({ error: error.message, stack: error.stack, url: page.url(), phase })))
  if (process.env.OFFLINE_SMOKE_DIAGNOSE === '1') {
    const { diagnoseHydration } = await import('./offline-hydration-diagnostics.mjs')
    await diagnoseHydration(context, result => console.error('Hydration diagnostic', JSON.stringify({ phase, ...result })))
  }
  // Playwright 1.58+ routes SW-owned network requests at BrowserContext level as well.
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (![origin, media].includes(url.origin)) { external.push(url.href); return route.abort() }
    return route.continue()
  })
  const page = await context.newPage()
  await page.goto(`${origin}/__offline-fixture`)
  await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready })
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  await page.getByTitle('下载离线包', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => indexedDB.databases().then(items => items.find(item => item.name === 'offline-crags')?.version)), 2)
  return page
}
const inspect = page => page.evaluate(() => window.offlineFixture.inspect())
const progress = page => page.locator('[data-testid="progress"]').textContent().then(JSON.parse)
async function download(page, label = '下载离线包') { await page.getByTitle(label, { exact: true }).click(); await page.waitForFunction(() => ['failed', 'completed'].includes(JSON.parse(document.querySelector('[data-testid="progress"]').textContent)?.status)); return progress(page) }
async function remove(page) { await page.getByRole('button', { name: 'Delete fixture', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[data-testid="downloads"]').textContent === '[]') }
async function waitEmpty(page) {
  for (let retry = 0; retry < 50; retry++) { const data = await inspect(page); if (!data.snapshot && data.images.length === 0) return; await page.waitForTimeout(50) }
  assert.fail('Snapshot/media deletion did not settle')
}
async function waitFixture(predicate) {
  for (let retry = 0; retry < 100; retry++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)) }
  assert.fail('HTTP fixture did not reach the expected state')
}
async function readOffline(page, revision) {
  await page.close(); await context.setOffline(true)
  for (const locale of Array.from({ length: readerRepeats }, () => ['zh', 'en', 'fr']).flat()) {
    phase = `${phase.split(':')[0]}:${locale}:cold`
    const reader = await context.newPage()
    const document = await reader.goto(`${origin}/${locale}/offline?offlineCrag=${id}`, { waitUntil: 'domcontentloaded' })
    assert((await document.headerValue('content-type'))?.startsWith('text/html'), 'Reader navigation must receive HTML, never an RSC response')
    assert.equal(await reader.evaluate(() => navigator.onLine), false, 'Cold reading must actually be offline')
    await reader.getByRole('heading', { name: '离线下载测试岩场', exact: true, level: 1 }).waitFor()
    await reader.getByText(`完整岩场介绍 ${revision}`, { exact: true }).waitFor()
    for (const name of ['Legacy fixture', 'Face fixture', 'Multi fixture']) {
      phase = `${phase.split(':')[0]}:${locale}:${name}`
      await reader.getByRole('button', { name: `V3 · ${name}`, exact: true }).click()
      await reader.getByRole('heading', { name, exact: true }).waitFor()
      await reader.getByText(`完整线路说明 ${revision}`, { exact: true }).waitFor()
      await reader.getByText('本地测试开线者', { exact: true }).waitFor()
      await reader.waitForFunction(count => [...document.images].filter(image => image.src.startsWith('blob:') && image.naturalWidth === 4).length === count, name === 'Multi fixture' ? 2 : 1)
      if (name === 'Multi fixture') { phase += ':reload'; assert.equal(await reader.locator('svg.pointer-events-none').count(), 2); await reader.reload({ waitUntil: 'domcontentloaded' }); await reader.getByRole('heading', { name, exact: true }).waitFor() }
      await reader.getByRole('button', { name: locale === 'zh' ? '返回' : locale === 'en' ? 'Back' : 'Retour', exact: true }).click()
    }
    await reader.close()
  }
  await context.setOffline(false)
}
async function showUpdate(page) {
  await page.clock.install({ time: new Date() })
  await page.clock.setFixedTime(new Date(Date.now() + 31 * 60 * 1000))
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await page.getByTitle('有更新', { exact: true }).waitFor()
}

try {
  await listen(mediaServer, 4102, '127.0.0.1'); await listen(appServer, 4101, '127.0.0.1')
  for (const mode of failures) {
    phase = mode
    state.revision = 'one'; state.failure = mode; state.requests = []
    const page = await fresh()
    const failed = await download(page)
    assert.equal(failed.status, 'failed'); assert.equal(failed.error, 'images'); assert.equal(failed.downloadedImages, 4); assert.equal(failed.failedImages, 1)
    assert.equal((await inspect(page)).snapshot, null)
    await page.getByRole('button', { name: '重试', exact: true }).waitFor()
    const attempts = state.requests.length
    state.failure = null
    const success = await download(page, '下载失败')
    assert.equal(success.status, 'completed'); assert.equal(success.routeCount, 3); assert.equal(state.requests.length - attempts, 1, 'Retry must reuse verified successes only')
    assert.equal((await inspect(page)).images.length, 5)
    await readOffline(page, 'one')
    completed.push(`${mode}: failed 4/5, retry completed 5/5, three-locale cold reader`)
  }
  state.revision = 'one'; state.failure = null
  phase = 'update'
  let page = await fresh()
  assert.equal((await download(page)).status, 'completed')
  await page.clock.install({ time: new Date() })
  await page.clock.setFixedTime(new Date(Date.now() + 31 * 60 * 1000))
  state.revision = 'two'; state.failure = 'corrupt'
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await page.getByTitle('有更新', { exact: true }).waitFor()
  assert.equal((await download(page, '有更新')).status, 'failed')
  assert.equal((await inspect(page)).snapshot.version, 'one', 'Failed update preserves the previous committed snapshot')
  state.failure = null
  assert.equal((await download(page, '下载失败')).status, 'completed')
  assert.equal((await inspect(page)).snapshot.version, 'two')
  await page.waitForFunction(async () => (await window.offlineFixture.inspect()).images.length === 5)
  await readOffline(page, 'two')
  completed.push('same-count revision update: failed update retained old snapshot; retry replaced and cleaned old media')
  page = await context.newPage(); await page.goto(`${origin}/__offline-fixture`)
  phase = 'cancel'
  await page.getByTitle('已下载', { exact: true }).waitFor()
  await remove(page); await waitEmpty(page)
  await page.getByTitle('下载离线包', { exact: true }).waitFor()
  state.snapshotStatus = 503
  assert.equal((await download(page)).error, 'snapshot'); assert.equal((await inspect(page)).snapshot, null)
  state.snapshotStatus = 200; state.failure = 'delay'
  await page.getByTitle('下载失败', { exact: true }).click()
  await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="progress"]').textContent)?.downloadedImages === 4)
  await waitFixture(() => state.delayed.length === 1)
  await remove(page)
  await page.getByTitle('下载离线包', { exact: true }).waitFor()
  await page.getByText('下载已取消。', { exact: true }).waitFor()
  const lateResponse = context.waitForEvent('requestfinished', { predicate: request => request.url().startsWith(`${media}${new URL(sources.at(-1)).pathname}`) })
  for (const pending of state.delayed.splice(0)) { pending.response.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': origin }); pending.response.end(images[pending.revision]) }
  await lateResponse
  await waitEmpty(page)
  completed.push('snapshot HTTP failure; deletion cancels delayed download; late media cannot publish or resurrect')

  // Both pages share the same browser storage partition and execute the current-source service.
  state.revision = 'one'; state.failure = null
  phase = 'cross-tab-delete'
  page = await fresh()
  assert.equal((await download(page)).status, 'completed')
  const other = await context.newPage()
  await other.goto(`${origin}/__offline-fixture`)
  await other.getByTitle('已下载', { exact: true }).waitFor()
  assert(await page.evaluate(() => !!navigator.locks && 'BroadcastChannel' in window), 'Cross-tab scenario requires actual Web Locks and BroadcastChannel')
  await page.clock.install({ time: new Date() }); await page.clock.setFixedTime(new Date(Date.now() + 31 * 60 * 1000))
  state.revision = 'two'; state.failure = 'delay'
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await page.getByTitle('有更新', { exact: true }).click()
  await waitFixture(() => state.delayed.length === 1)
  await remove(other)
  await page.getByText('下载已取消。', { exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('[data-testid="downloads"]').textContent === '[]')
  assert.equal((await progress(page)).error, 'cancelled')
  const crossTabLate = context.waitForEvent('requestfinished', { predicate: request => request.url().startsWith(`${media}${new URL(sources.at(-1)).pathname}`) })
  for (const pending of state.delayed.splice(0)) { pending.response.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': origin }); pending.response.end(images[pending.revision]) }
  await crossTabLate
  await waitEmpty(page); await waitEmpty(other)
  completed.push('native two-page Web Locks/BroadcastChannel: tab B deletes while tab A updates; both lists sync; late response cannot resurrect')

  state.revision = 'one'; state.failure = null
  phase = 'cross-tab-cleanup'
  page = await fresh()
  assert.equal((await download(page)).status, 'completed')
  const cleanupPeer = await context.newPage()
  await cleanupPeer.goto(`${origin}/__offline-fixture`)
  await cleanupPeer.getByTitle('已下载', { exact: true }).waitFor()
  await page.evaluate(() => window.offlineFixture.pauseCleanup())
  state.revision = 'two'
  await showUpdate(page)
  assert.equal((await download(page, '有更新')).status, 'completed')
  await page.waitForFunction(() => window.offlineFixture.cleanupPaused())
  state.revision = 'one'
  await showUpdate(cleanupPeer)
  await cleanupPeer.getByTitle('有更新', { exact: true }).click()
  await cleanupPeer.waitForFunction(async () => (await navigator.locks.query()).pending.some(lock => lock.name === 'bloctop-offline:download-fixture'))
  assert.equal((await progress(cleanupPeer)).downloadedImages, 0, 'The other tab must not write media while cleanup holds the crag lock')
  await page.evaluate(() => window.offlineFixture.releaseCleanup())
  await cleanupPeer.getByTitle('已下载', { exact: true }).waitFor()
  await cleanupPeer.waitForFunction(async () => (await window.offlineFixture.inspect()).images.length === 5)
  assert.equal((await inspect(cleanupPeer)).snapshot.version, 'one')
  await page.close()
  await readOffline(cleanupPeer, 'one')
  completed.push('native two-page cleanup lock: revision reuse waits for real Cache.delete; newly published media survives and reads offline')

  page = await fresh({ disableLocks: true, denyNotifications: true })
  assert.equal((await download(page)).status, 'completed')
  await remove(page); await waitEmpty(page)
  completed.push('feature fallback: same-tab native download/delete works with Web Locks absent and BroadcastChannel denied')
  assert(state.requests.every(request => request.origin === origin && request.mode === 'cors' && !request.cookie), 'Media must use native credential-free CORS fetches')
  assert.deepEqual(external, [], 'No external request is permitted')
  assert.deepEqual(state.unexpected, [], 'No unknown API, upstream page, method or media path is permitted')
  assert.deepEqual(errors, [], 'Every browser page error is a failure')
  console.log(JSON.stringify({ passed: true, completed, nativeIDB: true, nativeCache: true, actualDownloadButton: true, pageErrors: errors.length, externalRequests: external.length, blockedSSRPrefetches: state.blockedPrefetches.length, productionServicesUsed: false, boundary: 'Current-source download/provider/button bundle; reader and real SW from supplied production build. Test proxy substitutes only SW image hostname and adds loopback media to CSP. Snapshot API is a loopback fixture, not Mongo/R2. Unrelated tab-bar RSC prefetches explicitly fail locally.' }))
} catch (error) {
  const page = context?.pages().at(-1)
  console.error('Fixture failure', { message: error.message, revision: state.revision, failure: state.failure, pendingMedia: state.delayed.length, recentRequests: state.requests.slice(-6), unexpected: [...new Set(state.unexpected)], errors, external, page: page?.url(), body: page ? await page.locator('body').innerText().catch(() => '') : '' })
  throw error
} finally { await context?.close(); await browser.close(); await Promise.all([close(appServer), close(mediaServer)]) }
