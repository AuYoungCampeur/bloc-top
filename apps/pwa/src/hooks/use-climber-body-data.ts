'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession, authClient } from '@/lib/auth-client'

export interface ClimberBodyData {
  height: string
  reach: string
}

const EMPTY: ClimberBodyData = { height: '', reach: '' }

// The old global key has unknown ownership. Leave it untouched and never
// migrate it into an account. New anonymous inputs stay anonymous.
function storageKey(userId?: string) {
  return userId ? `climber-body-data:user:${userId}` : 'climber-body-data:anonymous'
}

function load(key: string): ClimberBodyData {
  try {
    const cached = JSON.parse(localStorage.getItem(key) || '{}')
    return {
      height: typeof cached?.height === 'string' ? cached.height : '',
      reach: typeof cached?.reach === 'string' ? cached.reach : '',
    }
  } catch (error) {
    console.warn('[useClimberBodyData] Failed to load cached data:', error)
    return EMPTY
  }
}

export function useClimberBodyData() {
  const { data: session } = useSession()
  const userId = session?.user?.id
  const sessionId = session?.session?.id
  const scope = `${userId ?? 'anonymous'}:${sessionId ?? ''}`
  const key = storageKey(userId)
  const user = session?.user as { height?: number; reach?: number } | undefined
  const dbHeight = user?.height?.toString() ?? ''
  const dbReach = user?.reach?.toString() ?? ''
  const [cache, setCache] = useState<{ scope: string; data: ClimberBodyData } | null>(null)
  const currentScope = useRef<string | null>(scope)
  const bodyData = cache?.scope === scope ? cache.data : EMPTY

  useEffect(() => {
    currentScope.current = scope
    async function hydrate() {
      const stored = load(key)
      const data = { height: dbHeight || stored.height, reach: dbReach || stored.reach }
      setCache({ scope, data })
      // Only an identified account's own data is cached in its namespace.
      // Hydration never writes cached values back to Better Auth.
      try { localStorage.setItem(key, JSON.stringify(data)) } catch {}
    }
    hydrate()
    return () => { currentScope.current = null }
  }, [scope, key, dbHeight, dbReach])

  const updateBodyData = useCallback((input: Partial<ClimberBodyData>) => {
    // A Beta submission may complete after logout or an account switch. Its
    // captured callback must not mutate the newly authenticated user's profile.
    if (currentScope.current !== scope) return
    setCache(previous => {
      const data = previous?.scope === scope ? previous.data : EMPTY
      const updated = {
        height: input.height?.trim() || data.height,
        reach: input.reach?.trim() || data.reach,
      }
      try { localStorage.setItem(key, JSON.stringify(updated)) } catch (error) {
        console.warn('[useClimberBodyData] Failed to save data:', error)
      }
      return { scope, data: updated }
    })
    if (userId && sessionId) {
      const update: Record<string, number> = {}
      const height = Number.parseFloat(input.height?.trim() ?? '')
      const reach = Number.parseFloat(input.reach?.trim() ?? '')
      if (Number.isFinite(height) && height > 0) update.height = height
      if (Number.isFinite(reach) && reach > 0) update.reach = reach
      if (Object.keys(update).length) {
        // Explicit current-user input only, never an automatic legacy migration.
        authClient.updateUser(update).catch(() => {})
      }
    }
  }, [scope, key, userId, sessionId])

  const clearBodyData = useCallback(() => {
    if (currentScope.current !== scope) return
    setCache({ scope, data: EMPTY })
    try { localStorage.removeItem(key) } catch (error) {
      console.warn('[useClimberBodyData] Failed to clear data:', error)
    }
  }, [scope, key])

  return { bodyData, updateBodyData, clearBodyData }
}
