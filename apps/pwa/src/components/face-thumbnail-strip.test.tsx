import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FaceThumbnailStrip } from './face-thumbnail-strip'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
const faces = [{ faceId: 'same', area: 'area-a' }, { faceId: 'same', area: 'area-b' }]

describe('public face thumbnails', () => {
  beforeEach(() => vi.clearAllMocks())
  it('shows anonymous public references without calling the protected management API', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const select = vi.fn()
    render(<FaceThumbnailStrip faces={faces} selectedCrag="crag-a" selectedFace={null} onFaceSelect={select} />)
    fireEvent.click(screen.getByRole('button', { name: 'area-b · same' }))
    expect(select).toHaveBeenCalledWith('crag-a/area-b/same')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
  it('keeps same-named areas distinct when selected and deselecting', () => {
    const select = vi.fn()
    render(<FaceThumbnailStrip faces={faces} selectedCrag="crag-a" selectedFace="crag-a/area-b/same" onFaceSelect={select} />)
    expect(screen.getByRole('button', { name: 'area-b · same' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'area-a · same' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'area-b · same' }))
    expect(select).toHaveBeenCalledWith(null)
  })
  it('renders no pending skeleton for an empty public reference list', () => {
    const { container } = render(<FaceThumbnailStrip faces={[]} selectedCrag="crag-a" selectedFace={null} onFaceSelect={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('keeps all routes selectable when there is only one referenced face', () => {
    const select = vi.fn()
    render(<FaceThumbnailStrip faces={[faces[0]]} selectedCrag="crag-a" selectedFace={null} onFaceSelect={select} />)
    expect(select).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'all' }))
    expect(select).toHaveBeenCalledWith(null)
  })
  it('switches a controlled area through one parent update, preserving URL atomicity', () => {
    const select = vi.fn(), changeArea = vi.fn()
    render(<FaceThumbnailStrip faces={faces} selectedCrag="crag-a" selectedFace="crag-a/area-a/same" onFaceSelect={select} selectedArea="area-a" onAreaChange={changeArea} />)
    fireEvent.click(screen.getByRole('button', { name: 'area-b' }))
    expect(changeArea).toHaveBeenCalledWith('area-b')
    expect(select).not.toHaveBeenCalled()
  })
})
