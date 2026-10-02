import { defineConfig } from 'vitest/config'

// Explicit opt-in only. The ordinary test:run glob never loads this suite.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/publishing.mongo-integration.ts'],
    minWorkers: 1,
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: { NODE_ENV: 'test' },
  },
})
