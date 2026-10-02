import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    minWorkers: 1,
    maxWorkers: 2,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/lib/**/*.ts', 'src/components/**/*.tsx', 'src/hooks/**/*.ts'],
      exclude: [
        'src/test/**',
        '**/*.test.{ts,tsx}',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
