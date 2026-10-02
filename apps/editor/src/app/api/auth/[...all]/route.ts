import { getAuth } from '@/lib/auth'
import { createAuthRouteHandlers } from '@bloctop/shared/auth-route'

export const { GET, POST } = createAuthRouteHandlers(getAuth, 'Editor Auth')
