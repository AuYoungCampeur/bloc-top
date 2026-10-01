import { createBetaHandlers } from '@bloctop/shared/beta-api'
import { getDatabase } from '@bloctop/shared/mongodb'
import { requireAuth } from '@/lib/require-auth'
import { canEditCrag } from '@bloctop/shared/permissions'

const handlers = createBetaHandlers({ getDatabase, requireAuth, canEditCrag })

export const GET = handlers.GET
export const POST = handlers.POST
export const PATCH = handlers.PATCH
export const DELETE = handlers.DELETE
