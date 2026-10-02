import { getCragCoverUrl } from '@/lib/constants'
import { withMediaRevision } from '@bloctop/ui/face-image/media-revision'
import type { Crag } from '@/types'

export function getCragCoverImages(crag: Crag): string[] {
  const match = crag.coverImages?.[0]?.match(/[?&]t=(\d+)/)
  const timestamp = match ? Number(match[1]) : undefined
  return Array.from({ length: Math.max(crag.coverImages?.length ?? 0, 1) }, (_, index) =>
    withMediaRevision(getCragCoverUrl(crag.id, index, timestamp), crag.mediaRevision))
}
