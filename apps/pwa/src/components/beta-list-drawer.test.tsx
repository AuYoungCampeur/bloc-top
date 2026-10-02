/**
 * BetaListDrawer 组件测试
 * 测试 Beta 视频列表抽屉的渲染和交互
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor, act } from '@/test/utils'
import { BetaListDrawer } from './beta-list-drawer'
import type { BetaLink } from '@/types'

// Mock Beta 数据
const mockBetaLinks: BetaLink[] = [
  {
    id: 'beta-1',
    platform: 'xiaohongshu',
    noteId: 'abc123',
    url: 'https://xhslink.com/abc123',
    title: 'V5 月光攀爬记录',
    author: '攀岩爱好者',
    climberHeight: 175,
    climberReach: 180,
  },
  {
    id: 'beta-2',
    platform: 'xiaohongshu',
    noteId: 'def456',
    url: 'https://xhslink.com/def456',
    title: '月光线路分享',
    author: '户外达人',
  },
]

describe('BetaListDrawer', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    betaLinks: mockBetaLinks,
    routeName: '月光',
    routeId: 1,
    onAddBeta: vi.fn(),
    onRefresh: vi.fn().mockResolvedValue(true),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('渲染', () => {
    it('无 Beta 视频时应显示空状态', () => {
      render(
        <BetaListDrawer {...defaultProps} betaLinks={[]} />
      )

      expect(screen.getByText('noBeta')).toBeTruthy()
      expect(screen.getByText('beFirst')).toBeTruthy()
    })

    it('应该渲染 Beta 视频列表', () => {
      render(<BetaListDrawer {...defaultProps} />)

      expect(screen.getByText('V5 月光攀爬记录')).toBeTruthy()
      expect(screen.getByText('月光线路分享')).toBeTruthy()
    })

    it('应该显示作者信息', () => {
      render(<BetaListDrawer {...defaultProps} />)

      expect(screen.getByText('@攀岩爱好者')).toBeTruthy()
      expect(screen.getByText('@户外达人')).toBeTruthy()
    })

    it('应该显示攀岩者身高/臂长', () => {
      render(<BetaListDrawer {...defaultProps} />)

      // 第一个 Beta 有身高和臂长
      expect(screen.getByText(/175/)).toBeTruthy()
      expect(screen.getByText(/180/)).toBeTruthy()
    })

    it('无身高臂长时不应显示相关信息', () => {
      const betaWithoutBody = [{
        ...mockBetaLinks[0],
        climberHeight: undefined,
        climberReach: undefined,
      }]

      render(
        <BetaListDrawer {...defaultProps} betaLinks={betaWithoutBody} />
      )

      // 只有作者信息，没有身高臂长
      expect(screen.getByText('@攀岩爱好者')).toBeTruthy()
    })

    it('应该显示视频数量', () => {
      render(<BetaListDrawer {...defaultProps} />)

      // videoCount 翻译包含 {count} 参数，mock 会返回 "videoCount"
      // 检查列表区域存在
      expect(screen.getByText('V5 月光攀爬记录')).toBeTruthy()
    })
  })

  describe('分享 Beta 按钮', () => {
    it('有 onAddBeta 时应显示分享按钮', () => {
      render(<BetaListDrawer {...defaultProps} />)

      expect(screen.getByText('shareButton')).toBeTruthy()
    })

    it('点击分享按钮应调用 onAddBeta', () => {
      const onAddBeta = vi.fn()
      render(<BetaListDrawer {...defaultProps} onAddBeta={onAddBeta} />)

      fireEvent.click(screen.getByText('shareButton'))

      expect(onAddBeta).toHaveBeenCalled()
    })

    it('无 onAddBeta 时不应显示分享按钮', () => {
      render(
        <BetaListDrawer {...defaultProps} onAddBeta={undefined} />
      )

      expect(screen.queryByText('shareButton')).not.toBeTruthy()
    })
  })

  describe('复制链接', () => {
    it('链接与复制按钮是独立控件，键盘复制不会打开链接', async () => {
      const { user, container } = render(<BetaListDrawer {...defaultProps} />)
      const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
      const link = screen.getByRole('link', { name: /V5 月光攀爬记录/ })
      const copyButton = screen.getAllByRole('button', { name: 'copyLink' })[0]
      const linkClick = vi.fn()
      link.addEventListener('click', linkClick)

      expect(link).toHaveAttribute('href', mockBetaLinks[0].url)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(container.querySelector('button button, a button, button a')).toBeNull()
      link.focus()
      await user.tab()
      expect(copyButton).toHaveFocus()
      await user.keyboard('{Enter}')

      await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(mockBetaLinks[0].url))
      expect(linkClick).not.toHaveBeenCalled()
    })
  })

  describe('刷新功能', () => {
    it('应该显示刷新按钮', () => {
      render(<BetaListDrawer {...defaultProps} />)

      expect(screen.getByText('refresh')).toBeTruthy()
    })

    it('空列表也能刷新，并将刷新交给父组件', async () => {
      const onRefresh = vi.fn().mockResolvedValue(true)
      render(<BetaListDrawer {...defaultProps} betaLinks={[]} onRefresh={onRefresh} />)

      const refreshButton = screen.getByText('refresh').closest('button')
      expect((refreshButton as HTMLButtonElement).disabled).toBe(false)
      fireEvent.click(refreshButton!)
      await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce())
    })

    it.each(['false', 'throw'])('刷新 %s 时显示可重试错误并保留已有 Beta', async failure => {
      const onRefresh = failure === 'false'
        ? vi.fn().mockResolvedValue(false)
        : vi.fn().mockRejectedValue(new Error('offline'))
      const { user } = render(<BetaListDrawer {...defaultProps} onRefresh={onRefresh} />)

      await user.click(screen.getByRole('button', { name: 'refresh' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('refreshFailed')
      expect(screen.getByRole('link', { name: /V5 月光攀爬记录/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'retry' })).toBeEnabled()
      expect(onRefresh).toHaveBeenCalledOnce()
    })

    it.each(['false', 'throw'])('切换线路后不显示 A 的既有错误或迟到的 %s 失败', async failure => {
      let resolveRefresh!: (value: boolean) => void
      let rejectRefresh!: (reason: Error) => void
      const pendingRefresh = new Promise<boolean>((resolve, reject) => {
        resolveRefresh = resolve
        rejectRefresh = reject
      })
      const onRefreshA = vi.fn().mockResolvedValueOnce(false).mockReturnValueOnce(pendingRefresh)
      const onRefreshB = vi.fn().mockResolvedValue(true)
      const { user, rerender } = render(<BetaListDrawer {...defaultProps} onRefresh={onRefreshA} />)

      await user.click(screen.getByRole('button', { name: 'refresh' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('refreshFailed')
      await user.click(screen.getByRole('button', { name: 'retry' }))
      expect(screen.getByRole('button', { name: 'refreshing' })).toBeDisabled()

      rerender(<BetaListDrawer {...defaultProps} routeId={2} routeName="线路 B" betaLinks={[]} onRefresh={onRefreshB} />)
      expect(screen.getByText('noBeta')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()

      await act(async () => {
        if (failure === 'false') resolveRefresh(false)
        else rejectRefresh(new Error('A refresh failed late'))
      })

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'refresh' })).toBeEnabled()
      expect(screen.queryByRole('button', { name: 'retry' })).not.toBeInTheDocument()
      expect(onRefreshB).not.toHaveBeenCalled()
    })

    it('空列表刷新失败后可以重试，成功显示父组件的新列表并清除错误', async () => {
      const refreshResult = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
      function Parent() {
        const [betaLinks, setBetaLinks] = useState<BetaLink[]>([])
        const onRefresh = async () => {
          const success = await refreshResult()
          if (success) setBetaLinks(mockBetaLinks)
          return success
        }
        return <BetaListDrawer {...defaultProps} betaLinks={betaLinks} onRefresh={onRefresh} />
      }
      const { user } = render(<Parent />)

      await user.click(screen.getByRole('button', { name: 'refresh' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('refreshFailed')
      expect(screen.getByText('noBeta')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'retry' }))

      expect(await screen.findByRole('link', { name: /V5 月光攀爬记录/ })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /月光线路分享/ })).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByText('noBeta')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'refresh' })).toBeEnabled()
      expect(refreshResult).toHaveBeenCalledTimes(2)
    })
  })

  describe('抽屉状态', () => {
    it('isOpen=false 时不应渲染内容', () => {
      render(<BetaListDrawer {...defaultProps} isOpen={false} />)

      expect(screen.queryByText('V5 月光攀爬记录')).not.toBeTruthy()
    })
  })
})
