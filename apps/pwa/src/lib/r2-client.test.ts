import { beforeEach, describe, expect, it, vi } from 'vitest'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@aws-sdk/client-s3', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/client-s3')>('@aws-sdk/client-s3')
  return { ...actual, S3Client: class { send = send } }
})
import { getFaceObjectStore } from './r2-client'
import { CopyObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'

beforeEach(() => {
  send.mockReset()
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'isolated-account')
  vi.stubEnv('R2_ACCESS_KEY_ID', 'isolated-key')
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'isolated-secret')
  vi.stubEnv('R2_BUCKET_NAME', 'isolated-bucket')
})

describe('R2 transport conditions without network requests', () => {
  it('only a missing object means absence; permission and missing bucket errors propagate', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('Missing'), { name: 'NotFound' }))
    expect(await getFaceObjectStore().head('key')).toBeNull()
    send.mockRejectedValueOnce(Object.assign(new Error('Denied'), { name: 'AccessDenied' }))
    await expect(getFaceObjectStore().head('key')).rejects.toMatchObject({ name: 'AccessDenied' })
    send.mockRejectedValueOnce(Object.assign(new Error('Bucket missing'), { name: 'NoSuchBucket' }))
    await expect(getFaceObjectStore().head('key')).rejects.toMatchObject({ name: 'NoSuchBucket' })
  })
  it('HEAD returns the exact opaque ETag used by confirmation', async () => {
    send.mockResolvedValue({ ETag: '"version"', ContentType: 'image/png' })
    expect(await getFaceObjectStore().head('key')).toEqual({ etag: '"version"', contentType: 'image/png' })
  })
  it('copy sets destination absence header on the command and protects source ETag', async () => {
    send.mockImplementation(async (command: CopyObjectCommand) => {
      expect(command.input).toMatchObject({ CopySource: 'isolated-bucket/crag/%E5%8C%97%20%E5%8C%BA/%E5%B2%A9%E9%9D%A2.jpg', CopySourceIfMatch: '"old"', Key: 'target' })
      const resolve = command.middlewareStack.resolve(async args => {
        expect((args.request as { headers: Record<string, string> }).headers['cf-copy-destination-if-none-match']).toBe('*')
        return { response: {}, output: { $metadata: {} } }
      }, { clientName: 'test', commandName: 'CopyObjectCommand' })
      const argumentsWithRequest = { input: command.input, request: { headers: {} } }
      await resolve(argumentsWithRequest)
      return {}
    })
    await getFaceObjectStore().copy('crag/北 区/岩面.jpg', 'target', '"old"')
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('create and overwrite emit distinct conditions and actual ContentType', async () => {
    send.mockResolvedValue({})
    const store = getFaceObjectStore()
    await store.put('key', new Uint8Array([1]), { contentType: 'image/webp', ifNoneMatch: '*' })
    await store.put('key', new Uint8Array([2]), { contentType: 'image/png', ifMatch: 'old' })
    const first = send.mock.calls[0][0] as PutObjectCommand
    const second = send.mock.calls[1][0] as PutObjectCommand
    expect(first.input).toMatchObject({ IfNoneMatch: '*', ContentType: 'image/webp' })
    expect(second.input).toMatchObject({ IfMatch: 'old', ContentType: 'image/png' })
  })
  it('a server 412 maps to a visible 409 conflict', async () => {
    send.mockRejectedValue(Object.assign(new Error('Conflict'), { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } }))
    await expect(getFaceObjectStore().put('key', new Uint8Array([1]), { contentType: 'image/jpeg', ifNoneMatch: '*' })).rejects.toMatchObject({ status: 409, code: 'FACE_VERSION_CONFLICT' })
  })
  it('listing exposes continuation instead of losing later pages', async () => {
    send.mockResolvedValue({ Contents: [{ Key: 'key' }], IsTruncated: true, NextContinuationToken: 'next' })
    expect(await getFaceObjectStore().list('crag/', 'previous')).toEqual({ keys: ['key'], continuationToken: 'next' })
    expect(send.mock.calls[0][0].input).toMatchObject({ ContinuationToken: 'previous' })
  })
})
