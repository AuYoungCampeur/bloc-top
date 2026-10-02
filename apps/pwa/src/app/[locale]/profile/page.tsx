'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Settings, User, Users, LogIn, Mountain, Info, ChevronRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { AppTabbar } from '@/components/app-tabbar'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { LocaleSegmented } from '@/components/locale-switcher'
import { OfflineCacheSection } from '@/components/offline-cache-manager'
import { SecurityDrawer } from '@/components/security-drawer'
import { AuthorDrawer } from '@/components/author-drawer'
import { useSession } from '@/lib/auth-client'
import { UserAvatar } from '@/components/user-avatar'

// 访问统计缓存 key
const VISITS_CACHE_KEY = 'total_visits_cache'

export default function ProfilePage() {
  const t = useTranslations('Profile')
  const tAuth = useTranslations('Auth')
  const tIntro = useTranslations('Intro')

  // Auth state — extract refetch to sync session after avatar upload
  const sessionHook = useSession()
  const session = sessionHook.data
  const isLoggedIn = !!session
  const userId = session?.user.id
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin'

  // Avatar local state (overrides session until next refresh)
  const [localAvatar, setLocalAvatar] = useState<{ userId: string; url: string | null } | null>(null)
  const avatarUrl = localAvatar && localAvatar.userId === userId
    ? localAvatar.url
    : (session?.user as { image?: string | null } | undefined)?.image ?? null

  // Keep refetch in a ref so the callback stays stable
  const sessionRefetchRef = useRef<((params?: { query?: Record<string, unknown> }) => Promise<void>) | undefined>(undefined)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, react-hooks/refs -- ref assignment must run every render to track latest refetch; not a rendering dependency
  sessionRefetchRef.current = (sessionHook as any).refetch

  const handleAvatarChange = useCallback((url: string | null) => {
    if (!userId) return
    setLocalAvatar({ userId, url })
    // Force useSession() atom to refetch from DB, bypassing cookie cache
    sessionRefetchRef.current?.({ query: { disableCookieCache: true } })
  }, [userId])

  // Editor access check — fetch /api/editor/crags when logged in
  const [editorAccess, setEditorAccess] = useState<{ userId: string; allowed: boolean } | null>(null)
  const accessContext = `${session?.session.id ?? ''}:${userId ?? ''}:${isAdmin}`
  const [previousAccessContext, setPreviousAccessContext] = useState(accessContext)
  if (previousAccessContext !== accessContext) {
    setPreviousAccessContext(accessContext)
    setEditorAccess(null)
    setLocalAvatar(null)
  }
  const hasEditorAccess = isLoggedIn && (isAdmin || Boolean(editorAccess?.userId === userId && editorAccess?.allowed))
  useEffect(() => {
    if (!userId || isAdmin) return
    const controller = new AbortController()
    fetch('/api/editor/crags', { cache: 'no-store', signal: controller.signal })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!controller.signal.aborted) {
          setEditorAccess({ userId, allowed: Boolean(data?.crags?.length) })
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setEditorAccess({ userId, allowed: false })
      })
    return () => controller.abort()
  }, [userId, isAdmin, accessContext])

  // Drawer states
  const [securityDrawerOpen, setSecurityDrawerOpen] = useState(false)
  const [authorDrawerOpen, setAuthorDrawerOpen] = useState(false)

  // Visit stats
  const [totalVisits, setTotalVisits] = useState<number | null>(null)

  useEffect(() => {
    const cached = localStorage.getItem(VISITS_CACHE_KEY)
    if (cached) setTotalVisits(parseInt(cached, 10))

    fetch('/api/visit')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) {
          setTotalVisits(data.total)
          localStorage.setItem(VISITS_CACHE_KEY, String(data.total))
        }
      })
      .catch(() => {})
  }, [])

  return (
    <>
      <div
        className="flex flex-col h-dvh overflow-hidden"
        style={{
          backgroundColor: 'var(--theme-surface)',
          transition: 'var(--theme-transition)',
        }}
      >
        {/* Header */}
        <header className="flex-shrink-0 pt-12 px-4 pb-6">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--theme-on-surface)' }}>
            {t('title')}
          </h1>
        </header>

        <main className="flex-1 overflow-y-auto px-4 pb-24">
          {/* === Profile Hero === */}
          <div className="mb-6">
            {isLoggedIn ? (
              <button
                onClick={() => setSecurityDrawerOpen(true)}
                className="glass w-full flex items-center gap-4 p-4 transition-all active:scale-[0.98]"
                style={{ borderRadius: 'var(--theme-radius-xl)' }}
              >
                <UserAvatar
                  src={avatarUrl}
                  email={session.user.email}
                  size={48}
                />
                <div className="flex-1 text-left">
                  <p className="text-base font-medium" style={{ color: 'var(--theme-on-surface)' }}>
                    {(session.user as { name?: string }).name || session.user.email}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--theme-on-surface-variant)' }}>
                    {(session.user as { name?: string }).name ? session.user.email : t('accountSecurityHint')}
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 shrink-0" style={{ color: 'var(--theme-on-surface-variant)' }} />
              </button>
            ) : (
              <Link
                href="/login"
                className="glass w-full flex items-center gap-4 p-4 transition-all active:scale-[0.98]"
                style={{ borderRadius: 'var(--theme-radius-xl)' }}
              >
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--theme-primary) 15%, var(--theme-surface))' }}
                >
                  <LogIn className="w-6 h-6" style={{ color: 'var(--theme-primary)' }} />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-base font-medium" style={{ color: 'var(--theme-on-surface)' }}>
                    {tAuth('loginOrRegister')}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--theme-on-surface-variant)' }}>
                    {tAuth('firstTimeHint')}
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 shrink-0" style={{ color: 'var(--theme-on-surface-variant)' }} />
              </Link>
            )}
          </div>

          {/* === Preferences === */}
          <div className="flex items-center gap-2 mb-3">
            <Settings className="w-4 h-4" style={{ color: 'var(--theme-primary)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--theme-on-surface)' }}>
              {t('preferences')}
            </span>
          </div>
          <div
            className="glass mb-6"
            style={{ borderRadius: 'var(--theme-radius-xl)' }}
          >
            <div className="p-4">
              <ThemeSwitcher />
            </div>
            <div className="mx-4" style={{ borderBottom: '1px solid var(--glass-border)' }} />
            <div className="p-4">
              <LocaleSegmented />
            </div>
          </div>

          {/* === Data & Storage === */}
          <OfflineCacheSection />

          {/* === About === */}
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-4 h-4" style={{ color: 'var(--theme-primary)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--theme-on-surface)' }}>
              {t('about')}
            </span>
          </div>
          <div
            className="glass mb-6"
            style={{ borderRadius: 'var(--theme-radius-xl)' }}
          >
            {/* App intro */}
            <Link
              href="/intro"
              className="w-full flex items-center gap-4 p-4 transition-all active:scale-[0.98]"
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ backgroundColor: 'color-mix(in srgb, var(--theme-primary) 15%, var(--theme-surface))' }}
              >
                <Mountain className="w-5 h-5" style={{ color: 'var(--theme-primary)' }} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium" style={{ color: 'var(--theme-on-surface)' }}>
                  {tIntro('profileEntry')}
                </p>
                <p className="text-xs" style={{ color: 'var(--theme-on-surface-variant)' }}>
                  {tIntro('profileEntryHint')}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--theme-on-surface-variant)' }} />
            </Link>

            <div className="mx-4" style={{ borderBottom: '1px solid var(--glass-border)' }} />

            {/* Author */}
            <button
              onClick={() => setAuthorDrawerOpen(true)}
              className="w-full flex items-center gap-4 p-4 transition-all active:scale-[0.98]"
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ backgroundColor: 'color-mix(in srgb, var(--theme-primary) 15%, var(--theme-surface))' }}
              >
                <User className="w-5 h-5" style={{ color: 'var(--theme-primary)' }} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium" style={{ color: 'var(--theme-on-surface)' }}>
                  {t('author')}
                </p>
                <p className="text-xs" style={{ color: 'var(--theme-on-surface-variant)' }}>
                  {t('authorHint')}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--theme-on-surface-variant)' }} />
            </button>

            <div className="mx-4" style={{ borderBottom: '1px solid var(--glass-border)' }} />

            {/* Visit stats */}
            <div className="flex items-center gap-4 p-4">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ backgroundColor: 'color-mix(in srgb, var(--theme-success) 15%, var(--theme-surface))' }}
              >
                <Users className="w-5 h-5" style={{ color: 'var(--theme-success)' }} />
              </div>
              <div className="flex-1">
                <p className="text-sm" style={{ color: 'var(--theme-on-surface-variant)' }}>
                  {t('totalVisits')}
                </p>
              </div>
              <div className="text-right">
                {totalVisits !== null ? (
                  <p className="text-lg font-bold" style={{ color: 'var(--theme-on-surface)' }}>
                    {totalVisits.toLocaleString()}
                    <span className="text-xs font-normal ml-1" style={{ color: 'var(--theme-on-surface-variant)' }}>{t('visits')}</span>
                  </p>
                ) : (
                  <span
                    className="inline-block w-12 h-5 rounded skeleton-shimmer"
                    style={{ backgroundColor: 'var(--theme-surface-variant)' }}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Version */}
          <div className="mt-4 text-center">
            <p className="text-xs" style={{ color: 'var(--theme-on-surface-variant)' }}>
              {t('version')}
            </p>
          </div>
        </main>

      </div>

      <AppTabbar />

      {/* Security Drawer */}
      {isLoggedIn && session && (
        <SecurityDrawer
          isOpen={securityDrawerOpen}
          onClose={() => setSecurityDrawerOpen(false)}
          session={{
            user: {
              email: session.user.email,
              role: (session.user as { role?: string }).role,
              image: avatarUrl,
              name: (session.user as { name?: string }).name,
              height: (session.user as { height?: number }).height,
              reach: (session.user as { reach?: number }).reach,
            },
          }}
          isAdmin={isAdmin}
          hasEditorAccess={hasEditorAccess}
          onAvatarChange={handleAvatarChange}
        />
      )}

      {/* Author Drawer */}
      <AuthorDrawer
        isOpen={authorDrawerOpen}
        onClose={() => setAuthorDrawerOpen(false)}
      />
    </>
  )
}
