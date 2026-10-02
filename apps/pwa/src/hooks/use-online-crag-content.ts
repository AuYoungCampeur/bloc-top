'use client'

import { useEffect, useRef, useState } from 'react'
import { readFreshCragContent, type OnlineCragContent } from '@/lib/online-crag-content'

/** Only active reading views refresh. SSR and the first client render use the
 * same seed; offline download/reader data never goes through this hook.
 */
export function useOnlineCragContent(
  cragId: string | undefined,
  seed: OnlineCragContent | null = null,
  enabled = true,
  refreshKey: unknown = seed,
): OnlineCragContent | null {
  const [fresh, setFresh] = useState<{ cragId: string; refreshKey: unknown; content: OnlineCragContent } | null>(null)
  const previousView = useRef<{ cragId: string; refreshKey: unknown } | null>(null)
  useEffect(() => {
    if (!cragId || !enabled) return
    let active = true
    // A request that began before newer RSC props arrived must not overwrite them.
    let supersedePending = previousView.current?.cragId === cragId && previousView.current.refreshKey !== refreshKey
    previousView.current = { cragId, refreshKey }
    const refresh = () => {
      if (!navigator.onLine || document.visibilityState === 'hidden') return
      const operation = readFreshCragContent(cragId, supersedePending)
      supersedePending = false
      void operation.then(content => {
        if (active) setFresh({ cragId, refreshKey, content })
      }).catch(() => {
        // Keep the last complete reading packet on failure; focus/online retries it.
      })
    }
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      active = false
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [cragId, refreshKey, enabled])
  return fresh && fresh.cragId === cragId && fresh.refreshKey === refreshKey ? fresh.content : seed
}
