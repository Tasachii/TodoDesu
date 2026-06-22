import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Non-root base for static hosts that serve under a subpath
  // (e.g. GitHub Pages: VITE_BASE=/todoo/). Defaults to root.
  base: process.env.VITE_BASE || '/',
  // vitest collects only unit tests — e2e/ belongs to Playwright.
  // Vite/Vitest transform JSX in-memory, so we test the source (src/**),
  // never the dist build.
  test: {
    include: ['test/**/*.test.{js,jsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Gate the testable logic — hooks, the data engine, and lib helpers.
      // Presentational JSX (views/components) ships behind the Playwright e2e
      // smoke suite rather than unit tests, so it isn't part of the coverage
      // surface; the icon and entry modules have nothing to assert.
      include: ['src/hooks/**', 'src/api/**', 'src/lib/**'],
      exclude: ['src/main.jsx', 'src/**/icons.jsx'],
      // Critical engine code is gated hard; the small per-directory floors are
      // a touch below the per-file numbers to leave room for branch noise.
      thresholds: {
        lines: 85,
        functions: 80,
        branches: 85,
        statements: 85,
        'src/hooks/**': { lines: 85, functions: 80, branches: 85, statements: 85 },
        'src/api/**': { lines: 85, functions: 80, branches: 85, statements: 85 },
        'src/lib/**': { lines: 85, functions: 75, branches: 80, statements: 85 },
      },
    },
  },
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    proxy: {
      '/api': 'http://127.0.0.1:4521',
    },
  },
})
