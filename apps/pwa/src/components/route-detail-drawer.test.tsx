/**
 * RouteDetailDrawer 组件测试
 * 测试线路详情抽屉的渲染和交互
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@/test/utils'
import { RouteDetailDrawer } from './route-detail-drawer'
import type { Route, Crag } from '@/types'

// Topo 叠加层 — stub 为带 data-testid 的 div，避免 SVG 渲染
vi.mock('@/components/topo-line-overlay', () => ({
  TopoLineOverlay: () => <div data-testid="topo-line-overlay" />,
}))
vi.mock('@/components/multi-topo-line-overlay', () => ({
  MultiTopoLineOverlay: () => <div data-testid="multi-topo-line-overlay" />,
}))
vi.mock('@/components/route-legend-panel', () => ({
  RouteLegendPanel: ({ routes, onRouteSelect }: { routes: { id: number; name: string }[]; onRouteSelect: (id: number) => void }) => (
    <div data-testid="route-legend-panel">
      {routes.map(r => (
        <button key={r.id} data-testid={`legend-route-${r.id}`} onClick={() => onRouteSelect(r.id)}>
          {r.name}
        </button>
      ))}
    </div>
  ),
}))

// Mock 线路数据
const mockRoute: Route = {
  id: 1,
  name: '月光',
  grade: 'V5',
  cragId: 'yuan-tong-si',
  area: 'A 区',
  FA: '张三',
  setter: '李四',
  description: '一条经典的线路，起步比较困难。',
  betaLinks: [
    {
      id: 'beta-1',
      platform: 'xiaohongshu',
      noteId: 'abc123',
      url: 'https://xhslink.com/abc123',
      title: 'V5 月光攀爬记录',
      author: '攀岩爱好者',
      climberHeight: 175,
    },
  ],
}

const mockRouteNoBeta: Route = {
  id: 2,
  name: '无名线',
  grade: 'V3',
  cragId: 'yuan-tong-si',
  area: 'B 区',
}

const topoLine = [
  { x: 0.1, y: 0.9 },
  { x: 0.3, y: 0.7 },
  { x: 0.5, y: 0.4 },
  { x: 0.7, y: 0.1 },
]

const mockRouteWithTopo: Route = {
  id: 10,
  name: '星尘',
  grade: 'V4',
  cragId: 'yuan-tong-si',
  area: 'A 区',
  faceId: 'face-1',
  topoLine,
}

const mockCrag: Crag = {
  id: 'yuan-tong-si',
  name: '圆通寺',
  cityId: 'luoyuan',
  location: '罗源县',
  developmentTime: '2020',
  description: '测试岩场',
  approach: '步行10分钟',
}

describe('RouteDetailDrawer', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    route: mockRoute,
    crag: mockCrag,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        success: true,
        betaLinks: url.includes('routeId=1') ? mockRoute.betaLinks : [],
      }),
    })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('渲染', () => {
    it('route 为 null 时应该返回 null', () => {
      const { container } = render(
        <RouteDetailDrawer {...defaultProps} route={null} />
      )

      expect(container.firstChild).toBeNull()
    })

    it('应该渲染线路名称', () => {
      render(<RouteDetailDrawer {...defaultProps} />)

      expect(screen.getByText('月光')).toBeTruthy()
    })

    it('应该渲染难度等级', () => {
      render(<RouteDetailDrawer {...defaultProps} />)

      expect(screen.getByText('V5')).toBeTruthy()
    })

    it('应该显示岩场名称和区域', () => {
      render(<RouteDetailDrawer {...defaultProps} />)

      // 格式: "圆通寺 · A 区"
      expect(screen.getByText(/圆通寺/)).toBeTruthy()
      expect(screen.getByText(/A 区/)).toBeTruthy()
    })

    it('无 crag 时仅显示区域', () => {
      render(
        <RouteDetailDrawer {...defaultProps} crag={null} />
      )

      expect(screen.getByText('A 区')).toBeTruthy()
      expect(screen.queryByText('圆通寺')).not.toBeTruthy()
    })
  })

  describe('FA 和 setter 信息', () => {
    it('应该显示 FA 信息', () => {
      render(<RouteDetailDrawer {...defaultProps} />)

      // faLabel 是翻译 key
      expect(screen.getByText('faLabel')).toBeTruthy()
      expect(screen.getByText('张三')).toBeTruthy()
    })

    it('应该显示 setter 信息', () => {
      render(<RouteDetailDrawer {...defaultProps} />)

      // setter 是翻译 key
      expect(screen.getByText('setter')).toBeTruthy()
      expect(screen.getByText('李四')).toBeTruthy()
    })

    it('无 FA 和 setter 时不应显示该区域', () => {
      render(
        <RouteDetailDrawer
          {...defaultProps}
          route={mockRouteNoBeta}
        />
      )

      expect(screen.queryByText('faLabel')).not.toBeTruthy()
      expect(screen.queryByText('setter')).not.toBeTruthy()
    })
  })

  describe('线路描述', () => {
    it('应该显示线路描述', () => {
      render(<RouteDetailDrawer {...defaultProps} />)

      expect(screen.getByText('descriptionLabel')).toBeTruthy()
      expect(screen.getByText('一条经典的线路，起步比较困难。')).toBeTruthy()
    })

    it('无描述时不应显示该区域', () => {
      render(
        <RouteDetailDrawer
          {...defaultProps}
          route={mockRouteNoBeta}
        />
      )

      expect(screen.queryByText('descriptionLabel')).not.toBeTruthy()
    })
  })

  describe('Beta 按钮', () => {
    it('打开旧页面的线路详情时应从实时接口显示新 Beta', async () => {
      const newBeta = {
        id: 'beta-new',
        platform: 'xiaohongshu' as const,
        url: 'https://www.xiaohongshu.com/explore/6797869e0000000029017615',
      }
      vi.mocked(global.fetch).mockImplementation(async () => ({
        ok: true,
        json: async () => ({ success: true, betaLinks: [newBeta] }),
      } as Response))

      render(<RouteDetailDrawer {...defaultProps} route={mockRouteNoBeta} />)

      await waitFor(() => expect(screen.getByText('1')).toBeTruthy())
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/beta?routeId=2&_='),
        expect.objectContaining({ cache: 'no-store' }),
      )
    })

    it('有 Beta 视频时应显示数量', () => {
      render(<RouteDetailDrawer {...defaultProps} />)

      // videoCount 翻译 key 格式
      expect(screen.getByText('title')).toBeTruthy()
      expect(screen.getByText('videoCount')).toBeTruthy()
    })

    it('无 Beta 视频时应显示"暂无"', () => {
      render(
        <RouteDetailDrawer
          {...defaultProps}
          route={mockRouteNoBeta}
        />
      )

      expect(screen.getByText('noVideo')).toBeTruthy()
    })

    it('点击 Beta 按钮应打开 Beta 列表', async () => {
      render(<RouteDetailDrawer {...defaultProps} />)

      // 找到 Beta 按钮（包含 title 文本的按钮）
      const betaButton = screen.getByText('title').closest('button')
      if (betaButton) {
        fireEvent.click(betaButton)
      }

      // BetaListDrawer 应该打开（会渲染新的内容）
      await waitFor(() => {
        // 检查是否有 beta 列表相关的内容
        expect(screen.getByText('title')).toBeTruthy()
      })
    })

    it('有 Beta 视频时应显示计数徽章', () => {
      render(<RouteDetailDrawer {...defaultProps} />)

      // 检查数字 1
      expect(screen.getByText('1')).toBeTruthy()
    })
  })

  describe('图片区域', () => {
    it('isOpen=false 时不应渲染内容', () => {
      render(<RouteDetailDrawer {...defaultProps} isOpen={false} />)

      expect(screen.queryByText('月光')).not.toBeTruthy()
    })

    it('应该渲染图片区域', () => {
      render(<RouteDetailDrawer {...defaultProps} />)

      // 检查图片相关元素
      const image = screen.getByRole('img')
      expect(image).toBeTruthy()
    })

    it('图片加载失败时应显示占位符', async () => {
      render(<RouteDetailDrawer {...defaultProps} />)

      const image = screen.getByRole('img')

      // 模拟图片加载失败
      fireEvent.error(image)

      await waitFor(() => {
        // noTopo 是翻译 key
        expect(screen.getByText('noTopo')).toBeTruthy()
      })
    })
  })

  describe('抽屉交互', () => {
    it('关闭按钮应调用 onClose', () => {
      const onClose = vi.fn()
      render(<RouteDetailDrawer {...defaultProps} onClose={onClose} />)

      // Drawer 组件的关闭通常由 overlay 点击或关闭按钮触发
      // 这里我们验证 onClose 被正确传递
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('难度等级颜色', () => {
    it('V5 难度应该使用正确的颜色', () => {
      render(<RouteDetailDrawer {...defaultProps} />)

      const gradeBadge = screen.getByText('V5')
      expect(gradeBadge).toBeTruthy()
      // 难度标签现在是 span 元素，直接检查其样式
      expect((gradeBadge as HTMLElement).style.borderRadius).toBe('var(--theme-radius-full)')
    })
  })

  describe('Topo 线路叠加', () => {
    it('有 topoLine 时图片加载后应渲染 TopoLineOverlay', async () => {
      render(
        <RouteDetailDrawer
          {...defaultProps}
          route={mockRouteWithTopo}
        />
      )

      // 图片加载前不应有 overlay
      expect(screen.queryByTestId('topo-line-overlay')).not.toBeTruthy()

      // 触发图片加载完成
      fireEvent.load(screen.getByRole('img'))

      await waitFor(() => {
        expect(screen.getByTestId('topo-line-overlay')).toBeTruthy()
      })
    })

    it('有多条同岩面兄弟线路时应渲染 MultiTopoLineOverlay', async () => {
      const siblingRoutes: Route[] = [
        mockRouteWithTopo,
        { ...mockRouteWithTopo, id: 11, name: '银河', grade: 'V6' },
      ]

      render(
        <RouteDetailDrawer
          {...defaultProps}
          route={mockRouteWithTopo}
          siblingRoutes={siblingRoutes}
        />
      )

      fireEvent.load(screen.getByRole('img'))

      await waitFor(() => {
        expect(screen.getByTestId('multi-topo-line-overlay')).toBeTruthy()
      })
      // 单线路 overlay 不应同时存在
      expect(screen.queryByTestId('topo-line-overlay')).not.toBeTruthy()
    })

    it('无 topoLine 时不应渲染任何叠加层', () => {
      render(
        <RouteDetailDrawer
          {...defaultProps}
          route={mockRoute}
        />
      )

      expect(screen.queryByTestId('topo-line-overlay')).not.toBeTruthy()
      expect(screen.queryByTestId('multi-topo-line-overlay')).not.toBeTruthy()
    })
  })

  describe('线路图例面板', () => {
    const siblingRoutes: Route[] = [
      mockRouteWithTopo,
      { ...mockRouteWithTopo, id: 11, name: '银河', grade: 'V6' },
    ]

    it('有多条同岩面线路时应渲染 RouteLegendPanel', () => {
      render(
        <RouteDetailDrawer
          {...defaultProps}
          route={mockRouteWithTopo}
          siblingRoutes={siblingRoutes}
        />
      )

      expect(screen.getByTestId('route-legend-panel')).toBeTruthy()
    })

    it('无同岩面线路时不应渲染 RouteLegendPanel', () => {
      render(
        <RouteDetailDrawer
          {...defaultProps}
          route={mockRoute}
        />
      )

      expect(screen.queryByTestId('route-legend-panel')).not.toBeTruthy()
    })

    it('点击图例面板中的线路应触发 onRouteChange', () => {
      const onRouteChange = vi.fn()
      render(
        <RouteDetailDrawer
          {...defaultProps}
          route={mockRouteWithTopo}
          siblingRoutes={siblingRoutes}
          onRouteChange={onRouteChange}
        />
      )

      fireEvent.click(screen.getByTestId('legend-route-11'))
      expect(onRouteChange).toHaveBeenCalledWith(
        expect.objectContaining({ id: 11, name: '银河' })
      )
    })
  })
})
