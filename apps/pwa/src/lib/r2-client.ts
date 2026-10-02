import { S3Client, HeadObjectCommand, ListObjectsV2Command, CopyObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { FaceOperationError, type FaceObjectStore } from '@bloctop/shared/face-management'

/**
 * Cloudflare R2 客户端 — 懒加载单例
 *
 * 从 api/upload 和 api/faces 提取的共享初始化逻辑。
 * 使用 S3 兼容 API 连接 R2，环境变量首次调用时校验。
 */
let s3Client: S3Client | null = null

export function getS3Client(): S3Client {
  if (!s3Client) {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
    const accessKeyId = process.env.R2_ACCESS_KEY_ID
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY

    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error('Missing R2 configuration')
    }

    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    })
  }
  return s3Client
}

/**
 * 获取 R2 bucket 名称，缺失时抛出错误
 */
export function getBucketName(): string {
  const bucketName = process.env.R2_BUCKET_NAME
  if (!bucketName) {
    throw new Error('Missing R2_BUCKET_NAME')
  }
  return bucketName
}

/** Object transport; domain sequencing and reference updates live in shared. */
export function getFaceObjectStore(): FaceObjectStore {
  const send = async (operation: () => Promise<unknown>) => {
    try { return await operation() }
    catch (error) {
      if (error && typeof error === 'object' && ('name' in error) &&
          (error.name === 'PreconditionFailed' || ('$metadata' in error && (error.$metadata as { httpStatusCode?: number })?.httpStatusCode === 412))) {
        throw new FaceOperationError(409, 'FACE_VERSION_CONFLICT', '图片已变化或目标已存在，请刷新后重试')
      }
      throw error
    }
  }
  return {
    async head(key) {
      try {
        const result = await getS3Client().send(new HeadObjectCommand({ Bucket: getBucketName(), Key: key }))
        if (!result.ETag) throw new Error('R2 returned an object without an ETag')
        return { etag: result.ETag, contentType: result.ContentType }
      } catch (error) {
        if (error && typeof error === 'object' && 'name' in error &&
            (error.name === 'NotFound' || error.name === 'NoSuchKey')) return null
        throw error
      }
    },
    async list(prefix, continuationToken) {
      const result = await getS3Client().send(new ListObjectsV2Command({ Bucket: getBucketName(), Prefix: prefix, ContinuationToken: continuationToken }))
      return { keys: (result.Contents ?? []).flatMap(o => o.Key ? [o.Key] : []), continuationToken: result.IsTruncated ? result.NextContinuationToken : undefined }
    },
    async copy(source, destination, sourceEtag) {
      const command = new CopyObjectCommand({ Bucket: getBucketName(), Key: destination,
        CopySource: `${getBucketName()}/${source.split('/').map(encodeURIComponent).join('/')}`, CopySourceIfMatch: sourceEtag })
      // R2 destination condition is a custom extension, not CopySourceIfNoneMatch.
      command.middlewareStack.add(next => async args => {
        const request = args.request as { headers?: Record<string, string> }
        if (request.headers) request.headers['cf-copy-destination-if-none-match'] = '*'
        return next(args)
      }, { step: 'build', name: 'faceDestinationCondition' })
      await send(() => getS3Client().send(command))
    },
    async put(key, body, options) {
      await send(() => getS3Client().send(new PutObjectCommand({ Bucket: getBucketName(), Key: key, Body: body,
        ContentType: options.contentType, IfMatch: options.ifMatch, IfNoneMatch: options.ifNoneMatch })))
    },
    async delete(key) { await send(() => getS3Client().send(new DeleteObjectCommand({ Bucket: getBucketName(), Key: key }))) },
  }
}
