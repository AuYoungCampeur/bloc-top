import { createFaceHandlers } from '@bloctop/shared/face-api'
import { getDatabase } from '@bloctop/shared/mongodb'
import { canEditCrag } from '@bloctop/shared/permissions'
import { requireAuth } from '@/lib/require-auth'
import { getFaceObjectStore } from '@/lib/r2-client'
import { revalidateCragPages } from '@/lib/revalidate-helpers'

const handlers = createFaceHandlers({ requireAuth, canEditCrag, getDatabase, getObjectStore: getFaceObjectStore, revalidateCragPages })
export const { GET, PATCH, DELETE } = handlers
