import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { revalidateCragPages, revalidateHomePage } from './revalidate-helpers'
import { revalidatePath } from 'next/cache'

describe('revalidate-helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('revalidateCragPages calls revalidatePath for all locales', () => {
    revalidateCragPages('yuan-tong-si')
    expect(revalidatePath).toHaveBeenCalledTimes(9)
    expect(revalidatePath).toHaveBeenCalledWith('/zh/crag/yuan-tong-si')
    expect(revalidatePath).toHaveBeenCalledWith('/en/crag/yuan-tong-si')
    expect(revalidatePath).toHaveBeenCalledWith('/fr/crag/yuan-tong-si')
    expect(revalidatePath).toHaveBeenCalledWith('/zh')
    expect(revalidatePath).toHaveBeenCalledWith('/en')
    expect(revalidatePath).toHaveBeenCalledWith('/fr')
    expect(revalidatePath).toHaveBeenCalledWith('/zh/route')
    expect(revalidatePath).toHaveBeenCalledWith('/en/route')
    expect(revalidatePath).toHaveBeenCalledWith('/fr/route')
  })

  it('revalidateHomePage calls revalidatePath for all locale home pages', () => {
    revalidateHomePage()
    expect(revalidatePath).toHaveBeenCalledTimes(3)
    expect(revalidatePath).toHaveBeenCalledWith('/zh')
    expect(revalidatePath).toHaveBeenCalledWith('/en')
    expect(revalidatePath).toHaveBeenCalledWith('/fr')
  })
})
