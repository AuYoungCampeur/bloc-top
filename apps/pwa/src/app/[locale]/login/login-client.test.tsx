import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@/test/utils'
import LoginClient from './login-client'

const mocks = vi.hoisted(() => ({
  magicLink: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signIn: {
      magicLink: mocks.magicLink,
      email: vi.fn(),
      passkey: vi.fn(),
    },
  },
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))

describe('LoginClient callback updates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.magicLink.mockResolvedValue({ error: null })
  })

  it('sends the current callback after a prop change without changing the entered email', async () => {
    const { user, rerender } = render(<LoginClient callbackURL="/zh/profile" />)
    await user.type(screen.getByPlaceholderText('emailPlaceholder'), 'review@example.test')

    // Keep email and hook dependencies stable so an old callback closure cannot be hidden.
    rerender(<LoginClient callbackURL="http://localhost:3001/crags" />)
    expect(screen.getByPlaceholderText('emailPlaceholder')).toHaveValue('review@example.test')
    await user.click(screen.getByRole('button', { name: 'sendMagicLink' }))

    await waitFor(() => expect(mocks.magicLink).toHaveBeenCalledExactlyOnceWith({
      email: 'review@example.test',
      callbackURL: 'http://localhost:3001/crags',
    }))
    expect(screen.getByText('magicLinkSent')).toBeInTheDocument()
  })
})
