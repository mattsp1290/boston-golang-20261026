// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { StrictMode } from 'react'
import AutoChatSlide from './AutoChatSlide'
import { runChatScenario } from './autoChat'

const state = vi.hoisted(() => ({ id: 'title', overview: false, listeners: new Map<string, () => void>() }))
vi.mock('@revealjs/react', () => {
  const deck = { getCurrentSlide: () => ({ id: state.id }), isOverview: () => state.overview, on: (event: string, callback: () => void) => state.listeners.set(event, callback), off: (event: string) => state.listeners.delete(event) }
  return { useReveal: () => deck }
})
vi.mock('./autoChat', () => ({ runChatScenario: vi.fn(async () => {}) }))
beforeEach(() => { state.id = 'title'; state.overview = false; state.listeners.clear(); vi.clearAllMocks() })
afterEach(cleanup)
it('only runs on active slide, aborts on leaving, and restarts on reentry', () => {
  const { unmount } = render(<AutoChatSlide />)
  expect(runChatScenario).not.toHaveBeenCalled()
  act(() => { state.id = 'chat-demo'; state.listeners.get('slidechanged')?.() })
  expect(runChatScenario).toHaveBeenCalledTimes(1)
  const signal = vi.mocked(runChatScenario).mock.calls[0][0]
  act(() => { state.id = 'chat-fanout'; state.listeners.get('slidechanged')?.() })
  expect(signal.aborted).toBe(true)
  act(() => { state.id = 'chat-demo'; state.listeners.get('slidechanged')?.() })
  expect(runChatScenario).toHaveBeenCalledTimes(2)
  unmount()
  expect(vi.mocked(runChatScenario).mock.calls[1][0].aborted).toBe(true)
  expect(state.listeners.size).toBe(0)
})
it('handles initial demo hash, overview pause and StrictMode cleanup', () => {
  state.id = 'chat-demo'
  const { unmount } = render(<StrictMode><AutoChatSlide /></StrictMode>)
  expect(runChatScenario).toHaveBeenCalled()
  const active = vi.mocked(runChatScenario).mock.calls.at(-1)![0]
  act(() => { state.overview = true; state.listeners.get('overviewshown')?.() })
  expect(active.aborted).toBe(true)
  act(() => { state.overview = false; state.listeners.get('overviewhidden')?.() })
  expect(vi.mocked(runChatScenario).mock.calls.at(-1)![0].aborted).toBe(false)
  unmount()
  expect(vi.mocked(runChatScenario).mock.calls.every(([signal]) => signal.aborted)).toBe(true)
})
