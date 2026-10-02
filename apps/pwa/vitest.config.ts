import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // Three workspace suites run together, including in the parallel push hook.
    maxWorkers: 2,
    minWorkers: 1,
    // 单元测试使用 node 环境，组件测试使用 jsdom
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // 组件测试需要的 setup
    setupFiles: ['./src/test/setup.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'json-summary'],
      include: ['src/lib/**/*.ts', 'src/components/**/*.tsx', 'src/hooks/**/*.ts'],
      exclude: [
        'src/lib/mongodb.ts',
        'src/lib/db/**',
        'src/test/**',
        '**/*.test.{ts,tsx}',
      ],
      // CI 环境下的阈值检查（可选）
      // thresholds: {
      //   statements: 60,
      //   branches: 60,
      //   functions: 60,
      //   lines: 60,
      // },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
