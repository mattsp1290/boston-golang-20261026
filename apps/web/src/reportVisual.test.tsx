// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ReportFlow } from './ReportFlow'
import { reportVisual } from './reportVisual'
import type { ReportMode, ReportRun } from './reports'

const snapshot = (kinds: string[], status: ReportRun['status'] = 'Queued', attempts = 0): ReportRun => ({
  id: 'run-1', mode: 'publish', messageId: 'one-stable-message', status, attempts,
  events: kinds.map((kind, index) => ({ sequence: index + 1, kind, detail: '', at: '2026-10-26T10:00:00Z' })),
})
afterEach(cleanup)

it('keeps the connecting diagram empty and accepted work at the app until publication', () => {
  const empty = reportVisual('durable', null)
  expect(empty.token).toBe('none')
  expect(empty.offline).toBe(false)
  expect(empty.workerState).toBe('waiting')
  expect(empty.ready).toBe(false)
  const queued = reportVisual('publish', snapshot(['queued']))
  expect(queued.token).toBe('app')
  expect(queued.published).toBe(false)
  expect(queued.received).toBe(false)
  expect(queued.acknowledged).toBe(false)
  expect(queued.detail).toContain('Accepted request at the app')
})

it('moves a single stable token only when the server supplies a new milestone', () => {
  const frames = [snapshot(['queued']), snapshot(['queued', 'published']), snapshot(['queued', 'published', 'attempt'], 'Processing', 1), snapshot(['queued', 'published', 'attempt', 'ready'], 'Ready', 1)]
  const expected = ['app', 'transport', 'worker', 'artifact']
  const { rerender } = render(<ReportFlow mode="publish" visual={reportVisual('publish', frames[0])} />)
  frames.forEach((run, index) => {
    rerender(<ReportFlow mode="publish" visual={reportVisual('publish', run)} />)
    expect(screen.getAllByTestId('message-token')).toHaveLength(1)
    expect(screen.getByTestId('message-token')).toHaveAttribute('data-message-id', 'one-stable-message')
    expect(screen.getByTestId('message-token')).toHaveAttribute('data-location', expected[index])
    expect(screen.queryByTestId('ack-return')).not.toBeInTheDocument()
  })
  rerender(<ReportFlow mode="publish" visual={reportVisual('publish', null)} />)
  expect(screen.queryByTestId('message-token')).not.toBeInTheDocument()
  expect(screen.getByTestId('csv-node')).toHaveAttribute('data-ready', 'false')
  expect(screen.getByTestId('publish-link')).not.toHaveClass('is-observed')
})

it.each<ReportMode>(['publish', 'subscribe', 'router', 'retry'])('%s explicitly uses non-durable memory transport', mode => {
  const visual = reportVisual(mode, snapshot(['published']))
  render(<ReportFlow mode={mode} visual={visual} />)
  expect(visual.transport).toBe('memory')
  expect(visual.diskRetained).toBe(false)
  expect(screen.getByTestId('transport-node')).toHaveTextContent('GoChannelIn memory only')
  expect(screen.queryByTestId('disk-retention')).not.toBeInTheDocument()
})

it('spins only for observed Processing, not startup, backoff, completion or an error', () => {
  const processing = reportVisual('retry', snapshot(['published', 'attempt'], 'Processing', 1))
  const { rerender } = render(<ReportFlow mode="retry" visual={processing} />)
  expect(screen.getByTestId('worker-node')).toHaveClass('is-working')
  const notWorking = [
    reportVisual('retry', null),
    reportVisual('retry', snapshot(['published'])),
    reportVisual('retry', snapshot(['attempt', 'retry'], 'Processing', 1)),
    reportVisual('retry', snapshot(['attempt', 'ready'], 'Ready', 1)),
    reportVisual('retry', snapshot(['attempt', 'error'], 'Error', 1)),
    reportVisual('retry', snapshot(['attempt'], 'Processing', 1), true),
  ]
  notWorking.forEach(visual => {
    expect(visual.working).toBe(false)
    rerender(<ReportFlow mode="retry" visual={visual} />)
    expect(screen.getByTestId('worker-node')).not.toHaveClass('is-working')
  })
})

it('shows actual failed attempts and a handler loop without returning to the transport', () => {
  const failed = snapshot(['published', 'attempt', 'retry'], 'Processing', 1)
  const retry = reportVisual('retry', failed)
  expect(retry.failedAttempts).toEqual([1])
  expect(retry.token).toBe('worker')
  expect(retry.retrying).toBe(true)
  const { container, rerender } = render(<ReportFlow mode="retry" visual={retry} />)
  expect(screen.getByTestId('retry-loop')).toHaveAttribute('data-active', 'true')
  expect(container.querySelector('[data-attempt="1"]')).toHaveAttribute('data-outcome', 'error')
  expect(container.querySelector('[data-outcome="complete"]')).not.toBeInTheDocument()
  const third = reportVisual('retry', snapshot(['published', 'attempt', 'retry', 'attempt', 'retry', 'attempt'], 'Processing', 3))
  rerender(<ReportFlow mode="retry" visual={third} />)
  expect(third.failedAttempts).toEqual([1, 2])
  expect(third.token).toBe('worker')
  expect(third.working).toBe(true)
  expect(screen.getByTestId('retry-loop')).toHaveAttribute('data-active', 'false')
  expect(container.querySelector('[data-attempt="3"]')).toHaveAttribute('data-outcome', 'observed')
  const ready = reportVisual('retry', { ...failed, status: 'Ready', attempts: 3, events: [...third.failedAttempts.flatMap((_, index) => [
    { sequence: index * 2 + 1, kind: 'attempt', detail: '', at: '' }, { sequence: index * 2 + 2, kind: 'retry', detail: '', at: '' },
  ]), { sequence: 5, kind: 'attempt', detail: '', at: '' }, { sequence: 6, kind: 'ready', detail: '', at: '' }] })
  rerender(<ReportFlow mode="retry" visual={ready} />)
  expect(container.querySelector('[data-attempt="3"]')).toHaveAttribute('data-outcome', 'complete')
  expect(screen.getByTestId('message-token')).toHaveAttribute('data-location', 'artifact')
})

it('keeps the message on disk while connections close and reopen, then moves on receipt', () => {
  const closed = ['worker-offline', 'published', 'db-closed']
  const visual = reportVisual('durable', snapshot(closed))
  expect(visual.token).toBe('transport')
  expect(visual.diskRetained).toBe(true)
  expect(visual.diskClosed).toBe(true)
  expect(visual.offline).toBe(true)
  const { rerender } = render(<ReportFlow mode="durable" visual={visual} />)
  expect(screen.getByTestId('disk-retention')).toHaveTextContent('PRESERVED')
  expect(screen.getByTestId('worker-node')).toHaveAttribute('data-state', 'offline')
  expect(screen.getByTestId('transport-node')).toHaveTextContent('Connections closed')
  const reopened = reportVisual('durable', snapshot([...closed, 'db-reopened']))
  expect(reopened.diskClosed).toBe(false)
  expect(reopened.diskRetained).toBe(true)
  expect(reopened.token).toBe('transport')
  expect(reopened.offline).toBe(true)
  const online = reportVisual('durable', snapshot([...closed, 'db-reopened', 'worker-online']))
  expect(online.offline).toBe(false)
  expect(online.token).toBe('transport')
  expect(online.workerState).toBe('online')
  const processing = reportVisual('durable', snapshot([...closed, 'db-reopened', 'worker-online', 'attempt'], 'Processing', 1))
  rerender(<ReportFlow mode="durable" visual={processing} />)
  expect(screen.getByTestId('message-token')).toHaveAttribute('data-location', 'worker')
  expect(screen.queryByTestId('disk-retention')).not.toBeInTheDocument()
  expect(screen.getByTestId('worker-node')).toHaveClass('is-working')
})

it('uses a real receipt if the durable worker-online log races behind processing', () => {
  const visual = reportVisual('durable', snapshot(['worker-offline', 'published', 'db-closed', 'db-reopened', 'attempt'], 'Processing', 1))
  expect(visual.workerOnline).toBe(false)
  expect(visual.offline).toBe(false)
  expect(visual.token).toBe('worker')
  expect(visual.working).toBe(true)
  expect(visual.diskRetained).toBe(false)
})

it('draws the subscriber Ack return only after the explicit event, never just Ready', () => {
  const received = snapshot(['published', 'attempt'], 'Processing', 1)
  const { rerender } = render(<ReportFlow mode="subscribe" visual={reportVisual('subscribe', received)} />)
  expect(screen.getByTestId('receive-link')).toHaveClass('is-observed')
  expect(screen.queryByTestId('ack-return')).not.toBeInTheDocument()
  const ready = { ...received, status: 'Ready' as const }
  rerender(<ReportFlow mode="subscribe" visual={reportVisual('subscribe', ready)} />)
  expect(screen.getByTestId('csv-node')).toHaveAttribute('data-ready', 'true')
  expect(screen.queryByTestId('ack-return')).not.toBeInTheDocument()
  const acknowledged = snapshot(['published', 'attempt', 'ack', 'ready'], 'Ready', 1)
  const visual = reportVisual('subscribe', acknowledged)
  rerender(<ReportFlow mode="subscribe" visual={visual} />)
  expect(screen.getByTestId('ack-return')).toHaveTextContent('Ack observed')
  expect(visual.headline).toBe('CSV ready. Ack observed.')
  rerender(<ReportFlow mode="subscribe" visual={reportVisual('subscribe', null)} />)
  expect(screen.queryByTestId('ack-return')).not.toBeInTheDocument()
})

it.each<ReportMode>(['router', 'retry', 'durable'])('%s can finish without fabricating an explicit Ack event', mode => {
  const visual = reportVisual(mode, snapshot(['published', 'attempt', 'ready'], 'Ready', 1))
  render(<ReportFlow mode={mode} visual={visual} />)
  expect(visual.acknowledged).toBe(false)
  expect(visual.detail).toContain('No explicit Ack event observed.')
  expect(screen.queryByTestId('ack-return')).not.toBeInTheDocument()
  expect(screen.getByTestId('message-token')).toHaveAttribute('data-location', 'artifact')
})

it('errors freeze the observed location without inventing an artifact or successful attempt', () => {
  const visual = reportVisual('retry', snapshot(['published', 'attempt', 'retry', 'error'], 'Error', 1))
  const { container } = render(<ReportFlow mode="retry" visual={visual} />)
  expect(visual.stage).toBe('Error')
  expect(visual.token).toBe('worker')
  expect(visual.ready).toBe(false)
  expect(screen.getByTestId('csv-node')).toHaveAttribute('data-ready', 'false')
  expect(screen.getByTestId('worker-node')).not.toHaveClass('is-working')
  expect(container.querySelector('[data-outcome="complete"]')).not.toBeInTheDocument()
})
