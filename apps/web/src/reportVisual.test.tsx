/// <reference types="node" />
// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ReportFlow } from './ReportFlow'
import { reportVisual } from './reportVisual'
import type { ReportMode, ReportRun } from './reports'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const styles = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ReportSlide.css'), 'utf8')

const snapshot = (kinds: string[], status: ReportRun['status'] = 'Queued', attempts = 0): ReportRun => ({
  id: 'run-1', mode: 'publish', messageId: 'one-stable-message', status, attempts,
  events: kinds.map((kind, index) => ({ sequence: index + 1, kind, detail: '', at: '2026-10-26T10:00:00Z' })),
})
afterEach(cleanup)

it.each<ReportMode>(['publish', 'router', 'retry', 'durable', 'subscribe'])('%s starts with no invented message or activity', mode => {
  const visual = reportVisual(mode, null)
  render(<ReportFlow mode={mode} visual={visual} />)
  expect(visual.token).toBe('none')
  expect(visual.executionState).toBe('waiting')
  expect(visual.ready).toBe(false)
  expect(visual.offline).toBe(false)
  expect(visual.working).toBe(false)
  expect(screen.queryByTestId('message-token')).not.toBeInTheDocument()
  expect(screen.getByRole('img')).toHaveAccessibleName()
  expect(screen.getByRole('region')).toHaveAttribute('tabindex', '0')
})

it('isolates publication from application work and observes availability separately from Publish', () => {
  const { rerender } = render(<ReportFlow mode="publish" visual={reportVisual('publish', snapshot(['queued']))} />)
  expect(screen.getByTestId('message-token')).toHaveAttribute('data-location', 'app')
  expect(screen.getByTestId('app-node')).toHaveTextContent('Publish')
  expect(screen.getByTestId('transport-node')).toHaveTextContent('Subscription')
  expect(screen.queryByTestId('handler-node')).not.toBeInTheDocument()
  expect(screen.queryByTestId('subscriber-node')).not.toBeInTheDocument()
  expect(screen.queryByTestId('result-node')).not.toBeInTheDocument()
  expect(screen.queryByTestId('consumer-node')).not.toBeInTheDocument()
  expect(screen.queryByTestId('ack-contract')).not.toBeInTheDocument()
  expect(screen.queryByTestId('retry-wrapper')).not.toBeInTheDocument()
  expect(screen.getByRole('img')).not.toHaveTextContent(/CSV|Worker|Application handler/)
  expect(screen.getByRole('img')).toHaveAccessibleName(/existing GoChannel subscription/)
  expect(screen.getByRole('img')).toHaveTextContent('does not retain messages for offline subscribers')
  const published = reportVisual('publish', snapshot(['queued', 'subscriber-listening', 'published']))
  rerender(<ReportFlow mode="publish" visual={published} />)
  expect(published.available).toBe(false)
  expect(published.complete).toBe(false)
  expect(screen.getByTestId('message-token')).toHaveAttribute('data-location', 'transport')
  expect(screen.getByTestId('publish-link')).toHaveClass('is-observed')
  const available = reportVisual('publish', snapshot(['queued', 'subscriber-listening', 'published', 'available', 'publication-complete'], 'Published'))
  rerender(<ReportFlow mode="publish" visual={available} />)
  expect(available.available).toBe(true)
  expect(available.complete).toBe(true)
  expect(available.ready).toBe(false)
  expect(available.attempts).toBe(0)
  expect(available.headline).toBe('Message became available.')
  expect(screen.getByTestId('transport-node')).toHaveClass('is-complete')
  expect(screen.getAllByTestId('message-token')).toHaveLength(1)
  expect(screen.getByTestId('message-token')).toHaveAttribute('data-message-id', 'one-stable-message')
})

it('keeps Router subscriber and application handler distinct, and does not claim delivery from Publish', () => {
  const published = reportVisual('router', snapshot(['published', 'worker-online']))
  const { rerender } = render(<ReportFlow mode="router" visual={published} />)
  expect(screen.getByTestId('subscriber-node')).toHaveTextContent('Subscriber')
  expect(screen.getByTestId('router-boundary')).toHaveTextContent('Router')
  expect(screen.getByTestId('handler-node')).toHaveTextContent('Applicationhandler')
  expect(screen.getByTestId('result-node')).toHaveAttribute('data-ready', 'false')
  expect(screen.getByTestId('receive-link')).not.toHaveClass('is-observed')
  expect(published.detail).toContain('delivery has not yet been observed')
  expect(screen.queryByTestId('ack-contract')).not.toBeInTheDocument()
  expect(screen.queryByTestId('ack-return')).not.toBeInTheDocument()
  expect(screen.queryByTestId('app-node')).not.toBeInTheDocument()
  expect(screen.queryByTestId('transport-node')).not.toBeInTheDocument()
  expect(screen.queryByTestId('retry-wrapper')).not.toBeInTheDocument()
  expect(screen.getByRole('img')).not.toHaveTextContent(/GoChannel|Worker/)
  const processing = reportVisual('router', snapshot(['published', 'attempt'], 'Processing', 1))
  rerender(<ReportFlow mode="router" visual={processing} />)
  expect(screen.getByTestId('receive-link')).toHaveClass('is-observed')
  expect(screen.getByTestId('message-token')).toHaveAttribute('data-location', 'handler')
  const ready = reportVisual('router', snapshot(['published', 'attempt', 'ready'], 'Ready', 1))
  rerender(<ReportFlow mode="router" visual={ready} />)
  expect(screen.getByTestId('result-node')).toHaveTextContent('CSV')
  expect(screen.getByTestId('result-node')).toHaveAttribute('data-ready', 'true')
  expect(screen.getByTestId('message-token')).toHaveAttribute('data-location', 'handler')
  expect(ready.acknowledged).toBe(false)
  expect(ready.detail).toContain('No explicit Ack event observed')
  expect(screen.queryByTestId('ack-return')).not.toBeInTheDocument()
})

it('shows observed error, error, success calls to one wrapped handler with one stable message', () => {
  const { container, rerender } = render(<ReportFlow mode="retry" visual={reportVisual('retry', null)} />)
  expect(screen.getByTestId('retry-wrapper')).toHaveTextContent('Retry')
  expect(screen.getAllByTestId('handler-node')).toHaveLength(1)
  expect(container.querySelectorAll('[data-outcome="pending"]')).toHaveLength(3)
  for (const node of ['app-node', 'transport-node', 'subscriber-node', 'result-node', 'consumer-node', 'ack-contract']) expect(screen.queryByTestId(node)).not.toBeInTheDocument()
  expect(screen.getByRole('img')).not.toHaveTextContent(/GoChannel|CSV|Worker/)
  const kinds = ['published', 'attempt', 'retry']
  const first = reportVisual('retry', snapshot(kinds, 'Processing', 1))
  rerender(<ReportFlow mode="retry" visual={first} />)
  expect(first.failedAttempts).toEqual([1])
  expect(screen.getByTestId('retry-loop')).toHaveAttribute('data-active', 'true')
  expect(container.querySelector('[data-attempt="1"]')).toHaveAttribute('data-outcome', 'error')
  expect(container.querySelector('[data-attempt="2"]')).toHaveAttribute('data-outcome', 'pending')
  const thirdKinds = [...kinds, 'attempt', 'retry', 'attempt']
  const third = reportVisual('retry', snapshot(thirdKinds, 'Processing', 3))
  rerender(<ReportFlow mode="retry" visual={third} />)
  expect(third.failedAttempts).toEqual([1, 2])
  expect(screen.getByTestId('retry-loop')).toHaveAttribute('data-active', 'false')
  expect(container.querySelector('[data-attempt="3"]')).toHaveAttribute('data-outcome', 'running')
  expect(screen.getByTestId('handler-node')).toHaveClass('is-working')
  const ready = reportVisual('retry', snapshot([...thirdKinds, 'ready'], 'Ready', 3))
  rerender(<ReportFlow mode="retry" visual={ready} />)
  expect(container.querySelector('[data-attempt="1"]')).toHaveAttribute('data-outcome', 'error')
  expect(container.querySelector('[data-attempt="2"]')).toHaveAttribute('data-outcome', 'error')
  expect(container.querySelector('[data-attempt="3"]')).toHaveAttribute('data-outcome', 'success')
  expect(screen.getAllByTestId('message-token')).toHaveLength(1)
  expect(screen.getByTestId('message-token')).toHaveAttribute('data-message-id', 'one-stable-message')
  expect(screen.getByTestId('message-token')).toHaveAttribute('data-location', 'handler')
})

it('shows only PostgreSQL retention and the subscriber/router lifecycle across close, reopen and receipt', () => {
  const closed = ['worker-offline', 'published', 'db-closed']
  const visual = reportVisual('durable', snapshot(closed))
  const { rerender } = render(<ReportFlow mode="durable" visual={visual} />)
  expect(visual.token).toBe('transport')
  expect(visual.storedMessage).toBe(true)
  expect(visual.databaseClosed).toBe(true)
  expect(visual.offline).toBe(true)
  expect(visual.retentionObserved).toBe(false)
  expect(screen.queryByTestId('database-retention')).not.toBeInTheDocument()
  expect(screen.getByTestId('receive-link')).toHaveAttribute('data-connected', 'false')
  expect(screen.getByTestId('consumer-node')).toHaveTextContent('Subscriber + RouterNot started')
  expect(screen.getByTestId('consumer-node')).toHaveAttribute('data-state', 'offline')
  expect(screen.getByTestId('transport-node')).toHaveTextContent('PostgreSQL')
  expect(screen.getByTestId('transport-node')).toHaveAttribute('data-transport', 'postgres')
  expect(screen.getByTestId('database-lifecycle')).toHaveTextContent('Close connections → Reconnect')
  for (const node of ['app-node', 'handler-node', 'result-node', 'retry-wrapper']) expect(screen.queryByTestId(node)).not.toBeInTheDocument()
  expect(screen.getByRole('img')).not.toHaveTextContent(/CSV|GoChannel|Application handler/)
  const reopened = reportVisual('durable', snapshot([...closed, 'db-reopened']))
  rerender(<ReportFlow mode="durable" visual={reopened} />)
  expect(reopened.databaseClosed).toBe(false)
  expect(reopened.storedMessage).toBe(true)
  expect(reopened.offline).toBe(true)
  expect(reopened.retentionObserved).toBe(false)
  expect(screen.queryByTestId('database-retention')).not.toBeInTheDocument()
  expect(screen.getByTestId('database-lifecycle')).toHaveTextContent('Reconnect')
  expect(screen.getByTestId('receive-link')).toHaveAttribute('data-connected', 'true')
  const online = reportVisual('durable', snapshot([...closed, 'db-reopened', 'worker-online']))
  rerender(<ReportFlow mode="durable" visual={online} />)
  expect(online.token).toBe('transport')
  expect(online.executionState).toBe('online')
  expect(screen.getByTestId('consumer-node')).toHaveTextContent('Started')
  expect(screen.getByTestId('receive-link')).not.toHaveClass('is-observed')
  const received = reportVisual('durable', snapshot([...closed, 'db-reopened', 'worker-online', 'attempt'], 'Processing', 1))
  rerender(<ReportFlow mode="durable" visual={received} />)
  expect(screen.getByTestId('message-token')).toHaveAttribute('data-location', 'consumer')
  expect(received.storedMessage).toBe(false)
  expect(received.retentionObserved).toBe(true)
  expect(screen.queryByTestId('database-retention')).not.toBeInTheDocument()
  expect(screen.getByRole('img')).toHaveTextContent('retention observed')
  expect(screen.getByTestId('message-token')).toHaveAttribute('data-message-id', 'one-stable-message')
  expect(screen.getByTestId('receive-link')).toHaveClass('is-observed')
  expect(screen.getByTestId('consumer-node')).toHaveClass('is-working')
})

it('uses receipt evidence when the durable startup log races behind processing', () => {
  const visual = reportVisual('durable', snapshot(['worker-offline', 'published', 'db-closed', 'db-reopened', 'attempt'], 'Processing', 1))
  expect(visual.consumerOnline).toBe(false)
  expect(visual.offline).toBe(false)
  expect(visual.token).toBe('consumer')
  expect(visual.working).toBe(true)
  expect(visual.storedMessage).toBe(false)
})

it('keeps the subscribe fallback distinct and displays Ack only from an explicit event', () => {
  const { rerender } = render(<ReportFlow mode="subscribe" visual={reportVisual('subscribe', snapshot(['published', 'attempt', 'ready'], 'Ready', 1))} />)
  expect(screen.getByTestId('receive-loop-boundary')).toHaveTextContent('Application receive loop')
  expect(screen.queryByTestId('ack-contract')).not.toBeInTheDocument()
  expect(screen.queryByTestId('ack-return')).not.toBeInTheDocument()
  rerender(<ReportFlow mode="subscribe" visual={reportVisual('subscribe', snapshot(['published', 'attempt', 'ack', 'ready'], 'Ready', 1))} />)
  expect(screen.getByTestId('ack-return')).toHaveTextContent('Explicit Ack observed')
})

it('animates only observed active work and respects reduced motion', () => {
  const { rerender } = render(<ReportFlow mode="retry" visual={reportVisual('retry', snapshot(['published', 'attempt'], 'Processing', 1))} />)
  expect(screen.getByTestId('handler-node')).toHaveClass('is-working')
  const inactive = [reportVisual('retry', null), reportVisual('retry', snapshot(['published'])), reportVisual('retry', snapshot(['attempt', 'retry'], 'Processing', 1)), reportVisual('retry', snapshot(['attempt', 'ready'], 'Ready', 1)), reportVisual('retry', snapshot(['attempt', 'error'], 'Error', 1)), reportVisual('retry', snapshot(['attempt'], 'Processing', 1), true)]
  for (const visual of inactive) {
    rerender(<ReportFlow mode="retry" visual={visual} />)
    expect(visual.working).toBe(false)
    expect(screen.getByTestId('handler-node')).not.toHaveClass('is-working')
  }
  expect(styles).toMatch(/prefers-reduced-motion: reduce[^]*flow-message \{ transition: none; \}[^]*animation: none !important/)
})

it('freezes error evidence without inventing a successful call', () => {
  const visual = reportVisual('retry', snapshot(['published', 'attempt', 'retry', 'error'], 'Error', 1))
  const { container } = render(<ReportFlow mode="retry" visual={visual} />)
  expect(visual.stage).toBe('Error')
  expect(visual.token).toBe('handler')
  expect(visual.ready).toBe(false)
  expect(screen.getByTestId('handler-node')).toHaveAttribute('data-state', 'error')
  expect(screen.getByTestId('message-token')).toHaveClass('is-paused')
  expect(container.querySelector('[data-outcome="success"]')).not.toBeInTheDocument()
})


it('does not claim retention from publication, closed connections, or reconnection alone', () => {
  for (const kinds of [ ['worker-offline'], ['worker-offline', 'published'], ['worker-offline', 'published', 'db-closed'], ['worker-offline', 'published', 'db-closed', 'db-reopened'], ['worker-offline', 'published', 'db-closed', 'db-reopened', 'worker-online'] ]) {
    const visual = reportVisual('durable', snapshot(kinds))
    expect(visual.retentionObserved).toBe(false)
    expect(visual.received).toBe(false)
    expect(visual.working).toBe(false)
    expect(visual.detail).not.toContain('retention observed')
  }
})

it('preserves full accessible identity without a projected token legend or duplicated captions', () => {
  const { container } = render(<ReportFlow mode="retry" visual={reportVisual('retry', snapshot(['attempt', 'retry'], 'Processing', 1))} />)
  expect(screen.getByRole('img')).toHaveAccessibleName(/Full message ID: one-stable-message/)
  expect(container.querySelector('figcaption')).not.toBeInTheDocument()
  expect(container.querySelector('.flow-token-key')).not.toBeInTheDocument()
  expect(container.querySelector('.flow-contract')).not.toBeInTheDocument()
  expect(container.querySelector('.flow-card')).not.toBeInTheDocument()
})

it.each<ReportMode>(['publish', 'router', 'retry', 'durable', 'subscribe'])('%s keeps diagram labels at least 36 design pixels without reflow or scrolling', mode => {
  const { container } = render(<div className="watermill-deck"><style>{styles}</style><ReportFlow mode={mode} visual={reportVisual(mode, snapshot(['worker-offline', 'published', 'db-closed']))} /></div>)
  expect(screen.getByRole('img')).toHaveAttribute('viewBox', '0 0 1680 520')
  for (const label of container.querySelectorAll('svg text')) {
    expect(parseFloat(window.getComputedStyle(label).fontSize)).toBeGreaterThanOrEqual(36)
  }
  expect(styles).not.toMatch(/@media\s*\((?:min|max)-(?:width|height)/)
  expect(styles).not.toMatch(/overflow[^;]*:\s*(?:auto|scroll)/)
  expect(styles).not.toMatch(/animation:[^;]*infinite/)
})
