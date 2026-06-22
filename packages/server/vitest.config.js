import { defineConfig } from 'vitest/config'

// Server is plain ESM with no build step — coverage is measured against the
// source in src/**, never a dist. index.js is the process bootstrap (listen +
// console banner) and is excluded from the gate.
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**'],
      exclude: ['src/index.js'],
      thresholds: { lines: 90, functions: 90, branches: 80, statements: 90 },
    },
  },
})
