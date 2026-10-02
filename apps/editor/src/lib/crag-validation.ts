import type { Coordinates } from '@bloctop/shared/types'

export const CRAG_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isValidCoordinates(value: unknown): value is Coordinates {
  return isRecord(value)
    && typeof value.lng === 'number' && Number.isFinite(value.lng) && Math.abs(value.lng) <= 180
    && typeof value.lat === 'number' && Number.isFinite(value.lat) && Math.abs(value.lat) <= 90
}

/** Validate at the API boundary as well as in the form; no coercion of objects. */
export function validateCragInput(body: unknown, mode: 'create' | 'patch') {
  const fields: Record<string, unknown> = {}
  const errors: Record<string, string> = {}
  if (!isRecord(body)) return { fields, errors: { form: '请求内容必须是对象' } }

  const textFields = {
    name: ['名称', 200], cityId: ['城市', 100], location: ['位置', 1000],
    description: ['描述', 10000], approach: ['接近路线', 10000],
  } as const
  for (const [key, [label, maxLength]] of Object.entries(textFields)) {
    if (mode === 'patch' && !(key in body)) continue
    const value = body[key]
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
      errors[key] = `${label}必须是非空文本，最多 ${maxLength} 字符`
    } else {
      fields[key] = value.trim()
    }
  }

  if (mode === 'create') {
    if (typeof body.id !== 'string' || body.id.length > 100 || !CRAG_ID_PATTERN.test(body.id)) {
      errors.id = 'ID 仅支持小写字母、数字和单个连字符，最长 100 字符'
    } else fields.id = body.id
  } else if ('id' in body || 'createdBy' in body) {
    errors.id = '不能修改岩场 ID 或创建者'
  }

  if ('coordinates' in body) {
    if (body.coordinates === null) {
      if (mode === 'patch') fields.coordinates = null
    } else if (!isValidCoordinates(body.coordinates)) {
      errors.coordinates = '坐标必须包含有效的经度和纬度'
    } else fields.coordinates = { lng: body.coordinates.lng, lat: body.coordinates.lat }
  }

  if (mode === 'patch' && 'coverImages' in body) {
    if (!Array.isArray(body.coverImages) || body.coverImages.length > 20 || body.coverImages.some(value => {
      if (typeof value !== 'string') return true
      try { return !['https:', 'http:'].includes(new URL(value).protocol) } catch { return true }
    })) errors.coverImages = '封面必须是最多 20 个有效图片 URL'
    else fields.coverImages = body.coverImages
  }

  if (mode === 'patch' && Object.keys(fields).length === 0 && Object.keys(errors).length === 0) {
    errors.form = '没有可更新的字段'
  }
  return { fields, errors }
}
