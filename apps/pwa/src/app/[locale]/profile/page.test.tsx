import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProfilePage from './page'

const auth = vi.hoisted(() => ({
  session: null as { user: { id: string; email: string; role: string; image: string }; session: { id: string } } | null,
  refetch: vi.fn(),
}))
vi.mock('@/lib/auth-client', () => ({ useSession: () => ({ data: auth.session, refetch: auth.refetch }) }))
vi.mock('@/components/app-tabbar', () => ({ AppTabbar: () => null }))
vi.mock('@/components/theme-switcher', () => ({ ThemeSwitcher: () => null }))
vi.mock('@/components/locale-switcher', () => ({ LocaleSegmented: () => null }))
vi.mock('@/components/offline-cache-manager', () => ({ OfflineCacheSection: () => null }))
vi.mock('@/components/author-drawer', () => ({ AuthorDrawer: () => null }))
vi.mock('@/components/user-avatar', () => ({ UserAvatar: ({ src }: { src: string }) => <span data-testid="avatar">{src}</span> }))
vi.mock('@/components/security-drawer', () => ({
  SecurityDrawer: ({ hasEditorAccess, onAvatarChange }: { hasEditorAccess: boolean; onAvatarChange: (url: string) => void }) => (
    <div>
      {hasEditorAccess && <a href="http://localhost:3001">后台入口</a>}
      <button onClick={() => onAvatarChange('uploaded-avatar')}>完成头像上传</button>
    </div>
  ),
}))
const login = (id: string, role = 'user', token = id) => {
  auth.session = { user: { id, role, email: `${id}@example.test`, image: `${id}-avatar` }, session: { id: token } }
}
const response = (allowed: boolean) => ({ ok: true, json: async () => ({ total: 0, crags: allowed ? [{ id: 'crag' }] : [] }) }) as Response

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  auth.session = null
  globalThis.fetch = vi.fn(async () => response(false))
})

describe('个人页后台入口及本地头像归属', () => {
  it('同为user的A→B立即隐藏入口，A迟到响应不能授权B', async () => {
    login('a')
    let resolveA!: (value: Response) => void
    vi.mocked(fetch).mockImplementation(input => String(input) === '/api/editor/crags'
      ? new Promise(resolve => { resolveA = resolve })
      : Promise.resolve(response(false)))
    const view = render(<ProfilePage />)
    const oldSignal = vi.mocked(fetch).mock.calls.find(call => call[0] === '/api/editor/crags')![1]!.signal!
    login('b')
    vi.mocked(fetch).mockImplementation(input => String(input) === '/api/editor/crags'
      ? Promise.resolve(response(false)) : Promise.resolve(response(false)))
    view.rerender(<ProfilePage />)
    expect(screen.queryByText('后台入口')).not.toBeInTheDocument()
    expect(oldSignal.aborted).toBe(true)
    await act(async () => resolveA(response(true)))
    expect(screen.queryByText('后台入口')).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/editor/crags', expect.objectContaining({ cache: 'no-store' }))
  })

  it.each(['empty', 'error', 'network'] as const)('admin降权后名单%s均不保留旧入口', async outcome => {
    login('a', 'admin')
    const view = render(<ProfilePage />)
    expect(screen.getByText('后台入口')).toBeInTheDocument()
    vi.mocked(fetch).mockImplementation(input => {
      if (String(input) !== '/api/editor/crags') return Promise.resolve(response(false))
      return outcome === 'network' ? Promise.reject(new Error('offline'))
        : Promise.resolve(outcome === 'empty' ? response(false) : { ok: false, json: async () => ({}) } as Response)
    })
    login('a')
    view.rerender(<ProfilePage />)
    expect(screen.queryByText('后台入口')).not.toBeInTheDocument()
    await act(async () => {})
    expect(screen.queryByText('后台入口')).not.toBeInTheDocument()
  })

  it('A→空名单B不沿用A入口和上传头像，退出后重新登录须重新验权', async () => {
    login('a')
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(response(true)))
    const view = render(<ProfilePage />)
    await screen.findByText('后台入口')
    act(() => screen.getByText('完成头像上传').click())
    expect(screen.getByTestId('avatar')).toHaveTextContent('uploaded-avatar')
    login('b')
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(response(false)))
    view.rerender(<ProfilePage />)
    expect(screen.queryByText('后台入口')).not.toBeInTheDocument()
    expect(screen.getByTestId('avatar')).toHaveTextContent('b-avatar')
    auth.session = null
    view.rerender(<ProfilePage />)
    login('a', 'user', 'new-a-session')
    view.rerender(<ProfilePage />)
    await waitFor(() => expect(screen.getByTestId('avatar')).toHaveTextContent('a-avatar'))
    expect(screen.queryByText('后台入口')).not.toBeInTheDocument()
  })
})
