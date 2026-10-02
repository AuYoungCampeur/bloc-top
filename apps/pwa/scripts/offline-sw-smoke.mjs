/** Local-only production SW smoke. Run against a credential-free `next start --port 4100`. */
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { chromium } from '@playwright/test'

const base = process.env.OFFLINE_SMOKE_URL ?? 'http://localhost:4100'
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Only a local fixture server is permitted')
function png() {
  const crc = bytes => {
    let value = 0xffffffff
    for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0) }
    return (value ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const label = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4)
    length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([label, data])))
    return Buffer.concat([length, label, data, checksum])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(4, 0); header.writeUInt32BE(4, 4); header[8] = 8; header[9] = 2
  const pixels = Buffer.alloc(4 * 13)
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) { pixels[row * 13 + 1 + col * 3] = 80; pixels[row * 13 + 2 + col * 3] = 140; pixels[row * 13 + 3 + col * 3] = 180 }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]).toString('base64')
}
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ serviceWorkers: 'allow' })
const errors = []
let phase = 'install'
context.on('page', page => page.on('pageerror', error => errors.push({ message: error.message, url: page.url(), phase })))
await context.route('**/*', async route => {
  const url = new URL(route.request().url())
  if (url.origin !== new URL(base).origin) return route.abort()
  if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { success: true, cities: [], prefectures: [] } })
  return route.continue()
})
try {
  const initial = await context.newPage()
  await initial.goto(`${base}/zh/offline`)
  await initial.evaluate(async () => { await navigator.serviceWorker.ready })
  await initial.waitForFunction(() => !!navigator.serviceWorker.controller)
  console.log('SW controlled; injecting local snapshot')
  const installed = await initial.evaluate(async bytes => {
    const id = 'offline-fixture', version = 'fixture-revision'
    const face = name => `https://img.bouldering.top/${id}/${encodeURIComponent('照片区')}/${encodeURIComponent(name)}.jpg?v=fixture`
    const sources = [`https://img.bouldering.top/CragSurface/${id}/0.jpg?v=fixture`, `https://img.bouldering.top/${id}/Legacy%20fixture.jpg?v=fixture`, face('单图'), face('甲'), face('乙')]
    const images = sources.map(sourceUrl => ({ sourceUrl, cacheUrl: `${sourceUrl}&offlineRevision=${version}` }))
    const raw = Uint8Array.from(atob(bytes), item => item.charCodeAt(0))
    const cache = await caches.open('offline-crag-images')
    for (const image of images) await cache.put(image.cacheUrl, new Response(raw, { headers: { 'Content-Type': 'image/png' } }))
    const crag = { id, name: '离线测试岩场', cityId: 'fixture-city', location: '本地', developmentTime: '2026', description: '完整岩场介绍', approach: '完整接近说明', coverImages: [sources[0]] }
    const common = { cragId: id, area: '显示区', grade: 'V3', description: '完整线路说明', setter: '本地测试开线者' }
    const points = [{ x: 0.1, y: 0.1 }, { x: 0.8, y: 0.9 }]
    const routes = [{ ...common, id: 91001, name: 'Legacy fixture' }, { ...common, id: 91002, name: 'Face fixture', faceId: '单图', faceArea: '照片区' }, { ...common, id: 91003, name: 'Multi fixture', topoAnnotations: [{ faceId: '甲', area: '照片区', topoLine: points }, { faceId: '乙', area: '照片区', topoLine: points }] }]
    const data = { cragId: id, crag, routes, downloadedAt: new Date().toISOString(), version, schemaVersion: 2, images, imageCount: images.length }
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('offline-crags', 2)
      request.onupgradeneeded = () => { for (const store of ['crags', 'image-cleanup']) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, { keyPath: 'cragId' }) }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('crags', 'readwrite')
        tx.objectStore('crags').put(data)
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onabort = () => reject(tx.error)
      }
    })
    localStorage.setItem('offline-crags-meta', JSON.stringify({ crags: { [id]: { cragName: crag.name, routeCount: routes.length, downloadedAt: data.downloadedAt, imageCount: images.length, revision: version } }, lastUpdated: data.downloadedAt }))
    localStorage.removeItem('preferred-locale')
    sessionStorage.removeItem('locale-detected')
    window.dispatchEvent(new Event('offline-meta-changed'))
    return { routeCount: routes.length, imageCount: images.length, caches: await caches.keys() }
  }, png())
  await initial.close()
  await context.setOffline(true)
  for (const [locale, backLabel] of [['zh', '返回'], ['en', 'Back'], ['fr', 'Retour']]) {
    phase = `${locale}-cold-start`
    const cold = await context.newPage()
    await cold.goto(`${base}/${locale}/offline?offlineCrag=offline-fixture`, { waitUntil: 'domcontentloaded' })
    await cold.getByRole('heading', { name: '离线测试岩场', exact: true, level: 1 }).waitFor()
    assert.equal(await cold.evaluate(() => localStorage.getItem('preferred-locale')), null)
    assert.equal(new URL(cold.url()).pathname, `/${locale}/offline`)
    console.log('Cold offline reader loaded without locale preference:', cold.url())
    await cold.getByText('完整岩场介绍', { exact: true }).waitFor()
    await cold.waitForFunction(() => [...document.images].some(image => image.src.startsWith('blob:') && image.naturalWidth === 4))
    for (const name of ['Legacy fixture', 'Face fixture', 'Multi fixture']) {
      phase = name
      await cold.getByRole('button', { name: `V3 · ${name}`, exact: true }).click()
      await cold.getByRole('heading', { name, exact: true }).waitFor()
      await cold.getByText('完整线路说明', { exact: true }).waitFor()
      await cold.getByText('本地测试开线者', { exact: true }).waitFor()
      const expected = name === 'Multi fixture' ? 2 : 1
      await cold.waitForFunction(count => [...document.images].filter(image => image.src.startsWith('blob:') && image.naturalWidth === 4).length === count, expected)
      if (name === 'Multi fixture') {
        assert.equal(await cold.locator('svg.pointer-events-none').count(), 2)
        phase = 'detail-reload'
        await cold.reload({ waitUntil: 'domcontentloaded' })
        await cold.getByRole('heading', { name, exact: true }).waitFor()
        await cold.waitForFunction(() => [...document.images].filter(image => image.src.startsWith('blob:') && image.naturalWidth === 4).length === 2)
      }
      await cold.getByRole('button', { name: backLabel, exact: true }).click()
    }
    await cold.close()
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, ...installed, offlineColdStart: true, withoutLocalePreference: true, locales: ['zh', 'en', 'fr'], pageErrors: errors.length, reloadDetail: true, legacyFaceMultiTopo: true, productionServicesUsed: false, scope: 'Native IDB/Cache fixture + actual production PWA reader/SW; server snapshot/downloader covered separately by unit tests.' }))
} catch (error) {
  const page = context.pages().at(-1)
  if (page) console.log('Failure state:', page.url(), await page.locator('body').innerText(), errors)
  throw error
} finally { await context.close(); await browser.close() }
