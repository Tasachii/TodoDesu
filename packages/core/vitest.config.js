import { defineConfig } from 'vitest/config'

// Tiny pure module — no excuse not to be exhaustive.
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**'],
      thresholds: { lines: 100, functions: 100, branches: 95, statements: 100 },
    },
  },
})
