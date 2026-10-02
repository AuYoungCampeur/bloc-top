import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const connect = vi.fn()
  const close = vi.fn()
  const created = vi.fn()
  class Client {
    constructor() { created(this) }
    connect() { return connect(this) }
    close() { return close(this) }
    db(name: string) { return { name } }
  }
  return { connect, close, created, Client }
})
vi.mock('mongodb', () => ({ MongoClient: mocks.Client }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.connect.mockReset().mockImplementation(async client => client)
  mocks.close.mockReset().mockResolvedValue(undefined)
  delete global._mongoClientPromise
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('MONGODB_URI', 'mongodb://fixture.invalid')
  vi.stubEnv('MONGODB_DB_NAME', 'fixture')
})
afterEach(() => {
  delete global._mongoClientPromise
  vi.unstubAllEnvs()
})

describe('lazy Mongo connection recovery', () => {
  it('shares one successful connection across concurrent production requests', async () => {
    const { getClientPromise } = await import('./mongodb')
    const first = getClientPromise()
    expect(getClientPromise()).toBe(first)
    await first
    expect(getClientPromise()).toBe(first)
    expect(mocks.created).toHaveBeenCalledOnce()
  })

  it.each(['production', 'development'])('can reconnect after the first %s connection fails', async mode => {
    vi.stubEnv('NODE_ENV', mode)
    const failure = new Error('connection temporarily unavailable')
    mocks.connect.mockRejectedValueOnce(failure)
    const { getClientPromise, getDatabase } = await import('./mongodb')
    await expect(getClientPromise()).rejects.toBe(failure)
    expect(mocks.close).toHaveBeenCalledOnce()
    expect(await getDatabase()).toEqual({ name: 'fixture' })
    expect(mocks.created).toHaveBeenCalledTimes(2)
  })

  it('does not clear a newer development connection when an older one fails', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    let reject!: (reason: Error) => void
    mocks.connect.mockImplementationOnce(() => new Promise((_, rejectPromise) => { reject = rejectPromise }))
    const { getClientPromise } = await import('./mongodb')
    const old = getClientPromise()
    const newer = Promise.resolve({} as Awaited<ReturnType<typeof getClientPromise>>)
    global._mongoClientPromise = newer
    const assertion = expect(old).rejects.toThrow('old connection failed')
    reject(new Error('old connection failed'))
    await assertion
    expect(getClientPromise()).toBe(newer)
  })

  it('keeps the original error when closing the failed client also fails', async () => {
    mocks.connect.mockRejectedValueOnce(new Error('connect failed'))
    mocks.close.mockRejectedValueOnce(new Error('close failed'))
    const { getClientPromise } = await import('./mongodb')
    await expect(getClientPromise()).rejects.toThrow('connect failed')
    await expect(getClientPromise()).resolves.toBeDefined()
  })

  it('validates configuration before opening a connection', async () => {
    vi.stubEnv('MONGODB_URI', '')
    const { getClientPromise } = await import('./mongodb')
    expect(() => getClientPromise()).toThrow('MONGODB_URI')
    expect(mocks.created).not.toHaveBeenCalled()
  })
})
