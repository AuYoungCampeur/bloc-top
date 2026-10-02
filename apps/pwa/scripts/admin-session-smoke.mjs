/**
 * Real production builds + Chromium + an explicitly selected local replica set.
 * No auth/business API is mocked. Run only after both applications are built with
 * NEXT_PUBLIC_PWA_URL=http://localhost:4200 and
 * NEXT_PUBLIC_EDITOR_URL=NEXT_PUBLIC_APP_URL=http://localhost:4201.
 * Set NEXT_PUBLIC_AMAP_KEY='' for this build; maps are outside this acceptance.
 * BLOCTOP_TEST_MONGODB_URI must explicitly select loopback/bloctop-test.
 * --preflight checks inputs/artifacts without connecting, starting, or writing.
 * --auth-only skips phase-2 creation/publication features and uses the caller's
 * workspace root (CWD), including that workspace's installed Next executable.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { MongoClient, ObjectId } from 'mongodb'
import { chromium, expect } from '@playwright/test'

const authOnly = process.argv.includes('--auth-only')
const projectDirectory = authOnly ? process.cwd() : fileURLToPath(new URL('../../../', import.meta.url))
const require = createRequire(join(projectDirectory, 'apps/pwa/package.json'))
const pwaOrigin = 'http://localhost:4200'
const editorOrigin = 'http://localhost:4201'
const origins = [pwaOrigin, editorOrigin]
const sourceApps = [
  { name: 'pwa', port: 4200, source: join(projectDirectory, 'apps/pwa') },
  { name: 'editor', port: 4201, source: join(projectDirectory, 'apps/editor') },
]
const owner = randomUUID().replaceAll('-', '')
const databaseName = `bloctop_test_${owner}`
const password = randomBytes(32).toString('base64url')
const secret = randomBytes(48).toString('base64url')
const accounts = Object.fromEntries(['admin', 'controller', 'manager', 'user'].map(name => [name, {
  name: `Browser fixture ${name}`, email: `${name}-${owner}@example.invalid`, password,
}]))
const children = [], contexts = [], completed = [], browserErrors = [], blockedAssets = [], adaptedImages = [], blockedServices = [], forbiddenBrowserRequests = []
const httpDiagnostics = [], serverErrorNames = new Set()
const browserResponseFailures = []
const knownErrorCodes = new Set(['INVALID_EMAIL', 'INVALID_EMAIL_OR_PASSWORD', 'INVALID_ORIGIN', 'MISSING_OR_NULL_ORIGIN',
  'PASSWORD_TOO_SHORT', 'PASSWORD_TOO_LONG', 'FAILED_TO_CREATE_USER', 'FAILED_TO_CREATE_SESSION',
  'USER_ALREADY_EXISTS', 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 'EMAIL_PASSWORD_SIGN_UP_DISABLED',
  'INVALID_CALLBACK_URL', 'INVALID_REDIRECT_URL', 'EMAIL_NOT_VERIFIED', 'DUPLICATE_BETA'])
let phase = 'preflight', temporaryDirectory, client, db, browser, databaseOwned = false, cleanupPromise, serverReportPath

function recordHttp(operation, status, data) {
  // Never retain a body, message, account ID, cookie, token or submitted value.
  const code = knownErrorCodes.has(data?.code) ? data.code : null
  httpDiagnostics.push({ operation, status, ...(code ? { code } : {}),
    ...(data?.error === 'Auth initialization failed' ? { failure: 'auth-initialization' } : {}) })
}

async function blockedServerConnections() {
  if (!serverReportPath) return []
  const report = await readFile(serverReportPath, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })
  return report.trim().split('\n').filter(Boolean).map(line => {
    const value = JSON.parse(line)
    return { host: typeof value.host === 'string' && /^[a-zA-Z0-9.:[\]_-]{1,253}$/.test(value.host) ? value.host : 'non-host-value',
      port: Number.isInteger(value.port) ? value.port : null }
  })
}

async function browserPageFacts() {
  return Promise.all(contexts.flatMap(context => context.pages()).map(async page => {
    const url = new URL(page.url())
    if (!origins.includes(url.origin)) return { fixtureOrigin: false }
    return { fixtureOrigin: true, loginPath: url.pathname === '/zh/login',
      passwordTabCount: await page.getByRole('tab', { name: '密码登录', exact: true }).count(),
      passwordButtonCount: await page.getByRole('button', { name: '密码登录', exact: true }).count(),
      passwordTextCount: await page.getByText('密码登录', { exact: true }).count(),
      emailInputCount: await page.getByPlaceholder('输入邮箱地址', { exact: true }).count(),
      passwordInputCount: await page.locator('input[type="password"]').count() }
  }))
}

function testUri() {
  const uri = process.env.BLOCTOP_TEST_MONGODB_URI
  assert(uri, 'An explicit BLOCTOP_TEST_MONGODB_URI is required; application configuration is never used')
  const parsed = new URL(uri)
  assert(parsed.protocol === 'mongodb:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname), 'Mongo must use a single loopback host')
  assert(!parsed.username && !parsed.password && ['', '/'].includes(parsed.pathname), 'Only a credential-free test-server URI is accepted')
  assert(parsed.searchParams.get('replicaSet') === 'bloctop-test', 'Only replicaSet=bloctop-test is accepted')
  assert(Number.isInteger(Number(parsed.port)) && Number(parsed.port) >= 1024, 'An explicit local Mongo port is required')
  return { uri, port: Number(parsed.port) }
}

async function artifacts() {
  return Promise.all(sourceApps.map(async app => {
    const [required, buildId] = await Promise.all([
      readFile(join(app.source, '.next/required-server-files.json'), 'utf8'),
      readFile(join(app.source, '.next/BUILD_ID'), 'utf8'),
    ])
    const config = JSON.parse(required).config
    assert(config && config.distDir === '.next' && !config.output, 'A normal .next production build is required')
    assert(Object.keys(config.env ?? {}).length === 0, 'Build-time next.config env injections are not permitted')
    return { ...app, config, buildId: buildId.trim() }
  }))
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill('SIGTERM')
  const force = setTimeout(() => child.kill('SIGKILL'), 5000)
  try { await exited } finally { clearTimeout(force) }
}

function cleanup() {
  if (cleanupPromise) return cleanupPromise
  cleanupPromise = (async () => {
    try {
      await Promise.allSettled(contexts.map(context => context.close()))
      await browser?.close()
    } finally {
      await Promise.allSettled(children.map(stopChild))
      try {
        if (databaseOwned) {
          assert(/^bloctop_test_[a-f0-9]{32}$/.test(databaseName), 'Cleanup database ownership check failed')
          const marker = await db.collection('__admin_session_smoke_owner').findOne({ _id: owner })
          assert(marker?.owner === owner, 'Refusing to drop a database without this process ownership marker')
          await db.dropDatabase()
          databaseOwned = false
        }
      } finally {
        await client?.close()
        if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
      }
    }
  })()
  return cleanupPromise
}

// A preload fences even server-side AWS/Resend/optimizer/telemetry connections.
// It does not replace HTTP responses or database commands.
async function writeNetworkGuard(port) {
  const guardPath = join(temporaryDirectory, 'loopback-only.cjs')
  const reportPath = join(temporaryDirectory, 'blocked-server-connections.jsonl')
  serverReportPath = reportPath
  await writeFile(guardPath, `
const net = require('node:net');
const fs = require('node:fs');
const original = net.Socket.prototype.connect;
const ports = new Set([${port}, 4200, 4201]);
const hosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
net.Socket.prototype.connect = function(...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = first && typeof first === 'object' ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  const host = options.host || options.hostname || 'localhost';
  if (options.path || !hosts.has(host) || !ports.has(Number(options.port))) {
    fs.appendFileSync(${JSON.stringify(reportPath)}, JSON.stringify({ host, port: Number(options.port) || null }) + '\\n');
    throw new Error('Smoke test blocked a non-fixture socket');
  }
  return Reflect.apply(original, this, args);
};
`)
  return { guardPath, reportPath }
}

async function startApplications(builds, uri, guardPath) {
  for (const app of builds) {
    const portCheck = createServer()
    await new Promise((resolve, reject) => { portCheck.once('error', reject); portCheck.listen(app.port, '127.0.0.1', resolve) })
    await new Promise(resolve => portCheck.close(resolve))
    const directory = join(temporaryDirectory, app.name)
    await mkdir(directory)
    // Runtime caches remain in the owned temporary directory, never in source.
    await cp(join(app.source, '.next'), join(directory, '.next'), {
      recursive: true, filter: source => !source.startsWith(join(app.source, '.next/cache')),
    })
    try {
      await cp(join(app.source, 'public'), join(directory, 'public'), { recursive: true })
    } catch (error) {
      if (app.name !== 'editor' || error.code !== 'ENOENT') throw error
      await mkdir(join(directory, 'public'))
    }
    await symlink(join(app.source, 'node_modules'), join(directory, 'node_modules'), 'dir')
    const config = { ...app.config }
    for (const key of ['configOrigin', 'configFile', 'configFileName']) delete config[key]
    await writeFile(join(directory, 'next.config.mjs'), `export default ${JSON.stringify(config)};\n`)
    // Use Next's normal start command with the owned directory. Any automatic
    // .env lookup is confined to this directory, which contains no .env files.
    const child = spawn(process.execPath, ['--require', guardPath, require.resolve('next/dist/bin/next'),
      'start', directory, '--hostname', '127.0.0.1', '--port', String(app.port)], {
      cwd: directory,
      // Deliberately do not spread process.env: no .env, VERCEL, real credentials,
      // proxy settings, NODE_OPTIONS, or inherited configuration may leak in.
      env: {
        PATH: process.env.PATH ?? '', TMPDIR: temporaryDirectory,
        NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', AWS_EC2_METADATA_DISABLED: 'true',
        MONGODB_URI: uri, MONGODB_DB_NAME: databaseName,
        BETTER_AUTH_SECRET: secret, REVALIDATE_SECRET: secret,
        RESEND_API_KEY: 're_admin_session_smoke_not_deliverable', RESEND_FROM_EMAIL: 'fixture@example.invalid',
        NEXT_PUBLIC_PWA_URL: pwaOrigin, NEXT_PUBLIC_EDITOR_URL: editorOrigin, NEXT_PUBLIC_APP_URL: editorOrigin, NEXT_PUBLIC_AMAP_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // Recognize readiness from this exact owned child, then drain without
    // retaining or displaying cookies, tokens, passwords, or application logs.
    let childReady = false
    child.stdout.on('data', chunk => { if (chunk.toString().includes('Ready in')) childReady = true })
    child.stderr.on('data', chunk => {
      // Extract only allowlisted structural error names in process; raw logs
      // may contain auth data and are never stored or displayed.
      for (const name of ['MongoServerError', 'MongoNetworkError', 'MongoServerSelectionError', 'TypeError', 'RangeError',
        'ReferenceError', 'SyntaxError', 'ZodError', 'APIError', 'BetterAuthError']) {
        if (new RegExp(`\\b${name}\\b`).test(chunk.toString())) serverErrorNames.add(`${app.name}:${name}`)
      }
    })
    children.push(child)
    let ready = false
    for (let attempt = 0; attempt < 150; attempt++) {
      assert(child.exitCode === null && child.signalCode === null, `${app.name} server exited before readiness`)
      try {
        const response = await fetch(`http://localhost:${app.port}/api/crags`, { redirect: 'manual', signal: AbortSignal.timeout(1000) })
        const data = await response.json()
        if (childReady && response.status === 200 && data.success && Array.isArray(data.crags) && !data.crags.length) { ready = true; break }
      } catch { /* Startup is bounded; no fallback server is ever used. */ }
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    assert(ready, `${app.name} did not become ready with the isolated database`)
  }
}

function fixtureImage() {
  const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0) } return (value ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => {
    const name = Buffer.from(type), size = Buffer.alloc(4), sum = Buffer.alloc(4)
    size.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([name, data])))
    return Buffer.concat([size, name, data, sum])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 80, 140, 180]))), chunk('IEND', Buffer.alloc(0))])
}
const image = fixtureImage()
function isFixtureImage(url) {
  return url.origin === 'https://img.bouldering.top' && [
    '/smoke-a/Fixture route A.jpg', '/smoke-b/Fixture route B.jpg',
    '/CragSurface/smoke-a/0.jpg', '/CragSurface/smoke-b/0.jpg', '/CragSurface/browser-created-crag/0.jpg',
  ].includes(decodeURIComponent(url.pathname))
}

function serveFixtureImage(route, url) {
  adaptedImages.push(decodeURIComponent(url.pathname))
  return route.fulfill({ status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': pwaOrigin }, body: image })
}

async function newContext({ preferredLocale = true } = {}) {
  const context = await browser.newContext()
  contexts.push(context)
  context.setDefaultTimeout(15000)
  // Model a browser without the feature, rather than rejecting a registration
  // Promise that Serwist may treat as an uncaught error. All pageerrors still fail.
  await context.addInitScript(({ pwaOrigin, preferredLocale }) => {
    delete Navigator.prototype.serviceWorker
    // Exercise the actual Chinese UI with the application's persisted user
    // preference, rather than replacing IP geolocation/auth responses.
    if (preferredLocale && location.origin === pwaOrigin) localStorage.setItem('preferred-locale', 'zh')
  }, { pwaOrigin, preferredLocale })
  context.on('page', page => {
    page.on('pageerror', () => browserErrors.push(phase))
    page.on('response', response => {
      if (response.status() >= 400) browserResponseFailures.push({ phase, status: response.status(), type: response.request().resourceType() })
    })
  })
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (request.method() === 'GET' && isFixtureImage(url)) return serveFixtureImage(route, url)
    if (origins.includes(url.origin)) {
      // Weather may be enabled by a public key in the supplied build. Abort this
      // unrelated service before reaching its API; no fixture response replaces it.
      if (url.pathname === '/api/weather') { blockedServices.push('weather'); return route.abort() }
      if (url.pathname === '/_next/image') {
        const source = url.searchParams.get('url')
        if (source && !origins.includes(new URL(source, url.origin).origin)) {
          if (request.method() === 'GET' && isFixtureImage(new URL(source, url.origin))) return serveFixtureImage(route, new URL(source, url.origin))
          blockedAssets.push('remote-image-optimizer'); return route.abort()
        }
      }
      return route.continue()
    }
    const optionalAsset = request.method() === 'GET' && ['image', 'font', 'stylesheet'].includes(request.resourceType())
    if (optionalAsset) blockedAssets.push(request.resourceType())
    else forbiddenBrowserRequests.push({ phase, host: url.hostname, type: request.resourceType() })
    return route.abort()
  })
  return context
}

async function apiPage(context, origin) {
  assert(origins.includes(origin), 'Only known application origins can be opened')
  const page = await context.newPage()
  const response = await page.goto(`${origin}/api/crags`)
  assert.equal(response.status(), 200, 'API document must come from the real application')
  assert.equal(await page.evaluate(() => 'serviceWorker' in navigator), false, 'The browser must explicitly lack Service Worker support')
  return page
}

async function request(page, path, method = 'GET', body) {
  assert(origins.includes(new URL(page.url()).origin) && path.startsWith('/api/'), 'API checks must run in an actual application browser origin')
  const result = await page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, {
      method, credentials: 'include', cache: 'no-store', redirect: 'manual',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
    // Some Better Auth authorization responses legitimately have no JSON body.
    // Their real status remains subject to the same policy assertions below.
    return { status: response.status, data: await response.json().catch(() => null) }
  }, { path, method, body })
  recordHttp(`${method} ${path.split('?')[0]}`, result.status, result.data)
  return result
}

async function passwordLogin(context, account, destination) {
  const page = await context.newPage()
  const document = await page.goto(`${pwaOrigin}/zh/login?callbackURL=${encodeURIComponent(destination)}`)
  recordHttp('password login document', document.status(), null)
  assert.equal(await page.evaluate(() => 'serviceWorker' in navigator), false, 'Authentication runs without Service Worker support')
  await page.getByRole('tab', { name: '密码登录', exact: true }).click()
  await page.getByPlaceholder('输入邮箱地址', { exact: true }).fill(account.email)
  await page.locator('input[type="password"]').fill(password)
  let authenticated = false
  for (let attempt = 0; attempt < 3; attempt++) {
    const login = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/sign-in/email' && response.request().method() === 'POST')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    const response = await login
    recordHttp('password login', response.status(), await response.json().catch(() => null))
    if (response.status() === 429) {
      await respectRateLimit(response.headers()['retry-after'] ?? response.headers()['x-retry-after'])
      continue
    }
    assert.equal(response.status(), 200, 'Real password authentication must succeed')
    authenticated = true; break
  }
  assert(authenticated, 'Fixture login must succeed within its bounded rate-limit retry')
  await page.waitForURL(destination)
  return page
}

async function firstVisitCallbackPreservation() {
  phase = 'first-visit locale callback preservation'
  const context = await newContext({ preferredLocale: false })
  const page = await context.newPage()
  const destination = `${editorOrigin}/`
  const geoResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/geo')
  const document = await page.goto(`${pwaOrigin}/zh/login?callbackURL=${encodeURIComponent(destination)}#locale-smoke`)
  recordHttp('first-visit login document', document.status(), null)
  assert.equal(document.status(), 200)
  const geo = await geoResponse
  recordHttp('first-visit real geo', geo.status(), null)
  assert.equal(geo.status(), 200)
  assert.equal((await geo.json()).detected, false, 'Loopback geolocation must use its real non-China fallback')
  await page.waitForURL(url => url.pathname === '/en/login')
  const redirected = new URL(page.url())
  assert.equal(redirected.searchParams.get('callbackURL'), destination, 'Automatic locale switching must retain the login callback')
  assert.equal(redirected.hash, '#locale-smoke', 'Automatic locale switching must retain the hash')
  await page.getByRole('tab', { name: 'Password', exact: true }).waitFor()
  completed.push('fresh browser without locale preference → real loopback geo → automatic English login retains callback and hash')
  await context.close()
}

async function respectRateLimit(header) {
  // Better Auth's public handler currently sends X-Retry-After. Accept the
  // standard spelling too, but never turn a missing header into a zero delay.
  assert(typeof header === 'string' && /^\d+$/.test(header), 'Auth rate limiting must supply an explicit seconds header')
  const seconds = Number(header)
  assert(Number.isFinite(seconds) && seconds >= 0 && seconds <= 60, 'Expected a bounded real auth Retry-After header')
  httpDiagnostics.push({ operation: 'auth rate-limit wait', seconds })
  await new Promise(resolve => setTimeout(resolve, seconds * 1000 + 100))
}

const newCrag = { id: 'browser-created-crag', name: '浏览器新建岩场', cityId: 'luoyuan', location: '本地测试位置', description: '浏览器创建说明', approach: '本地测试接近路线' }
const fixtureCrag = (id, name, creator) => ({ _id: id, name, cityId: 'luoyuan', location: '本地', description: '隔离测试说明', approach: '隔离测试路线', createdBy: creator, coverImages: [], areas: ['A'] })

async function seed() {
  await db.collection('cities').insertOne({ _id: 'luoyuan', name: '罗源测试城市', shortName: '罗源', adcode: '350123', available: true, coordinates: { lng: 119.5, lat: 26.5 } })
  // Use the real password registration endpoint rather than forging hash/account
  // records. This auth configuration does not send verification mail on sign-up.
  for (const [name, account] of Object.entries(accounts)) {
    let response
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(`${pwaOrigin}/api/auth/sign-up/email`, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', Origin: pwaOrigin }, body: JSON.stringify(account) })
      if (response.status !== 429) break
      recordHttp('fixture password registration', response.status, null)
      await respectRateLimit(response.headers.get('retry-after') ?? response.headers.get('x-retry-after'))
    }
    const data = await response.json().catch(() => null)
    recordHttp('fixture password registration', response.status, data)
    assert.equal(response.status, 200, 'Fixture password registration must succeed')
    assert(ObjectId.isValid(data.user?.id), 'Fixture auth must return a real Mongo user ID')
    account.id = data.user.id
    if (['admin', 'controller'].includes(name)) {
      const result = await db.collection('user').updateOne({ _id: new ObjectId(account.id) }, { $set: { role: 'admin' } })
      assert.equal(result.matchedCount, 1, 'Only a fixture account may be promoted during setup')
    }
  }
  await db.collection('crags').insertMany([
    fixtureCrag('smoke-a', '权限岩场 A', accounts.controller.id), fixtureCrag('smoke-b', '权限岩场 B', accounts.controller.id),
  ])
  await db.collection('crag_permissions').insertOne({ _id: authOnly ? new ObjectId() : `crag-grant:${accounts.manager.id}:smoke-a`, userId: accounts.manager.id,
    cragId: 'smoke-a', role: 'manager', assignedBy: accounts.controller.id, createdAt: new Date() })
  await db.collection('routes').insertMany([
    { _id: 90001, name: 'Fixture route A', grade: 'V1', cragId: 'smoke-a', area: 'A', ...(!authOnly ? { topoVersion: 0 } : {}) },
    { _id: 90002, name: 'Fixture route B', grade: 'V2', cragId: 'smoke-b', area: 'A', ...(!authOnly ? { topoVersion: 0 } : {}) },
  ])
}

async function isolation(actor, pages) {
  const anonymous = actor === 'anonymous', admin = actor === 'admin', manager = actor === 'manager'
  const denied = anonymous ? 401 : 403
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index]
    const listing = await request(page, '/api/editor/crags')
    assert.equal(listing.status, anonymous ? 401 : 200, 'Editor listing auth boundary')
    if (!anonymous) {
      const ids = listing.data.crags.map(crag => crag.id)
      if (admin) { assert(ids.includes('smoke-a') && ids.includes('smoke-b')); assert.equal(listing.data.canCreate, true) }
      else { assert.deepEqual(ids, manager ? ['smoke-a'] : []); assert.equal(listing.data.canCreate, false) }
    }
    for (const [crag, route] of [['smoke-a', 90001], ['smoke-b', 90002]]) {
      const allowed = admin || manager && crag === 'smoke-a'
      assert.equal((await request(page, `/api/crags/${crag}`, 'PATCH', { description: `保存测试 ${actor} ${index}` })).status, allowed ? 200 : denied, 'Crag mutation scope')
      assert.equal((await request(page, `/api/routes/${route}`, 'PATCH', { description: `线路保存 ${actor} ${index}` })).status, allowed ? 200 : denied, 'Route mutation scope')
    }
    const permission = { userId: accounts.user.id, cragId: 'smoke-b', role: 'manager' }
    assert.equal((await request(page, '/api/crag-permissions?cragId=smoke-b')).status, admin ? 200 : denied, 'Permission list scope')
    assert.equal((await request(page, '/api/crag-permissions', 'POST', permission)).status, admin ? 201 : denied, 'Permission grant scope')
    assert.equal((await request(page, '/api/crag-permissions', 'DELETE', permission)).status, admin ? 200 : denied, 'Permission revoke scope')
    assert.equal((await request(page, '/api/auth/admin/set-role', 'POST', { userId: accounts.user.id, role: 'user' })).status, admin ? 200 : denied, 'Role administration scope')
    if (!admin) {
      assert.equal((await request(page, '/api/crags', 'POST', { ...newCrag, id: `denied-${actor}-${index}` })).status, denied, 'Crag creation scope')
      assert.equal((await request(page, '/api/faces', 'DELETE', { cragId: 'smoke-b', area: 'A', faceId: 'wall' })).status, denied, 'Forbidden face writes must stop before any R2 access')
    }
  }
  completed.push(`${actor}: PWA and Editor real API role/crag isolation`)
}

async function betaSubmission(context) {
  phase = 'password login and immediate Beta visibility'
  const page = await passwordLogin(context, accounts.user, `${pwaOrigin}/api/crags`)
  const url = `https://www.xiaohongshu.com/explore/${owner.slice(0, 24)}`
  const author = '浏览器即时 Beta'
  let reads = 0
  page.on('request', request => {
    const parsed = new URL(request.url())
    if (parsed.pathname === '/api/beta' && request.method() === 'GET' && parsed.searchParams.get('routeId') === '90001') reads++
  })
  await page.goto(`${pwaOrigin}/zh/route?crag=smoke-a`)
  const openDetail = async () => {
    const loaded = page.waitForResponse(response => {
      const parsed = new URL(response.url())
      return parsed.pathname === '/api/beta' && parsed.searchParams.get('routeId') === '90001' && response.request().method() === 'GET'
    })
    await page.getByRole('button', { name: /Fixture route A/ }).click()
    const response = await loaded
    assert.equal(response.status(), 200)
    assert((response.headers()['cache-control'] ?? '').includes('no-store'), 'Beta reads must be explicitly fresh')
    await page.getByRole('button', { name: /^Beta 视频/ }).waitFor()
  }
  const openList = () => page.getByRole('button', { name: /^Beta 视频/ }).click()
  const submit = async expectedStatus => {
    await page.getByRole('button', { name: '分享 Beta 视频', exact: true }).click()
    await page.getByPlaceholder('直接粘贴小红书分享内容...', { exact: true }).fill(url)
    await page.getByPlaceholder('你的昵称', { exact: true }).fill(author)
    const posted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/beta' && response.request().method() === 'POST')
    await page.getByRole('button', { name: '贡献 Beta', exact: true }).click()
    const response = await posted
    assert.equal(response.status(), expectedStatus, 'Real Beta POST result')
    return response.json()
  }
  const assertList = async () => {
    await expect(page.locator(`a[href="${url}"]`)).toBeVisible()
    await expect(page.getByText(`@${author}`, { exact: true })).toBeVisible()
    await expect(page.getByText('1 个视频', { exact: true }).last()).toBeVisible()
    await expect(page.locator(`a[href="${url}"]`)).toHaveCount(1)
  }
  await openDetail(); await openList()
  const beforeSubmission = reads
  const posted = await submit(201)
  assert.equal(posted.beta.noteId, owner.slice(0, 24)); assert.equal(posted.beta.author, author)
  await page.getByPlaceholder('直接粘贴小红书分享内容...', { exact: true }).waitFor({ state: 'hidden' })
  await openList(); await assertList()
  assert.equal(reads, beforeSubmission, 'The current Beta list must update from POST without a second GET or manual refresh')
  phase = 'duplicate Beta rejected with current list retained'
  assert.equal((await submit(409)).code, 'DUPLICATE_BETA')
  await page.getByText('该视频已被分享过啦～', { exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭', exact: true }).last().click()
  await page.getByPlaceholder('直接粘贴小红书分享内容...', { exact: true }).waitFor({ state: 'hidden' })
  await openList(); await assertList()
  // Close the list and route drawers, then actually reopen and reload the page.
  await page.getByRole('button', { name: '关闭', exact: true }).last().click()
  await page.getByText('Fixture route A 的 Beta', { exact: true }).waitFor({ state: 'hidden' })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^Beta 视频/ }).waitFor({ state: 'hidden' })
  await openDetail(); await openList(); await assertList()
  await page.reload()
  await openDetail(); await openList(); await assertList()
  const stored = await db.collection('routes').findOne({ _id: 90001 })
  assert.equal(stored.betaLinks.length, 1)
  if (!authOnly) assert.equal(stored.topoVersion, 0)
  completed.push('real PWA Beta submit → current list immediately visible without GET → duplicate 409 → drawer reopen and full reload retain exactly one record')
}

async function run(builds, uri, mongoPort) {
  phase = 'isolated replica set'
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 })
  await client.connect()
  const hello = await client.db('admin').command({ hello: 1 })
  assert.equal(hello.setName, 'bloctop-test'); assert.equal(hello.isWritablePrimary, true)
  db = client.db(databaseName)
  assert.equal((await db.listCollections({}, { nameOnly: true }).toArray()).length, 0, 'Refusing to reuse an existing database')
  await db.collection('__admin_session_smoke_owner').insertOne({ _id: owner, owner })
  databaseOwned = true
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'bloctop-admin-browser-'))
  const { guardPath, reportPath } = await writeNetworkGuard(mongoPort)
  phase = 'application startup'
  await startApplications(builds, uri, guardPath)
  phase = 'fixture accounts'
  await seed()
  browser = await chromium.launch({ headless: true })
  if (!authOnly) await firstVisitCallbackPreservation()
  const userContext = await newContext()
  await betaSubmission(userContext)

  phase = 'password login and Editor refresh'
  const adminContext = await newContext()
  const editorPage = await passwordLogin(adminContext, accounts.admin, `${editorOrigin}/`)
  await editorPage.getByRole('heading', { name: 'Topo 编辑器', exact: true }).waitFor()
  await editorPage.getByRole('link', { name: /用户管理/ }).waitFor()
  await editorPage.reload()
  await editorPage.getByRole('heading', { name: 'Topo 编辑器', exact: true }).waitFor()
  const sessionCookies = await adminContext.cookies()
  assert(sessionCookies.some(cookie => cookie.name.includes('session_token') && cookie.httpOnly && !cookie.secure), 'Local production builds must share an HTTP-only host cookie')
  assert(sessionCookies.every(cookie => !cookie.domain.includes('bouldering.top')), 'No production cookie domain is permitted')
  completed.push('real password UI login → shared-cookie Editor hub → full refresh')
  const adminApis = await Promise.all(origins.map(origin => apiPage(adminContext, origin)))
  const publicContext = await newContext()
  if (!authOnly) {
    phase = 'create crag in actual Editor form'
    await editorPage.goto(`${editorOrigin}/crags/new`)
    await editorPage.getByPlaceholder('如：袁通寺', { exact: true }).fill(newCrag.name)
    await editorPage.getByPlaceholder('如：yuan-tong-si（小写字母、数字、连字符）', { exact: true }).fill(newCrag.id)
    await editorPage.locator('select').selectOption(newCrag.cityId)
    await editorPage.getByPlaceholder('详细地址', { exact: true }).fill(newCrag.location)
    await editorPage.getByPlaceholder('岩场描述、特色、注意事项等', { exact: true }).fill(newCrag.description)
    await editorPage.getByPlaceholder('如何到达岩场，停车、步行路线等', { exact: true }).fill(newCrag.approach)
    const creation = editorPage.waitForResponse(response => new URL(response.url()).pathname === '/api/crags' && response.request().method() === 'POST')
    await editorPage.getByRole('button', { name: '创建岩场', exact: true }).click()
    const createdResponse = await creation
    assert.equal(createdResponse.status(), 201)
    const created = await createdResponse.json()
    assert.equal(created.crag.createdBy, accounts.admin.id); assert.equal(created.refreshPending, undefined)
    await editorPage.waitForURL(`${editorOrigin}/crags/${newCrag.id}`)
    await editorPage.getByRole('heading', { name: newCrag.name, exact: true }).waitFor()
    for (const page of adminApis) {
      const replay = await request(page, '/api/crags', 'POST', newCrag)
      assert.equal(replay.status, 200); assert.equal(replay.data.replayed, true)
    }
    assert.equal(await db.collection('crags').countDocuments({ _id: newCrag.id }), 1)
    assert.equal(await db.collection('crag_permissions').countDocuments({ userId: accounts.admin.id, cragId: newCrag.id }), 1)
    const grants = await request(adminApis[1], `/api/crag-permissions?cragId=${newCrag.id}`)
    assert.equal(grants.status, 200); assert(grants.data.permissions.some(grant => grant.userId === accounts.admin.id && grant.role === 'manager'))
    completed.push('real Editor form creation + creator grant + identical retry through both applications')

    phase = 'actual Editor save → fresh public PWA request'
    await editorPage.getByRole('button', { name: '编辑岩场信息', exact: true }).click()
    const savedName = '后台保存后公开可见'
    await editorPage.getByPlaceholder('岩场名称', { exact: true }).fill(savedName)
    const saved = editorPage.waitForResponse(response => new URL(response.url()).pathname === `/api/crags/${newCrag.id}` && response.request().method() === 'PATCH')
    await editorPage.getByRole('button', { name: '保存', exact: true }).click()
    const savedResponse = await saved
    assert.equal(savedResponse.status(), 200); assert.equal((await savedResponse.json()).refreshPending, undefined)
    await editorPage.getByRole('heading', { name: savedName, exact: true }).waitFor()
    const publicApi = await apiPage(publicContext, pwaOrigin)
    assert.equal((await request(publicApi, `/api/crags/${newCrag.id}`)).data.crag.name, savedName)
    const publicPage = await publicContext.newPage()
    await publicPage.goto(`${pwaOrigin}/zh/crag/${newCrag.id}`)
    await publicPage.getByRole('heading', { name: savedName, exact: true, level: 1 }).waitFor()
    completed.push('real Editor form save + awaited webhook + anonymous fresh PWA API and SSR page visibility')
  }

  phase = 'admin API isolation'
  await isolation('admin', adminApis)
  for (const name of ['manager', 'user']) {
    phase = `${name} password and API isolation`
    const context = name === 'user' ? userContext : await newContext()
    const loginPage = name === 'user' ? null : await passwordLogin(context, accounts[name], `${editorOrigin}/`)
    if (name === 'manager') {
      await loginPage.getByRole('heading', { name: 'Topo 编辑器', exact: true }).waitFor()
      await expect(loginPage.getByRole('link', { name: /用户管理/ })).toHaveCount(0)
      await loginPage.reload(); await loginPage.getByRole('heading', { name: 'Topo 编辑器', exact: true }).waitFor()
    }
    const pages = await Promise.all(origins.map(origin => apiPage(context, origin)))
    await isolation(name, pages)
    if (name === 'user') {
      const response = await context.request.get(`${editorOrigin}/`, { maxRedirects: 0 })
      assert.equal(response.status(), 307); assert.equal(response.headers().location, pwaOrigin)
    }
  }
  phase = 'anonymous API isolation'
  await isolation('anonymous', await Promise.all(origins.map(origin => apiPage(publicContext, origin))))

  phase = 'authoritative role downgrade with old cookie'
  const controllerContext = await newContext()
  await passwordLogin(controllerContext, accounts.controller, `${editorOrigin}/`)
  const controllerApi = await apiPage(controllerContext, editorOrigin)
  assert.equal((await request(controllerApi, '/api/auth/admin/set-role', 'POST', { userId: accounts.admin.id, role: 'user' })).status, 200)
  // The original browser and cookies remain in use. No logout/re-login occurs.
  for (const page of adminApis) {
    const current = await request(page, '/api/auth/get-session')
    assert.equal(current.status, 200); assert.equal(current.data.user.role, 'user')
    assert.equal((await request(page, '/api/auth/admin/set-role', 'POST', { userId: accounts.user.id, role: 'admin' })).status, 403)
    assert.equal((await request(page, '/api/crag-permissions', 'POST', { userId: accounts.user.id, cragId: 'smoke-b', role: 'manager' })).status, 403)
    assert.equal((await request(page, '/api/crags/smoke-b', 'PATCH', { name: 'Forbidden stale admin' })).status, 403)
    assert.equal((await request(page, '/api/routes/90002', 'PATCH', { name: 'Forbidden stale admin route' })).status, 403)
    assert.equal((await request(page, '/api/crags', 'POST', { ...newCrag, id: 'forbidden-stale-admin' })).status, 403)
  }
  completed.push('real role API downgrade: old cookie loses role administration, grants, creation and non-owned business writes in both apps')

  phase = 'actual PWA logout and revoked cookie replay'
  const profile = await adminContext.newPage()
  await profile.goto(`${pwaOrigin}/zh/profile`)
  await profile.getByRole('button', { name: new RegExp(accounts.admin.name) }).click()
  const editorLink = profile.getByRole('link', { name: '前往 Topo 编辑器', exact: true })
  if (authOnly) {
    // This mode creates no owned crag or grant for the demoted admin. Main's
    // permission contract therefore gives this account no Editor entry.
    await expect(editorLink).toHaveCount(0)
  } else await expect(editorLink).toHaveAttribute('href', editorOrigin)
  const signout = profile.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/sign-out' && response.request().method() === 'POST')
  await profile.getByRole('button', { name: '退出登录', exact: true }).click()
  assert.equal((await signout).status(), 200)
  for (const page of adminApis) assert.equal((await request(page, '/api/editor/crags')).status, 401)
  await editorPage.goto(`${editorOrigin}/`)
  await editorPage.waitForURL(url => url.origin === pwaOrigin && url.pathname === '/zh/login')
  const replayContext = await newContext()
  await replayContext.addCookies(sessionCookies)
  for (const origin of origins) assert.equal((await request(await apiPage(replayContext, origin), '/api/editor/crags')).status, 401)
  completed.push('real logout UI → both apps anonymous → Editor login redirect → revoked old-cookie replay denied')

  phase = 'safety assertions'
  const serverBlocks = await readFile(reportPath, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })
  assert.equal(serverBlocks, '', 'No server-side external connection may be attempted')
  assert.deepEqual(forbiddenBrowserRequests, [], 'No external navigation, auth, API or script request may be attempted')
  assert.deepEqual(browserErrors, [], 'Every uncaught browser page error fails acceptance')
  return { passed: true, mode: authOnly ? 'auth-only' : 'full', completed,
    skipped: authOnly ? ['new crag UI and creator grant', 'idempotent crag creation', 'Editor UI save and PWA publication'] : [],
    realBrowser: true, realMongo: true, applicationApiMocks: false,
    externalConnections: 0, blockedOptionalMediaAssets: blockedAssets.length, blockedWeatherRequests: blockedServices.length,
    imageAdaptation: { localPngResponses: adaptedImages.length, paths: [...new Set(adaptedImages)] },
    boundary: 'Local production builds, real password auth, Beta UI freshness and API policy; auth/business responses are never mocked. Explicit fixture route/cover image paths receive a locally generated PNG. Browser explicitly lacks Service Worker support. Passkey, email delivery, weather and R2 are not exercised; all other remote image/font/styles and local weather API requests are aborted.' }
}

try {
  const { uri, port } = testUri()
  const builds = await artifacts()
  if (process.argv.includes('--preflight')) {
    console.log(JSON.stringify({ preflight: true, mode: authOnly ? 'auth-only' : 'full', projectDirectory, ports: [4200, 4201], builds: builds.map(app => ({ name: app.name, buildId: app.buildId })),
      requiredBuildEnvironment: { NEXT_PUBLIC_PWA_URL: pwaOrigin, NEXT_PUBLIC_EDITOR_URL: editorOrigin, NEXT_PUBLIC_APP_URL: editorOrigin, NEXT_PUBLIC_AMAP_KEY: '' },
      databaseConnected: false, processesStarted: false, writesPerformed: false }))
  } else {
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143)) })
    const result = await run(builds, uri, port)
    await cleanup()
    console.log(JSON.stringify({ ...result, ownedDatabaseDropped: !databaseOwned, applicationProcessesStopped: true }))
  }
} catch (error) {
  // Playwright error messages can contain fill arguments. Do not print the
  // original error, browser body, server logs, account IDs, or credential data.
  const scriptLine = error.stack?.match(/admin-session-smoke\.mjs:(\d+):\d+/)?.[1]
  console.error(JSON.stringify({ passed: false, phase, scriptLine: scriptLine ? Number(scriptLine) : null, completed, browserErrors: browserErrors.length,
    forbiddenBrowserRequests: forbiddenBrowserRequests.length, childExitCodes: children.map(child => child.exitCode),
    httpDiagnostics, serverErrorNames: [...serverErrorNames], blockedServerConnections: await blockedServerConnections(),
    browserResponseFailures, browserPageFacts: await browserPageFacts() }))
  process.exitCode = 1
} finally {
  await cleanup()
}
