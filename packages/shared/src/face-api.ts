import { NextRequest, NextResponse } from 'next/server'
import type { Db, Document } from 'mongodb'
import type { AuthInfo } from './require-auth'
import type { UserRole } from './types'
import { createModuleLogger } from './logger'
import { getFaceIdentityKey } from './face-references'
import { createFaceManagement, FaceOperationError, parseFaceIdentity, validateStorageSegment, type FaceObjectStore } from './face-management'

interface Dependencies {
  requireAuth(request: NextRequest): Promise<AuthInfo | NextResponse>
  canEditCrag(userId: string, cragId: string, role: UserRole): Promise<boolean>
  getDatabase(): Promise<Db>
  getObjectStore(): FaceObjectStore
  revalidateCragPages(cragId: string): void | Promise<void | { ok: boolean }>
}
const log = createModuleLogger('API:Faces')
const noStore = { 'Cache-Control': 'no-store, max-age=0' }
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: noStore })

async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json()
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>
  } catch { /* invalid JSON */ }
  throw new FaceOperationError(400, 'INVALID_BODY', '请求数据格式无效')
}

export function createFaceHandlers(deps: Dependencies) {
  const management = createFaceManagement(deps)
  async function authorize(cragId: string, auth: AuthInfo) {
    if (!(await deps.canEditCrag(auth.userId, cragId, auth.role))) throw new FaceOperationError(403, 'FORBIDDEN', '无权编辑此岩场')
    const db = await deps.getDatabase()
    const crag = await db.collection('crags').findOne({ _id: cragId as unknown as Document['_id'] }, { projection: { _id: 1 } })
    if (!crag) throw new FaceOperationError(404, 'CRAG_NOT_FOUND', '岩场不存在')
  }
  async function notify(cragId: string) {
    try {
      const result = await deps.revalidateCragPages(cragId)
      return !result || result.ok !== false
    } catch (error) {
      log.error('Face refresh failed', error, { metadata: { cragId } })
      return false
    }
  }
  function failure(error: unknown) {
    if (error instanceof FaceOperationError) return json({ success: false, error: error.message, code: error.code, ...error.details }, error.status)
    log.error('Face operation failed', error)
    return json({ success: false, error: '图片服务暂时不可用，请刷新后重试', code: 'FACE_STORAGE_FAILED' }, 503)
  }
  const authenticate = deps.requireAuth

  return {
    async GET(request: NextRequest) {
      const auth = await authenticate(request)
      if (auth instanceof NextResponse) return auth
      try {
        const cragId = validateStorageSegment(request.nextUrl.searchParams.get('cragId'), 'cragId')
        await authorize(cragId, auth)
        return json({ success: true, faces: await management.list(cragId) })
      } catch (error) { return failure(error) }
    },
    async PATCH(request: NextRequest) {
      const auth = await authenticate(request)
      if (auth instanceof NextResponse) return auth
      let cragId: string | undefined
      try {
        const body = await readBody(request)
        const face = parseFaceIdentity({ ...body, faceId: body.oldFaceId })
        cragId = face.cragId
        const newFaceId = validateStorageSegment(body.newFaceId, 'newFaceId')
        if (!/^[\u4e00-\u9fffa-z0-9-]+$/.test(newFaceId) || newFaceId === face.faceId) throw new FaceOperationError(400, 'INVALID_FACE_NAME', '新名称无效或与原名称相同')
        await authorize(face.cragId, auth)
        const result = await management.rename(face, newFaceId)
        const refreshed = await notify(face.cragId)
        return json({ ...result, ...(!refreshed ? { refreshPending: true } : {}) })
      } catch (error) {
        if (cragId && error instanceof FaceOperationError && error.details.partial) await notify(cragId)
        return failure(error)
      }
    },
    async DELETE(request: NextRequest) {
      const auth = await authenticate(request)
      if (auth instanceof NextResponse) return auth
      let cragId: string | undefined
      try {
        const face = parseFaceIdentity(await readBody(request))
        cragId = face.cragId
        await authorize(face.cragId, auth)
        const result = await management.remove(face)
        const refreshed = await notify(face.cragId)
        return json({ ...result, ...(!refreshed ? { refreshPending: true } : {}) })
      } catch (error) {
        if (cragId && error instanceof FaceOperationError && error.details.partial) await notify(cragId)
        return failure(error)
      }
    },
    async POST(request: NextRequest) {
      const auth = await authenticate(request)
      if (auth instanceof NextResponse) return auth
      let cragId: string | undefined
      try {
        let form: FormData
        try { form = await request.formData() }
        catch { throw new FaceOperationError(400, 'INVALID_BODY', '上传数据格式无效') }
        cragId = validateStorageSegment(form.get('cragId'), 'cragId')
        const hasFace = form.has('faceId') || form.has('area')
        const face = hasFace ? parseFaceIdentity({ cragId, faceId: form.get('faceId'), area: form.get('area') }) : undefined
        const key = face ? `${getFaceIdentityKey(face)}.jpg` : `${cragId}/${validateStorageSegment(form.get('routeName'), 'routeName')}.jpg`
        await authorize(cragId, auth)
        if (form.get('checkOnly') === 'true') {
          const object = await management.check(key)
          return json({ success: true, exists: object !== null, key, ...(object ? { etag: object.etag } : {}) })
        }
        const file = form.get('file')
        if (!(file instanceof File) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
          throw new FaceOperationError(400, 'INVALID_FILE', '请上传 5MB 以内的 JPG/PNG/WebP 图片')
        }
        const expectedEtag = form.get('expectedEtag')
        if (expectedEtag !== null && typeof expectedEtag !== 'string') throw new FaceOperationError(400, 'INVALID_ETAG', '图片版本格式无效')
        const result = await management.upload({ key, cragId, face, body: new Uint8Array(await file.arrayBuffer()),
          contentType: file.type, clearTopo: form.get('clearTopoLines') === 'true', overwrite: form.get('overwrite') === 'true', expectedEtag: expectedEtag ?? undefined })
        const refreshed = await notify(cragId)
        const encodedKey = key.split('/').map(encodeURIComponent).join('/')
        return json({ ...result, ...(!refreshed ? { refreshPending: true } : {}), url: `https://img.bouldering.top/${encodedKey}?t=${Date.now()}`, message: '图片上传成功' })
      } catch (error) {
        if (cragId && error instanceof FaceOperationError && error.details.partial) await notify(cragId)
        return failure(error)
      }
    },
  }
}
