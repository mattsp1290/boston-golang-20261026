// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { StrictMode } from 'react'
import ReportSlide, { LiveReport } from './ReportSlide'
import { reportVisual } from './reportVisual'
import type { ReportStory } from './ReportSlide'
import { runReportScenario, UnconfirmedReportCreation } from './reports'
import type { ReportMode, ReportRun } from './reports'

const state = vi.hoisted(() => ({ id: 'title', overview: false, listeners: new Map<string, () => void>() }))
vi.mock('@revealjs/react', () => {
  const deck = { getCurrentSlide: () => ({ id: state.id }), isOverview: () => state.overview, on: (event: string, callback: () => void) => state.listeners.set(event, callback), off: (event: string) => state.listeners.delete(event) }
  return { useReveal: () => deck }
})
vi.mock('./reports', async importOriginal => ({ ...await importOriginal<typeof import('./reports')>(), runReportScenario: vi.fn(async () => undefined) }))
const modes: ReportMode[] = ['publish', 'subscribe', 'router', 'retry', 'durable']
const story: ReportStory = { mode: 'retry', step: '06', title: 'Fail twice.', accent: 'Finish on attempt three.', explanation: 'One report.', concept: 'Retry wraps the handler.', boundary: 'No exactly-once claim.', source: 'return generateReport(msg)' }
const result: ReportRun = { id: 'job-1', mode: 'retry', messageId: 'one-stable-message', status: 'Ready', attempts: 3, csv: 'region,total\nBoston,42', events: [{ sequence: 1, kind: 'published', detail: 'Real server detail', at: '2026-10-26T10:00:00Z' }] }
const settle = async () => { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }) }
const advance = async (milliseconds: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds) }) }
const finishRuns = () => vi.mocked(runReportScenario).mockImplementation(async (mode, _signal, update) => { const run: ReportRun = mode === 'publish' ? { ...result, mode, status: 'Published', attempts: 0, csv: undefined, events: [{ sequence: 1, kind: 'available', detail: 'Delivery availability observed', at: '2026-10-26T10:00:00Z' }] } : { ...result, mode }; update(run); return run })
beforeEach(() => { vi.useFakeTimers(); state.id = 'title'; state.overview = false; state.listeners.clear(); vi.resetAllMocks(); vi.mocked(runReportScenario).mockResolvedValue(undefined) })
afterEach(() => { cleanup(); vi.useRealTimers() })

it('starts only on entry, aborts on leaving, and starts one fresh run on reentry', async () => {
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
  unmount(); await settle()
  expect(vi.mocked(runReportScenario).mock.calls[1][1].aborted).toBe(true)
  expect(state.listeners.size).toBe(0)
})

it('handles direct entry, active work overview cancellation and StrictMode cleanup', async () => {
  state.id = 'report-retry'
  const { unmount } = render(<StrictMode><ReportSlide story={story} /></StrictMode>)
  const active = vi.mocked(runReportScenario).mock.calls.at(-1)![1]
  expect(active.aborted).toBe(false)
  act(() => { state.overview = true; state.listeners.get('overviewshown')?.() })
  expect(active.aborted).toBe(true)
  act(() => { state.overview = false; state.listeners.get('overviewhidden')?.() })
  expect(vi.mocked(runReportScenario).mock.calls.at(-1)![1].aborted).toBe(false)
  unmount(); await settle()
  expect(vi.mocked(runReportScenario).mock.calls.every(([, signal]) => signal.aborted)).toBe(true)
})

it.each(modes)('%s repeats successful finite runs only after each full four-second hold', async mode => {
  finishRuns()
  const { unmount } = render(<LiveReport mode={mode} />)
  await settle()
  expect(runReportScenario).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('Replay status')).toHaveTextContent('Next run in 4s')
  if (mode === 'router' || mode === 'subscribe') expect(screen.getByLabelText('Generated report CSV')).toHaveTextContent('Boston,42')
  else expect(screen.queryByLabelText('Generated report CSV')).not.toBeInTheDocument()
  await advance(3999)
  expect(runReportScenario).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('Replay status')).toHaveTextContent('Next run in 1s')
  await advance(1)
  expect(runReportScenario).toHaveBeenCalledTimes(2)
  expect(screen.getByText('RUN 2')).toBeInTheDocument()
  await advance(4000)
  expect(runReportScenario).toHaveBeenCalledTimes(3)
  expect(screen.getByText('RUN 3')).toBeInTheDocument()
  unmount(); await advance(30_000)
  expect(runReportScenario).toHaveBeenCalledTimes(3)
})

it('does not start the hold or next cycle until successful worker cleanup settles', async () => {
  let confirmCleanup!: (run: ReportRun) => void
  vi.mocked(runReportScenario).mockImplementationOnce(async (_mode, _signal, update) => { update(result); return new Promise<ReportRun>(resolve => { confirmCleanup = resolve }) })
  const { unmount } = render(<LiveReport mode="retry" />)
  await settle()
  expect(screen.getByLabelText('Replay status')).toHaveTextContent('confirming cleanup')
  await advance(10_000)
  expect(runReportScenario).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('Replay status')).not.toHaveTextContent('Next run')
  await act(async () => confirmCleanup(result))
  expect(screen.getByLabelText('Replay status')).toHaveTextContent('Next run in 4s')
  unmount(); await advance(20_000)
  expect(runReportScenario).toHaveBeenCalledTimes(1)
})

it.each(['leave', 'overview', 'unmount'])('cancels countdown on %s without starting another run', async action => {
  state.id = 'report-retry'; finishRuns()
  const { unmount } = render(<ReportSlide story={story} />)
  await settle(); await advance(2000)
  expect(screen.getByLabelText('Replay status')).toHaveTextContent('Next run in 2s')
  if (action === 'unmount') unmount()
  else act(() => {
    if (action === 'leave') { state.id = 'title'; state.listeners.get('slidechanged')?.() }
    else { state.overview = true; state.listeners.get('overviewshown')?.() }
  })
  await advance(30_000)
  expect(runReportScenario).toHaveBeenCalledTimes(1)
  expect(vi.mocked(runReportScenario).mock.calls[0][1].aborted).toBe(true)
})

it('keeps a late cancelled update or completion out of the new slide and its countdown', async () => {
  let finish!: (run: ReportRun) => void
  vi.mocked(runReportScenario).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  state.id = 'report-retry'
  render(<ReportSlide story={story} />)
  const lateUpdate = vi.mocked(runReportScenario).mock.calls[0][2]
  act(() => { state.id = 'title'; state.listeners.get('slidechanged')?.() })
  act(() => { state.id = 'report-retry'; state.listeners.get('slidechanged')?.() })
  await act(async () => { lateUpdate(result); finish(result) })
  expect(screen.queryByLabelText('Generated report CSV')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Connecting')
  await advance(30_000)
  expect(runReportScenario).toHaveBeenCalledTimes(2)
})

it('renders the observed message diagram with secondary server details', async () => {
  finishRuns()
  render(<LiveReport mode="retry" />)
  await settle()
  expect(screen.getByRole('status')).toHaveTextContent('ReadyHandler succeeded after 3 calls.')
  expect(screen.getByTestId('handler-node')).toHaveAttribute('data-state', 'complete')
  expect(screen.getByTestId('message-token')).toHaveAttribute('data-location', 'handler')
  expect(screen.getByRole('img', { name: /Retry middleware calls the same application handler/ })).toBeInTheDocument()
  expect(screen.getByText('Technical details · 1 server events').closest('details')).not.toHaveAttribute('open')
  expect(screen.getByText('one-stable-message')).toBeInTheDocument()
  expect(screen.getByText('Real server detail')).toBeInTheDocument()
  expect(screen.queryByLabelText('Generated report CSV')).not.toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it.each(['API failure', 'cleanup failure', 'worker error'])('stops automatic cycling on %s and permits one explicit retry', async failure => {
  if (failure === 'worker error') vi.mocked(runReportScenario).mockImplementationOnce(async (_mode, _signal, update) => { const run: ReportRun = { ...result, status: 'Error', error: 'Worker failed' }; update(run); return run })
  else vi.mocked(runReportScenario).mockImplementationOnce(async (_mode, _signal, update) => { if (failure === 'cleanup failure') update(result); throw new Error(failure) })
  render(<LiveReport mode="retry" />)
  await settle(); await advance(30_000)
  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(screen.getByLabelText('Replay status')).toHaveTextContent('Automatic replay paused')
  expect(screen.queryByLabelText('Generated report CSV')).not.toBeInTheDocument()
  expect(runReportScenario).toHaveBeenCalledTimes(1)
  finishRuns()
  fireEvent.click(screen.getByRole('button', { name: 'Try again ↻' })); await settle()
  expect(runReportScenario).toHaveBeenCalledTimes(2)
  expect(screen.getByLabelText('Replay status')).toHaveTextContent('Next run in 4s')
})

it('explains uncertain creation without offering an unsafe retry', async () => {
  vi.mocked(runReportScenario).mockRejectedValue(new UnconfirmedReportCreation('Wait 90 seconds for API expiry, then reload the deck.'))
  render(<LiveReport mode="subscribe" />)
  await settle(); await advance(30_000)
  expect(screen.getByRole('alert')).toHaveTextContent('Wait 90 seconds')
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(runReportScenario).toHaveBeenCalledTimes(1)
})

it('derives retry and durable teaching stages solely from server snapshots', () => {
  const snapshot = (kinds: string[], status: ReportRun['status'] = 'Queued', attempts = 0): ReportRun => ({ ...result, status, attempts, events: kinds.map((kind, i) => ({ sequence: i + 1, kind, detail: '', at: '2026-10-26T10:00:00Z' })) })
  expect(reportVisual('retry', null).stage).toBe('Connecting')
  expect(reportVisual('retry', snapshot(['queued'])).stage).toBe('Queued')
  expect(reportVisual('retry', snapshot(['queued', 'attempt'], 'Processing', 1)).stage).toBe('Processing')
  expect(reportVisual('retry', snapshot(['attempt', 'retry'], 'Processing', 1)).stage).toBe('Retrying')
  expect(reportVisual('retry', snapshot(['attempt', 'retry', 'attempt'], 'Processing', 2)).stage).toBe('Processing')
  expect(reportVisual('retry', snapshot(['attempt', 'retry', 'attempt'], 'Processing', 3)).headline).toBe('Third call. Same handler. Same message.')
  expect(reportVisual('durable', snapshot(['queued'])).stage).toBe('Queued')
  expect(reportVisual('durable', snapshot(['worker-offline'])).stage).toBe('Consumer offline')
  expect(reportVisual('durable', snapshot(['worker-offline', 'published'])).stage).toBe('Consumer offline')
  expect(reportVisual('durable', snapshot(['worker-offline', 'db-closed'])).stage).toBe('Connections closed')
  expect(reportVisual('durable', snapshot(['worker-offline', 'db-closed', 'db-reopened'])).stage).toBe('Database reconnected')
  expect(reportVisual('durable', snapshot(['db-closed', 'worker-online'])).stage).toBe('Consumer starts')
  expect(reportVisual('durable', snapshot(['worker-online', 'attempt'], 'Processing', 1)).executionState).toBe('processing')
  expect(reportVisual('durable', snapshot(['ready'], 'Ready', 1)).stage).toBe('Ready')
})


it('holds the Published terminal state without a report or handler and waits for cleanup', async () => {
  let confirmCleanup!: (run: ReportRun) => void
  const published: ReportRun = { ...result, mode: 'publish', status: 'Published', attempts: 0, csv: undefined, events: ['published', 'available', 'publication-complete'].map((kind, i) => ({ sequence: i + 1, kind, detail: '', at: '2026-10-26T10:00:00Z' })) }
  vi.mocked(runReportScenario).mockImplementationOnce(async (_mode, _signal, update) => { update(published); return new Promise<ReportRun>(resolve => { confirmCleanup = resolve }) })
  const { unmount } = render(<LiveReport mode="publish" />)
  await settle()
  expect(screen.getByRole('status')).toHaveTextContent('PublishedMessage became available.')
  expect(screen.getByLabelText('Replay status')).toHaveTextContent('Demo complete · confirming cleanup')
  expect(screen.queryByLabelText('Generated report CSV')).not.toBeInTheDocument()
  expect(screen.queryByTestId('handler-node')).not.toBeInTheDocument()
  expect(screen.queryByText('CSV OUTPUT')).not.toBeInTheDocument()
  await advance(10_000)
  expect(runReportScenario).toHaveBeenCalledTimes(1)
  await act(async () => confirmCleanup(published))
  expect(screen.getByLabelText('Replay status')).toHaveTextContent('Next run in 4s')
  await advance(3999)
  expect(runReportScenario).toHaveBeenCalledTimes(1)
  unmount()
  await advance(20_000)
  expect(runReportScenario).toHaveBeenCalledTimes(1)
})

it('shows the actual CSV only as the Router application result', async () => {
  finishRuns()
  render(<LiveReport mode="router" />)
  await settle()
  expect(screen.getByLabelText('Generated report CSV')).toHaveTextContent('region,total Boston,42')
  expect(screen.getByTestId('result-node')).toHaveTextContent('CSV generated')
  expect(screen.getByTestId('message-token')).toHaveAttribute('data-location', 'handler')
  expect(screen.queryByTestId('ack-return')).not.toBeInTheDocument()
})


it('shows the real missing PostgreSQL configuration error without simulating durable progress or replaying', async () => {
  const error = 'PostgreSQL persistence is not configured. Set REPORT_POSTGRES_DSN to a reachable PostgreSQL database and restart the API.'
  vi.mocked(runReportScenario).mockImplementationOnce(async (_mode, _signal, update) => {
    const run: ReportRun = { ...result, mode: 'durable', status: 'Error', attempts: 0, csv: undefined, error,
      events: [{ sequence: 1, kind: 'error', detail: error, at: '2026-10-26T10:00:00Z' }] }
    update(run)
    return run
  })
  render(<LiveReport mode="durable" />)
  await settle(); await advance(30_000)
  expect(screen.getByRole('alert')).toHaveTextContent('Set REPORT_POSTGRES_DSN')
  expect(screen.getByRole('alert')).toHaveTextContent('restart the API')
  expect(screen.getByLabelText('Replay status')).toHaveTextContent('Automatic replay paused')
  expect(screen.getByTestId('transport-node')).toHaveTextContent('PostgreSQL')
  expect(screen.queryByTestId('message-token')).not.toBeInTheDocument()
  expect(screen.queryByTestId('database-retention')).not.toBeInTheDocument()
  expect(screen.getByTestId('consumer-node')).toHaveTextContent('Not started')
  expect(runReportScenario).toHaveBeenCalledTimes(1)
})
