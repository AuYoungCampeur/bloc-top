import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    minWorkers: 1,
    maxWorkers: 2,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
