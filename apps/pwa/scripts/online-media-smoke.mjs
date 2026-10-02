/** Real source UI + native SW/Cache/IDB, loopback only. No Next build/server.
 * The local optimizer is a sticky HTTP adapter, not the Next server optimizer.
 * Root's final application build remains necessary for SSR/framework integration.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { build } from 'esbuild'
import { chromium, expect } from '@playwright/test'

const origin = 'http://127.0.0.1:4103'
const directory = fileURLToPath(new URL('../', import.meta.url))
const state = { revisions: { 'media-a': 'one', 'media-b': 'b-one' }, topoVersion: 1, delayRoutes: false, waiting: [], requests: [], unexpected: [], failedRead: false, failedImage: false }
const colors = { one: [80, 140, 180], two: [200, 40, 70], three: [210, 120, 20], four: [240, 60, 110], five: [50, 70, 240], 'b-one': [30, 200, 60] }
function png(color) {
  const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0) } return (value ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const name = Buffer.from(type), size = Buffer.alloc(4), sum = Buffer.alloc(4); size.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([name, data]))); return Buffer.concat([size, name, data, sum]) }
  const header = Buffer.alloc(13); header.writeUInt32BE(4); header.writeUInt32BE(4, 4); header[8] = 8; header[9] = 2
  const pixels = Buffer.alloc(52)
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) pixels.set(color, row * 13 + 1 + col * 3)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}
const images = Object.fromEntries(Object.entries(colors).map(([key, color]) => [key, png(color)]))
function packet(id) {
  const revision = state.revisions[id]
  const version = id === 'media-a' ? state.topoVersion : 1
  const points = [{ x: Math.min(0.1 + (version - 1) * 0.1, 0.8), y: 0.1 }, { x: 0.9, y: 0.8 }]
  const common = { cragId: id, grade: 'V3', area: 'display', topoVersion: version, description: `Topo version ${version}` }
  return {
    crag: { id, name: id, cityId: 'fixture', location: 'Local', developmentTime: '2026', description: `Media ${revision}`, approach: '', mediaRevision: revision, coverImages: [`${origin}/CragSurface/${id}/0.jpg?v=fixture`] },
    routes: [{ ...common, id: id === 'media-a' ? 1 : 11, name: 'Legacy', topoLine: points },
      { ...common, id: id === 'media-a' ? 2 : 12, name: 'Face', faceId: 'single', faceArea: 'photos', topoLine: points },
      { ...common, id: id === 'media-a' ? 3 : 13, name: 'Multi', topoAnnotations: [{ faceId: 'first', area: 'photos', topoLine: points }, { faceId: 'second', area: 'other', topoLine: points }] }],
  }
}
const initialSeed = ['media-a', 'media-b'].map(packet)
const paths = new Set(['media-a', 'media-b'].flatMap(id => [`/CragSurface/${id}/0.jpg`, `/${id}/Legacy.jpg`, `/${id}/photos/single.jpg`, `/${id}/photos/first.jpg`, `/${id}/other/second.jpg`]))
const stickyOptimizer = new Map()
const plugins = [{ name: 'isolated-local-fixture', setup(builder) {
  builder.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: 'no-beta-ui', namespace: 'local-fixture' }))
  builder.onLoad({ filter: /.*/, namespace: 'local-fixture' }, () => ({ contents: 'export default function dynamic(){return function ExcludedBetaUI(){return null}}', loader: 'js' }))
  builder.onLoad({ filter: /packages\/shared\/src\/constants\.ts$/ }, async args => {
    const source = await readFile(args.path, 'utf8')
    assert(source.includes("const IMAGE_BASE_URL = 'https://img.bouldering.top'"), 'Expected production media URL')
    return { contents: source.replaceAll('https://img.bouldering.top', origin), loader: 'ts' }
  })
  builder.onLoad({ filter: /src\/app\/sw\.ts$/ }, async args => {
    const source = await readFile(args.path, 'utf8')
    assert.equal(source.split('url.hostname === "img.bouldering.top"').length - 1, 2, 'Expected both production media matchers')
    return { contents: source.replaceAll('url.hostname === "img.bouldering.top"', 'url.origin === self.location.origin && url.pathname.endsWith(".jpg")').replaceAll('img.bouldering.top', '127.0.0.1'), loader: 'ts' }
  })
} }]
const options = { absWorkingDir: directory, tsconfig: 'tsconfig.json', bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', plugins, define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' } }
const ui = await build({ ...options, entryPoints: ['scripts/online-media-fixture.tsx'] })
const sw = await build({ ...options, entryPoints: ['src/app/sw.ts'], define: { ...options.define, 'self.__SW_MANIFEST': JSON.stringify(['zh', 'en', 'fr'].map(locale => ({ url: `/${locale}/offline`, revision: 'local-media-fixture' }))) } })
const css = `body{margin:0} .relative{position:relative}.absolute{position:absolute}.fixed{position:fixed}.inset-0{inset:0}.w-full{width:100%}.h-full{height:100%}.h-48{height:192px}.h-dvh{height:100vh}.w-16{width:64px}.h-12{height:48px}.w-9{width:36px}.h-9{height:36px}.w-8{width:32px}.h-8{height:32px}.flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1}.flex-none{flex:none}.flex-shrink-0{flex-shrink:0}.overflow-x-auto{overflow-x:auto}.overflow-y-auto{overflow-y:auto}.overflow-hidden{overflow:hidden}.object-contain{object-fit:contain}.object-cover{object-fit:cover}.hidden{display:none}.opacity-0{opacity:0}.opacity-100{opacity:1}.pointer-events-none{pointer-events:none}.items-center{align-items:center}.justify-center{justify-content:center} button{cursor:pointer}.fixed[class*="z-[60]"]{z-index:60}.z-50{z-index:50}.z-10{z-index:10}.top-3{top:12px}.right-3{right:12px}.bottom-3{bottom:12px}.top-12{top:48px}.left-4{left:16px}.right-4{right:16px}.bottom-8{bottom:32px}.bottom-0{bottom:0}.left-0{left:0}.right-0{right:0}`
function json(response, value, status = 200) { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)) }
const server = createServer((request, response) => {
  const url = new URL(request.url, origin)
  try {
    assert(request.method === 'GET', `Unapproved method ${request.method}`)
    state.requests.push(url.href)
    if (url.pathname === '/' || /^\/(zh|en|fr)\/offline$/.test(url.pathname)) {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'" })
      response.end(`<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>${css}</style></head><body><div id="fixture-root"></div><script>window.onlineMediaFixture={seed:${JSON.stringify(initialSeed)}}</script><script src="/fixture.js"></script></body></html>`); return
    }
    if (url.pathname === '/fixture.js' || url.pathname === '/sw.js') { response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' }); response.end((url.pathname === '/sw.js' ? sw : ui).outputFiles[0].contents); return }
    if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return }
    if (url.pathname === '/api/beta') return json(response, { success: true, betaLinks: [] })
    const match = url.pathname.match(/^\/api\/crags\/(media-[ab])(?:\/(routes|offline))?$/)
    if (match) {
      const [, id, endpoint] = match
      if (state.failedRead && id === 'media-a') return json(response, { success: false }, 503)
      const content = packet(id)
      if (endpoint === 'routes') {
        if (state.delayRoutes && id === 'media-a') { state.waiting.push(() => json(response, { success: true, routes: content.routes, cragId: id })); return }
        return json(response, { success: true, routes: content.routes, cragId: id })
      }
      if (endpoint === 'offline') {
        const sources = [...paths].filter(path => path.includes(id)).map(path => `${origin}${path}?v=fixture`)
        return json(response, { success: true, snapshot: { ...content, schemaVersion: 2, revision: `snapshot-${content.crag.mediaRevision}`, images: sources.map(sourceUrl => ({ sourceUrl, cacheUrl: `${sourceUrl}&offlineRevision=snapshot-${content.crag.mediaRevision}` })) } })
      }
      return json(response, { success: true, crag: content.crag })
    }
    const sendImage = (source, optimized) => {
      assert(source.origin === origin && paths.has(source.pathname), 'Unapproved media URL')
      // Mutable key deliberately ignores both mr and offlineRevision. Old pixels survive only in caches.
      const id = source.pathname.includes('media-a') ? 'media-a' : 'media-b'
      if (state.failedImage && id === 'media-a' && source.pathname.endsWith('/single.jpg')) { response.writeHead(503); response.end(); return }
      const key = source.href
      const bytes = optimized ? stickyOptimizer.get(key) ?? images[state.revisions[id]] : images[state.revisions[id]]
      if (optimized) stickyOptimizer.set(key, bytes)
      response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000' }); response.end(bytes)
    }
    if (url.pathname === '/_next/image') return sendImage(new URL(url.searchParams.get('url')), true)
    if (paths.has(url.pathname)) return sendImage(url, false)
    throw new Error(`Unapproved path ${url.pathname}`)
  } catch (error) { state.unexpected.push(error.message); json(response, { error: error.message }, 500) }
})
const errors = [], external = [], evidence = []
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 1000, height: 800 } })
context.on('page', page => page.on('pageerror', error => errors.push({ message: error.message, stack: error.stack })))
await context.route('**/*', route => {
  if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort() }
  return route.continue()
})
async function pixel(locator) {
  await locator.waitFor()
  await expect.poll(() => locator.evaluate(image => image.naturalWidth)).toBeGreaterThan(0)
  await expect.poll(() => locator.evaluate(image => getComputedStyle(image).display)).not.toBe('none')
  await expect.poll(() => locator.evaluate(image => getComputedStyle(image).opacity)).not.toBe('0')
  await locator.evaluate(image => image.decode())
  return locator.evaluate(image => {
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1
    const drawing = canvas.getContext('2d'); drawing.drawImage(image, 0, 0, 1, 1)
    return [...drawing.getImageData(0, 0, 1, 1).data].slice(0, 3)
  })
}
const reading = page => page.locator('#reading-packet').textContent().then(JSON.parse)
async function restore(page, revision) {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForFunction(revision => JSON.parse(document.querySelector('#reading-packet').textContent).crag.mediaRevision === revision, revision)
}
async function topoPaths(page) { return page.locator('svg.pointer-events-none path').evaluateAll(paths => paths.map(path => path.getAttribute('d'))) }
async function show(page, name) {
  await page.getByRole('button', { name: `Show ${name}`, exact: true }).click()
  const image = page.locator(`img[alt="${name}"]`).first()
  await pixel(image)
  await page.waitForFunction(() => !!document.querySelector('svg.pointer-events-none path'))
  return image
}
async function closeDrawer(page) {
  const close = page.getByRole('button', { name: '关闭', exact: true })
  await close.last().click()
  await page.waitForTimeout(350)
}
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4103, '127.0.0.1', resolve) })
  const page = await context.newPage()
  await page.goto(`${origin}/`)
  await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready })
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  await page.reload()
  const cover = page.locator('#covers img').first(), thumbnail = page.locator('#thumbnails img[alt="single"]')
  assert.deepEqual(await pixel(cover), colors.one); assert.deepEqual(await pixel(thumbnail), colors.one)
  // Complete a real old download, before mutating its R2-style keys.
  await page.evaluate(() => window.onlineMediaFixture.download())
  assert.equal((await page.evaluate(() => window.onlineMediaFixture.readDownload())).version, 'snapshot-one')
  let image = await show(page, 'Legacy')
  assert.deepEqual(await pixel(image), colors.one)
  const oldTopo = await topoPaths(page)
  await closeDrawer(page)
  image = await show(page, 'Face'); assert.deepEqual(await pixel(image), colors.one); await closeDrawer(page)
  await show(page, 'Multi')
  for (const locator of await page.locator('img[alt="Multi"]').all()) assert.deepEqual(await pixel(locator), colors.one)
  await page.getByRole('button', { name: '点击放大', exact: true }).first().click()
  assert.deepEqual(await pixel(page.locator('img[alt="Multi"]').last()), colors.one)
  await closeDrawer(page); await closeDrawer(page)
  image = await show(page, 'Legacy')
  state.revisions['media-a'] = 'two'; state.topoVersion = 2; state.delayRoutes = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  for (let attempt = 0; state.waiting.length === 0 && attempt < 100; attempt++) await page.waitForTimeout(20)
  assert(state.waiting.length > 0, 'Routes must be held after the new crag read')
  assert.equal((await reading(page)).crag.mediaRevision, 'one')
  assert.deepEqual(await pixel(image), colors.one); assert.deepEqual(await topoPaths(page), oldTopo)
  state.delayRoutes = false; state.waiting.splice(0).forEach(release => release())
  await page.waitForFunction(() => JSON.parse(document.querySelector('#reading-packet').textContent).crag.mediaRevision === 'two')
  image = page.locator('img[alt="Legacy"]').first()
  assert.deepEqual(await pixel(image), colors.two)
  await page.waitForFunction(() => !!document.querySelector('svg.pointer-events-none path'))
  assert.notDeepEqual(await topoPaths(page), oldTopo)
  assert.equal((await reading(page)).routes[0].topoVersion, 2)
  await closeDrawer(page)
  assert.deepEqual(await pixel(cover), colors.two); assert.deepEqual(await pixel(thumbnail), colors.two)
  image = await show(page, 'Face'); assert.deepEqual(await pixel(image), colors.two); await closeDrawer(page)
  image = await show(page, 'Multi')
  const multi = page.locator('img[alt="Multi"]')
  assert.equal(await multi.count(), 2)
  for (const locator of await multi.all()) assert.deepEqual(await pixel(locator), colors.two)
  await page.getByRole('button', { name: '点击放大', exact: true }).first().click()
  assert.deepEqual(await pixel(page.locator('img[alt="Multi"]').last()), colors.two)
  const lightboxTopo = await topoPaths(page)
  // Keep a fullscreen viewer open while its complete reading packet changes.
  state.revisions['media-a'] = 'three'; state.topoVersion = 3
  await restore(page, 'three')
  assert.deepEqual(await pixel(page.locator('img[alt="Multi"]').last()), colors.three)
  await page.waitForFunction(() => !!document.querySelector('svg.pointer-events-none path'))
  assert.notDeepEqual(await topoPaths(page), lightboxTopo)
  assert.equal((await reading(page)).routes[2].topoVersion, 3)
  await closeDrawer(page); await closeDrawer(page)
  evidence.push('warm old bytes -> fresh cover/legacy/face/multi/thumbnail/lightbox pixels + Topo 2; held routes preserve old coherent view')
  state.failedRead = true; state.revisions['media-a'] = 'four'; state.topoVersion = 4
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.waitForTimeout(200)
  assert.equal((await reading(page)).crag.mediaRevision, 'three'); assert.deepEqual(await pixel(cover), colors.three)
  state.failedRead = false
  // A's late complete packet must not change the currently active B view.
  state.delayRoutes = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  for (let attempt = 0; state.waiting.length === 0 && attempt < 100; attempt++) await page.waitForTimeout(20)
  assert(state.waiting.length > 0)
  await page.getByRole('button', { name: 'Switch crag', exact: true }).click()
  assert.deepEqual(await pixel(cover), colors['b-one']); assert.equal((await reading(page)).crag.id, 'media-b')
  state.delayRoutes = false; state.waiting.splice(0).forEach(release => release())
  await page.waitForTimeout(100)
  assert.deepEqual(await pixel(cover), colors['b-one']); assert.equal((await reading(page)).crag.mediaRevision, 'b-one')
  state.failedImage = true
  await page.getByRole('button', { name: 'Switch crag', exact: true }).click(); await restore(page, 'four')
  assert.deepEqual(await pixel(cover), colors.four)
  await page.waitForFunction(() => {
    const image = document.querySelector('#thumbnails img[alt="single"]')
    return image?.complete && image.naturalWidth === 0 && getComputedStyle(image).display === 'none'
  })
  evidence.push('replacement image HTTP failure cannot retain previously displayed thumbnail pixels')
  state.failedImage = false; state.revisions['media-a'] = 'five'; state.topoVersion = 5
  await restore(page, 'five')
  assert.deepEqual(await pixel(thumbnail), colors.five)
  image = await show(page, 'Face')
  const beforeTopoOnly = await topoPaths(page)
  state.topoVersion = 6 // A Topo edit alone does not necessarily publish mediaRevision.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForFunction(() => JSON.parse(document.querySelector('#reading-packet').textContent).routes[1].topoVersion === 6)
  assert.equal((await reading(page)).crag.mediaRevision, 'five')
  assert.deepEqual(await pixel(image), colors.five)
  assert.notDeepEqual(await topoPaths(page), beforeTopoOnly)
  await closeDrawer(page)
  evidence.push('same media revision still refreshes Topo metadata; late A reading result cannot alter B pixels')
  evidence.push('failed read retains old complete view; crag B pixels/revision isolated; return A refreshes')
  // Runtime caches must retain old and new keys, rather than ignore the revision query.
  const runtimeKeys = await page.evaluate(async () => (await (await caches.open('r2-images')).keys()).map(request => request.url))
  assert(runtimeKeys.some(url => url.includes('mr=one')) && runtimeKeys.some(url => url.includes('mr=two')))
  assert.equal((await page.evaluate(() => window.onlineMediaFixture.readDownload())).crag.mediaRevision, 'one')
  await page.close(); await context.setOffline(true)
  const reader = await context.newPage()
  await reader.goto(`${origin}/zh/offline`)
  await reader.getByRole('heading', { name: 'media-a', exact: true }).waitFor()
  assert.deepEqual(await pixel(reader.locator('img[alt="media-a"]')), colors.one)
  await reader.getByRole('button', { name: 'V3 · Legacy', exact: true }).click()
  assert.deepEqual(await pixel(reader.locator('img[alt="Legacy 1"]')), colors.one)
  assert((await reader.getByText('Topo version 1', { exact: true }).count()) === 1)
  evidence.push('real downloaded native IDB/Cache snapshot keeps old pixels + Topo 1 after online update; cold SW offline reader')
  assert.deepEqual(errors, [], 'All page errors fail'); assert.deepEqual(external, [], 'All external requests fail'); assert.deepEqual(state.unexpected, [], 'All unapproved fixture paths fail')
  console.log(JSON.stringify({ passed: evidence, pageErrors: errors.length, externalRequests: external.length, requests: state.requests.length, boundary: 'Source UI/native SW; local sticky optimizer adapter. No Next SSR/optimizer or production R2 atomic guarantee.' }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ pageErrors: errors, external, unexpected: state.unexpected, lastRequests: state.requests.slice(-10) }, null, 2))
  throw error
} finally {
  await context.close(); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
}
