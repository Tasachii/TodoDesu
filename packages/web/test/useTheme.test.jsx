import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTheme, THEMES } from '../src/hooks/useTheme.js'

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.className = ''
  delete document.documentElement.dataset.theme
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useTheme', () => {
  it('exposes the four themes', () => {
    expect(THEMES).toEqual(['auto', 'light', 'dark', 'wa'])
  })

  it('defaults to auto and reads a stored preference', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current[0]).toBe('auto')
  })

  it('ignores an invalid stored value, falling back to auto', () => {
    window.localStorage.setItem('todoo-theme', 'rainbow')
    const { result } = renderHook(() => useTheme())
    expect(result.current[0]).toBe('auto')
  })

  it('applies the dark class when set to dark and persists the choice', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current[1]('dark'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(window.localStorage.getItem('todoo-theme')).toBe('dark')
  })

  it('sets data-theme="wa" for the wa theme and removes it otherwise', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current[1]('wa'))
    expect(document.documentElement.dataset.theme).toBe('wa')
    act(() => result.current[1]('light'))
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('follows the system preference in auto mode', () => {
    window.matchMedia = vi.fn(() => ({
      matches: true, // system prefers dark
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    const { result } = renderHook(() => useTheme())
    act(() => result.current[1]('auto'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
