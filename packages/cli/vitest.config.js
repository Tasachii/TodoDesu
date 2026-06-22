import { defineConfig } from 'vitest/config'

// CLI is plain ESM with no build step — coverage runs against src/**.
// bin/todo.js is the executable shebang wrapper (one line: program.parse).
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**'],
      exclude: ['bin/todo.js'],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
})
