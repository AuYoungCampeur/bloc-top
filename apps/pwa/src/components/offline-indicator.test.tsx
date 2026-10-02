import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OfflineIndicator from './offline-indicator'
vi.mock('@/components/offline-download-provider', () => ({ useOfflineDownloadContextSafe: () => ({ offlineCrags: [{ cragId: 'fixture/id', cragName: '离线岩场', routeCount: 3 }] }) }))
beforeEach(() => { Object.defineProperty(navigator, 'onLine', { value: false, configurable: true }) })
describe('offline indicator navigation', () => {
  it('opens the cached offline shell with a native document link and an encoded crag parameter', async () => {
    render(<OfflineIndicator />)
    await userEvent.setup().click(screen.getByRole('button', { name: /message/ }))
    const link = screen.getByRole('link', { name: /离线岩场/ })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/zh/offline?offlineCrag=fixture%2Fid')
    expect(screen.queryByRole('button', { name: /离线岩场/ })).toBeNull()
  })
})
