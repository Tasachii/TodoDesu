import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom ships no matchMedia — provide a minimal, mutable stub so theme code
// (and anything reading prefers-color-scheme) can run and be asserted.
if (!window.matchMedia) {
  window.matchMedia = vi.fn((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

// Unmount React trees and clear jsdom between tests so renders don't leak.
afterEach(() => {
  cleanup()
})
