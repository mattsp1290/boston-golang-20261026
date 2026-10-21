// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { StrictMode } from 'react'
import ReportSlide from './ReportSlide'
import type { ReportStory } from './ReportSlide'
import { runReportScenario } from './reports'
import type { ReportRun } from './reports'

const state = vi.hoisted(() => ({ id: 'title', overview: false, listeners: new Map<string, () => void>() }))
vi.mock('@revealjs/react', () => {
  const deck = { getCurrentSlide: () => ({ id: state.id }), isOverview: () => state.overview, on: (event: string, callback: () => void) => state.listeners.set(event, callback), off: (event: string) => state.listeners.delete(event) }
  return { useReveal: () => deck }
})
vi.mock('./reports', () => ({ runReportScenario: vi.fn(async () => {}) }))
const story: ReportStory = { mode: 'retry', step: '05', title: 'Fail twice.', accent: 'Finish on attempt three.', explanation: 'One report.', concept: 'Retry wraps the handler.', boundary: 'No exactly-once claim.', source: 'return generateReport(msg)' }
const result: ReportRun = { id: 'job-1', mode: 'retry', messageId: 'one-stable-message', status: 'Ready', attempts: 3, csv: 'region,total\nBoston,42', events: [{ sequence: 1, kind: 'published', detail: 'Real server detail', at: '2026-10-26T10:00:00Z' }] }
beforeEach(() => { state.id = 'title'; state.overview = false; state.listeners.clear(); vi.resetAllMocks(); vi.mocked(runReportScenario).mockResolvedValue(undefined) })
afterEach(cleanup)

it('only starts on entry, cancels on leaving, and starts one fresh run on reentry', () => {
  const { unmount } = render(<ReportSlide story={story} />)
  expect(runReportScenario).not.toHaveBeenCalled()
  act(() => { state.id = 'report-retry'; state.listeners.get('slidechanged')?.() })
  expect(runReportScenario).toHaveBeenCalledTimes(1)
  const signal = vi.mocked(runReportScenario).mock.calls[0][1]
  act(() => { state.listeners.get('slidechanged')?.() })
  expect(runReportScenario).toHaveBeenCalledTimes(1)
  act(() => { state.id = 'report-router'; state.listeners.get('slidechanged')?.() })
  expect(signal.aborted).toBe(true)
  act(() => { state.id = 'report-retry'; state.listeners.get('slidechanged')?.() })
  expect(runReportScenario).toHaveBeenCalledTimes(2)
  unmount()
  expect(vi.mocked(runReportScenario).mock.calls[1][1].aborted).toBe(true)
  expect(state.listeners.size).toBe(0)
})

it('handles direct hash entry, overview pause and StrictMode cleanup', () => {
  state.id = 'report-retry'
  const { unmount } = render(<StrictMode><ReportSlide story={story} /></StrictMode>)
  const active = vi.mocked(runReportScenario).mock.calls.at(-1)![1]
  expect(active.aborted).toBe(false)
  act(() => { state.overview = true; state.listeners.get('overviewshown')?.() })
  expect(active.aborted).toBe(true)
  act(() => { state.overview = false; state.listeners.get('overviewhidden')?.() })
  expect(vi.mocked(runReportScenario).mock.calls.at(-1)![1].aborted).toBe(false)
  unmount()
  expect(vi.mocked(runReportScenario).mock.calls.every(([, signal]) => signal.aborted)).toBe(true)
})

it('Replay cancels the previous run, clears stale output and starts a fresh run', () => {
  state.id = 'report-retry'
  vi.mocked(runReportScenario).mockImplementationOnce(async (_mode, _signal, update) => update(result))
  render(<ReportSlide story={story} />)
  expect(screen.getByLabelText('Generated report CSV')).toHaveTextContent('Boston,42')
  const signal = vi.mocked(runReportScenario).mock.calls[0][1]
  fireEvent.click(screen.getByRole('button', { name: /Replay/ }))
  expect(signal.aborted).toBe(true)
  expect(runReportScenario).toHaveBeenCalledTimes(2)
  expect(screen.queryByLabelText('Generated report CSV')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Connecting')
})

it('renders observed events, the unchanged message ID, attempts, and only real CSV output', () => {
  state.id = 'report-retry'
  vi.mocked(runReportScenario).mockImplementation(async (_mode, _signal, update) => update(result))
  render(<ReportSlide story={story} />)
  expect(screen.getByRole('status')).toHaveTextContent('ReadyAttempt 3')
  expect(screen.getByText('one-stable-message')).toBeInTheDocument()
  expect(screen.getByText('Real server detail')).toBeInTheDocument()
  expect(screen.getByLabelText('Generated report CSV')).toHaveTextContent('region,total Boston,42')
})

it('shows a stopped API failure with an explicit Replay path', async () => {
  state.id = 'report-retry'
  vi.mocked(runReportScenario).mockRejectedValue(new Error('Report API request failed (503)'))
  render(<ReportSlide story={story} />)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('503'))
  expect(screen.getByRole('alert')).toHaveTextContent('Start the Go API, then choose Replay')
  expect(screen.queryByLabelText('Generated report CSV')).not.toBeInTheDocument()
  expect(runReportScenario).toHaveBeenCalledTimes(1)
})

it('does not show a late result from an aborted run after Replay', () => {
  state.id = 'report-retry'
  render(<ReportSlide story={story} />)
  const update = vi.mocked(runReportScenario).mock.calls[0][2]
  fireEvent.click(screen.getByRole('button', { name: /Replay/ }))
  act(() => update(result))
  expect(screen.queryByLabelText('Generated report CSV')).not.toBeInTheDocument()
})
