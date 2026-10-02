import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RouteListClient from '@/app/[locale]/route/route-client'
import { SearchDrawer } from './search-drawer'
import { readFreshCragContent, type OnlineCragContent } from '@/lib/online-crag-content'
import type { Crag, Route } from '@/types'

vi.mock('@/lib/online-crag-content', () => ({ readFreshCragContent: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams('crag=selection-a'),
}))
vi.mock('@/components/app-tabbar', () => ({ AppTabbar: () => null }))
vi.mock('@/components/floating-search-input', () => ({ FloatingSearchInput: () => null }))
vi.mock('@/components/grade-range-selector-vertical', () => ({ GradeRangeSelectorVertical: () => null }))
vi.mock('@/components/route-list-item', () => ({
  RouteListItem: ({ route, onClick }: { route: Route; onClick: (route: Route) => void }) => <button onClick={() => onClick(route)}>Select {route.name}</button>,
}))
vi.mock('@/components/route-detail-drawer', () => ({
  RouteDetailDrawer: ({ route, crag, isOpen }: { route: Route | null; crag: Crag | null; isOpen: boolean }) => isOpen && route
    ? <output data-testid="selection">{route.topoVersion}:{crag?.mediaRevision}</output> : null,
}))
const crag: Crag = { id: 'selection-a', name: 'A', cityId: 'fixture', location: '', developmentTime: '', description: '', approach: '', mediaRevision: 'one' }
const route: Route = { id: 1, cragId: crag.id, name: 'Selected', grade: 'V3', area: 'photos', faceId: 'face', topoVersion: 1 }
beforeEach(() => { vi.mocked(readFreshCragContent).mockReset(); vi.mocked(readFreshCragContent).mockReturnValue(new Promise(() => {})) })

describe('selected route identity restoration', () => {
  it('list selection and thumbnails advance together; new RSC props replace old fetched data', async () => {
    let resolve!: (packet: OnlineCragContent) => void
    vi.mocked(readFreshCragContent).mockReturnValueOnce(new Promise(done => { resolve = done }))
    const { rerender } = render(<RouteListClient crags={[crag]} routes={[route]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select Selected' }))
    expect(screen.getByTestId('selection')).toHaveTextContent('1:one')
    const fresh = { crag: { ...crag, mediaRevision: 'two' }, routes: [{ ...route, topoVersion: 2 }] }
    await act(async () => resolve(fresh))
    expect(screen.getByTestId('selection')).toHaveTextContent('2:two')
    expect(screen.getByAltText('face').getAttribute('src')).toContain('mr=two')
    rerender(<RouteListClient crags={[{ ...crag, mediaRevision: 'three' }]} routes={[{ ...route, topoVersion: 3 }]} />)
    expect(screen.getByTestId('selection')).toHaveTextContent('3:three')
    expect(screen.getByAltText('face').getAttribute('src')).toContain('mr=three')
  })

  it('Search selection uses the current complete parent routes rather than its clicked object', () => {
    const props = { isOpen: true, onClose: () => {}, searchQuery: 'Selected', onSearchChange: () => {}, results: [route], crags: [crag], allRoutes: [route] }
    const { rerender } = render(<SearchDrawer {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select Selected' }))
    expect(screen.getByTestId('selection')).toHaveTextContent('1:one')
    const next = { ...route, topoVersion: 2 }
    rerender(<SearchDrawer {...props} allRoutes={[next]} results={[next]} crags={[{ ...crag, mediaRevision: 'two' }]} />)
    expect(screen.getByTestId('selection')).toHaveTextContent('2:two')
    rerender(<SearchDrawer {...props} allRoutes={[]} results={[]} />)
    expect(screen.queryByTestId('selection')).toBeNull()
  })
})
