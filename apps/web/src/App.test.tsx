// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { StrictMode } from 'react'
import App from './App'

beforeEach(() => {
  window.location.hash = ''
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.location.hash = '' })

it('teaches Publish, Handle, and Middleware through explanation/demo pairs with a delivery bridge', async () => {
  const { container } = render(<App />)
  await waitFor(() => expect(container.querySelector('.reveal')).toHaveClass('ready'), { timeout: 5000 })
  expect(container.querySelectorAll('.slides > section')).toHaveLength(12)
  expect(container.querySelector('#title')).toHaveClass('present')
  expect(screen.getByRole('heading', { name: 'Watermill.' })).toBeInTheDocument()
  expect(container.querySelector('#speaker')).toHaveTextContent('Matt Spurlin')
  expect(container.querySelector('#speaker')).toHaveTextContent('Senior Software Engineerat Datadog')
  expect(container.querySelector('#speaker a')).toHaveAttribute('href', 'https://github.com/mattsp1290')
  expect([...container.querySelectorAll('#watermill .concepts h3')].map(item => item.textContent)).toEqual(['Publish', 'Handle', 'Middleware'])
  expect([...container.querySelectorAll('.slides > section')].map(slide => slide.id)).toEqual([
    'title', 'speaker', 'watermill', 'lesson-publish', 'report-publish', 'lesson-subscriber',
    'lesson-handle', 'report-router', 'lesson-middleware', 'report-retry', 'lesson-durable', 'report-durable',
  ])
  expect(container.querySelector('#report-subscribe')).not.toBeInTheDocument()
  expect(container.querySelector('#lesson-publish')).toHaveTextContent('Published ≠ processed.')
  expect(container.querySelector('#report-publish')).toHaveTextContent('No handler runs and no CSV is generated')
  expect(container.querySelector('#report-publish')).toHaveAttribute('data-notes', expect.stringContaining('does not prove offline retention'))
  expect(container.querySelector('#lesson-subscriber')).toHaveTextContent('Subscriber is a transport adapter')
  expect(container.querySelector('#lesson-subscriber')).toHaveTextContent('bus is a GoChannel instance')
  const subscriberSource = container.querySelector('[aria-label="Actual Go subscribe implementation"]')
  expect(subscriberSource).toHaveTextContent('.Subscribe(')
  expect(subscriberSource).toHaveTextContent('ctx.Done()')
  expect(subscriberSource).toHaveTextContent('.Ack()')
  expect(subscriberSource).toHaveTextContent('.Nack()')
  expect(subscriberSource).toHaveTextContent('if !ok')
  expect(subscriberSource).toHaveTextContent('publisher and demo staging')
  expect(subscriberSource?.querySelectorAll('.lesson-code-line').length).toBeLessThanOrEqual(12)
  expect(container.querySelector('#lesson-handle')).toHaveTextContent('handler is your application function')
  expect(container.querySelector('#lesson-handle')).toHaveTextContent('Router calls Ack()')
  expect(container.querySelector('#lesson-handle')).toHaveTextContent('Router calls Nack()')
  expect(container.querySelector('[aria-label="Actual Go router implementation"]')).toHaveTextContent('AddConsumerHandler')
  expect(container.querySelector('[aria-label="Actual Go router implementation"]')).toHaveTextContent('demo completion signal')
  expect(container.querySelector('#lesson-middleware')).toHaveTextContent('One message. Three handler calls.')
  expect(container.querySelector('#report-retry')).toHaveTextContent('Finish on attempt three.')
  expect(container.querySelector('#lesson-durable')).toHaveTextContent('Connection restart, not process restart.')
  expect(container.querySelector('#report-durable')).toHaveTextContent('PostgreSQL')
  expect(container.querySelector('#lesson-durable')).toHaveTextContent('not a universal Watermill default')
  expect(container.querySelector('#lesson-durable')).toHaveTextContent('Same report handler.')
  expect(container.querySelector('#lesson-durable')).toHaveTextContent('r.process(msg)')
  expect(container.querySelector('#lesson-durable')).toHaveTextContent('REPORT_POSTGRES_DSN')
  expect(container.querySelector('#lesson-durable a')).toHaveAttribute('href', 'https://watermill.io/pubsubs/sql/')
  const memoryConfig = container.querySelector('[aria-label="Actual GoChannel adapter configuration"]')
  const sqlConfig = container.querySelector('[aria-label="Actual PostgreSQL adapter configuration"]')
  expect(memoryConfig).toHaveTextContent('gochannel.NewGoChannel')
  expect(sqlConfig).toHaveTextContent('wmsql.NewPublisher')
  expect(sqlConfig).toHaveTextContent('wmsql.NewSubscriber')
  expect(sqlConfig).toHaveTextContent('DefaultPostgreSQLSchema')
  expect(sqlConfig).toHaveTextContent('DefaultPostgreSQLOffsetsAdapter')
  expect(sqlConfig).toHaveTextContent('BeginnerFromStdSQL(db)')
  expect(sqlConfig).toHaveTextContent('after close and reconnect')
  expect(sqlConfig?.textContent?.split('\n').length).toBeLessThanOrEqual(22)
  const durableSource = container.querySelector('[aria-label="Actual Go durable implementation"]')
  expect(durableSource).toHaveTextContent('pub.Close()')
  expect(durableSource).toHaveTextContent('db.Close()')
  expect(durableSource).toHaveTextContent('openReportDB(r.ctx, dsn)')
  expect(durableSource).toHaveTextContent('r.routed(sub, nil)')
  expect(durableSource).not.toHaveTextContent('.Publish(')
  expect(durableSource?.querySelectorAll('.report-code-line').length).toBeLessThanOrEqual(18)
  expect(container.querySelector('#lesson-durable')).not.toHaveTextContent(/SQLite|beta/i)
  expect(container.querySelector('#report-durable')).not.toHaveTextContent(/SQLite|beta/i)
  expect(container.querySelector('#report-durable')).toHaveAttribute('data-notes', expect.stringContaining('not a process crash'))
  for (const slide of container.querySelectorAll('.lesson-slide')) {
    expect(slide.querySelector('a')).toHaveAttribute('href', expect.stringMatching(/^https:\/\/watermill.io\//))
    expect(slide.querySelector('.report-live')).not.toBeInTheDocument()
  }
}, 15_000)

it.each(['lesson-publish', 'lesson-subscriber', 'lesson-handle', 'lesson-middleware', 'lesson-durable'])('never starts a live run on the %s explanation slide', async id => {
  window.location.hash = `#/${id}`
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const { container } = render(<App />)
  await waitFor(() => expect(container.querySelector(`#${id}`)).toHaveClass('present'), { timeout: 5000 })
  expect(fetch).not.toHaveBeenCalled()
})

it('moves forward and back with native controls and updates the hash', async () => {
  const { container } = render(<App />)
  await waitFor(() => expect(container.querySelector('.reveal')).toHaveClass('ready'), { timeout: 5000 })
  fireEvent.click(screen.getByRole('button', { name: 'next slide' }))
  await waitFor(() => expect(container.querySelector('#speaker')).toHaveClass('present'))
  await waitFor(() => expect(window.location.hash).toContain('speaker'), { timeout: 3000 })
  fireEvent.click(screen.getByRole('button', { name: 'previous slide' }))
  await waitFor(() => expect(container.querySelector('#title')).toHaveClass('present'))
})

it('survives React StrictMode initialization and cleanup without duplicate decks', async () => {
  const { container, unmount } = render(<StrictMode><App /></StrictMode>)
  await waitFor(() => expect(container.querySelector('.reveal')).toHaveClass('ready'), { timeout: 5000 })
  expect(container.querySelectorAll('.controls')).toHaveLength(1)
  unmount()
  expect(document.querySelector('.reveal')).not.toBeInTheDocument()
})

it('supports keyboard and touch navigation without blocking vertical scrolling', async () => {
  const { container } = render(<App />)
  const deck = container.querySelector('.reveal')!
  await waitFor(() => expect(deck).toHaveClass('ready'), { timeout: 5000 })
  fireEvent.keyDown(document, { key: 'ArrowRight', keyCode: 39, which: 39 })
  await waitFor(() => expect(container.querySelector('#speaker')).toHaveClass('present'))
  fireEvent.pointerDown(deck, { pointerType: 'touch', pointerId: 1, clientX: 200, clientY: 100 })
  fireEvent.pointerMove(deck, { pointerType: 'touch', pointerId: 1, clientX: 50, clientY: 100 })
  fireEvent.pointerUp(deck, { pointerType: 'touch', pointerId: 1 })
  await waitFor(() => expect(container.querySelector('#watermill')).toHaveClass('present'))
  fireEvent.pointerDown(deck, { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 200 })
  const verticalMove = createEvent.pointerMove(deck, { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 50, cancelable: true })
  fireEvent(deck, verticalMove)
  expect(verticalMove.defaultPrevented).toBe(false)
  fireEvent.pointerUp(deck, { pointerType: 'touch', pointerId: 1 })
})

it('toggles the native overview without overriding its transform', async () => {
  const { container } = render(<App />)
  const deck = container.querySelector('.reveal')!
  await waitFor(() => expect(deck).toHaveClass('ready'), { timeout: 5000 })
  fireEvent.keyDown(document, { key: 'Escape', keyCode: 27, which: 27 })
  await waitFor(() => expect(deck).toHaveClass('overview'))
  expect((container.querySelector('.slides') as HTMLElement).style.transform).toContain('scale')
  fireEvent.keyDown(document, { key: 'Escape', keyCode: 27, which: 27 })
  await waitFor(() => expect(deck).not.toHaveClass('overview'))
})

it('starts only active live slides and stops for explanation slides, overview, and unmount', async () => {
  window.location.hash = '#/report-router'
  let sequence = 0
  let maxActiveRuns = 0
  const activeRuns = new Set<string>()
  const runs = new Map<string, object>()
  const starts: { mode: string; slide: string | undefined; overview: boolean }[] = []
  const fetch = vi.fn(async (url: string, options: RequestInit = {}) => {
    if (options.method === 'DELETE') {
      activeRuns.delete(url)
      return new Response(null, { status: 204 })
    }
    if (options.method === 'POST') {
      const { mode } = JSON.parse(options.body as string)
      starts.push({ mode, slide: document.querySelector('.slides > section.present')?.id, overview: !!document.querySelector('.reveal.overview') })
      const id = `job-${++sequence}`
      const run = { id, mode, status: 'Queued', attempts: 0, messageId: `message-${id}`, events: [] }
      runs.set(`/api/reports/runs/${id}`, run)
      activeRuns.add(`/api/reports/runs/${id}`)
      maxActiveRuns = Math.max(maxActiveRuns, activeRuns.size)
      return new Response(JSON.stringify(run))
    }
    return new Response(JSON.stringify(runs.get(url)))
  })
  const deleted = (id: number) => fetch.mock.calls.some(([url, options]) => url.endsWith(`/job-${id}`) && options?.method === 'DELETE')
  const reads = () => fetch.mock.calls.filter(([, options]) => !options?.method).length
  vi.stubGlobal('fetch', fetch)
  const { container, unmount } = render(<App />)
  const deck = container.querySelector('.reveal')!
  const move = async (direction: 'next' | 'previous', id: string) => {
    fireEvent.click(screen.getByRole('button', { name: `${direction} slide` }))
    await waitFor(() => expect(container.querySelector(`#${id}`)).toHaveClass('present'))
  }
  await waitFor(() => expect(container.querySelector('#report-router')).toHaveClass('present'), { timeout: 5000 })
  await waitFor(() => expect(sequence).toBe(1))
  expect(starts).toEqual([{ mode: 'router', slide: 'report-router', overview: false }])
  expect(activeRuns.size).toBe(1)

  fireEvent.keyDown(document, { key: 'Escape', keyCode: 27, which: 27 })
  await waitFor(() => expect(deck).toHaveClass('overview'))
  await waitFor(() => expect(deleted(1)).toBe(true))
  expect(activeRuns.size).toBe(0)
  const overviewReads = reads()
  await new Promise(resolve => setTimeout(resolve, 450))
  expect(sequence).toBe(1)
  expect(reads()).toBe(overviewReads)

  fireEvent.keyDown(document, { key: 'Escape', keyCode: 27, which: 27 })
  await waitFor(() => expect(deck).not.toHaveClass('overview'))
  await waitFor(() => expect(sequence).toBe(2))
  await move('next', 'lesson-middleware')
  await waitFor(() => expect(deleted(2)).toBe(true))
  expect(activeRuns.size).toBe(0)
  const explanationReads = reads()
  await new Promise(resolve => setTimeout(resolve, 450))
  expect(sequence).toBe(2)
  expect(reads()).toBe(explanationReads)

  await move('next', 'report-retry')
  await waitFor(() => expect(sequence).toBe(3))
  await move('previous', 'lesson-middleware')
  await waitFor(() => expect(deleted(3)).toBe(true))
  await move('previous', 'report-router')
  await waitFor(() => expect(sequence).toBe(4))
  await move('previous', 'lesson-handle')
  await waitFor(() => expect(deleted(4)).toBe(true))
  await move('previous', 'lesson-subscriber')
  expect(sequence).toBe(4)
  expect(activeRuns.size).toBe(0)
  await move('previous', 'report-publish')
  await waitFor(() => expect(sequence).toBe(5))
  await move('previous', 'lesson-publish')
  await waitFor(() => expect(deleted(5)).toBe(true))
  expect(activeRuns.size).toBe(0)
  await move('previous', 'watermill')
  const openingReads = reads()
  await new Promise(resolve => setTimeout(resolve, 450))
  expect(sequence).toBe(5)
  expect(reads()).toBe(openingReads)

  await move('next', 'lesson-publish')
  expect(sequence).toBe(5)
  await move('next', 'report-publish')
  await waitFor(() => expect(sequence).toBe(6))
  unmount()
  await waitFor(() => expect(deleted(6)).toBe(true))
  expect(activeRuns.size).toBe(0)
  expect(maxActiveRuns).toBe(1)
  expect(starts).toEqual([
    { mode: 'router', slide: 'report-router', overview: false },
    { mode: 'router', slide: 'report-router', overview: false },
    { mode: 'retry', slide: 'report-retry', overview: false },
    { mode: 'router', slide: 'report-router', overview: false },
    { mode: 'publish', slide: 'report-publish', overview: false },
    { mode: 'publish', slide: 'report-publish', overview: false },
  ])
}, 15_000)
