import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RouteDetailDrawer } from './route-detail-drawer'
import { FaceThumbnailStrip } from './face-thumbnail-strip'
import { readFreshCragContent, type OnlineCragContent } from '@/lib/online-crag-content'
import type { Crag, Route } from '@/types'

vi.mock('@/lib/online-crag-content', () => ({ readFreshCragContent: vi.fn() }))
vi.mock('@/components/topo-line-overlay', () => ({
  TopoLineOverlay: ({ points }: { points: unknown }) => <output data-testid="topo-points">{JSON.stringify(points)}</output>,
}))
const points = (x: number) => [{ x, y: 0.1 }, { x: 0.9, y: 0.8 }]
const crag: Crag = { id: 'online-a', name: 'A', cityId: 'fixture', location: '', developmentTime: '', description: '', approach: '', mediaRevision: 'one' }
const route: Route = { id: 1, cragId: crag.id, name: 'Legacy', grade: 'V3', area: 'display', topoLine: points(0.1), topoVersion: 1, description: 'Old Topo' }
beforeEach(() => {
  vi.mocked(readFreshCragContent).mockReset()
  vi.mocked(readFreshCragContent).mockReturnValue(new Promise(() => {}))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ success: true, betaLinks: [] }) })))
})

describe('coherent online image reading components', () => {
  it('detail resolves an old selected route by id, waits for the whole packet and new image before overlay', async () => {
    let resolve!: (packet: OnlineCragContent) => void
    vi.mocked(readFreshCragContent).mockReturnValue(new Promise(done => { resolve = done }))
    render(<RouteDetailDrawer isOpen route={route} crag={crag} onClose={() => {}} />)
    const oldImage = screen.getByAltText('Legacy')
    fireEvent.load(oldImage)
    expect(screen.getByTestId('topo-points').textContent).toBe(JSON.stringify(points(0.1)))
    expect(oldImage.getAttribute('src')).toContain('mr=one')
    const fresh = { crag: { ...crag, mediaRevision: 'two' }, routes: [{ ...route, topoLine: points(0.7), topoVersion: 2, description: 'New Topo' }] }
    await act(async () => resolve(fresh))
    expect(screen.getByText('New Topo')).toBeTruthy()
    const newImage = screen.getByAltText('Legacy')
    expect(newImage).not.toBe(oldImage)
    expect(newImage.getAttribute('src')).toContain('mr=two')
    expect(screen.queryByTestId('topo-points')).toBeNull()
    fireEvent.load(oldImage) // Old completion cannot mark the replacement loaded.
    expect(screen.queryByTestId('topo-points')).toBeNull()
    fireEvent.load(newImage)
    expect(screen.getByTestId('topo-points').textContent).toBe(JSON.stringify(points(0.7)))
  })

  it('a supplied complete packet updates every multi-angle URL without refetching partial drawer props', async () => {
    const multi = { ...route, name: 'Multi', topoAnnotations: [{ faceId: 'same', area: 'a', topoLine: points(0.1) }, { faceId: 'same', area: 'b', topoLine: points(0.2) }] }
    const initial = { crag, routes: [multi] }
    const { rerender } = render(<RouteDetailDrawer isOpen route={multi} crag={crag} readingContent={initial} onClose={() => {}} />)
    expect(readFreshCragContent).not.toHaveBeenCalled()
    const oldImages = screen.getAllByAltText('Multi')
    const fresh = { crag: { ...crag, mediaRevision: 'two' }, routes: [{ ...multi, topoAnnotations: multi.topoAnnotations.map(item => ({ ...item, topoLine: points(0.7) })) }] }
    rerender(<RouteDetailDrawer isOpen route={multi} crag={crag} readingContent={fresh} onClose={() => {}} />)
    const images = screen.getAllByAltText('Multi')
    expect(images).toHaveLength(2)
    images.forEach((image, index) => { expect(image).not.toBe(oldImages[index]); expect(image.getAttribute('src')).toContain('mr=two') })
    fireEvent.load(images[0])
    expect(screen.getByTestId('topo-points').textContent).toBe(JSON.stringify(points(0.7)))
  })

  it('new RSC route/crag props cannot be hidden indefinitely by a previous fetched packet', async () => {
    vi.mocked(readFreshCragContent).mockResolvedValueOnce({ crag: { ...crag, mediaRevision: 'two' }, routes: [{ ...route, description: 'Fetched two' }] })
    const { rerender } = render(<RouteDetailDrawer isOpen route={route} crag={crag} onClose={() => {}} />)
    await screen.findByText('Fetched two')
    rerender(<RouteDetailDrawer isOpen route={{ ...route, description: 'New SSR three' }} crag={{ ...crag, mediaRevision: 'three' }} onClose={() => {}} />)
    expect(screen.getByText('New SSR three')).toBeTruthy()
    expect(screen.getByAltText('Legacy').getAttribute('src')).toContain('mr=three')
    await waitFor(() => expect(readFreshCragContent).toHaveBeenCalledTimes(2))
  })

  it('a changed thumbnail revision hides old pixels and failed replacement stays unavailable', () => {
    const faces = [{ area: 'photos', faceId: 'single' }]
    const props = { faces, selectedCrag: crag.id, selectedFace: null, onFaceSelect: () => {} }
    const { rerender } = render(<FaceThumbnailStrip {...props} mediaRevision="one" />)
    const oldImage = screen.getByAltText('single')
    fireEvent.load(oldImage)
    expect(oldImage).not.toHaveClass('hidden')
    rerender(<FaceThumbnailStrip {...props} mediaRevision="two" />)
    const newImage = screen.getByAltText('single')
    expect(newImage).not.toBe(oldImage)
    expect(newImage).toHaveClass('hidden')
    fireEvent.error(newImage)
    expect(newImage).toHaveClass('hidden')
    expect(newImage.getAttribute('src')).toContain('mr=two')
  })
})
