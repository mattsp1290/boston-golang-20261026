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

it('initializes the real deck with eight slides and confirmed speaker details', async () => {
  const { container } = render(<App />)
  await waitFor(() => expect(container.querySelector('.reveal')).toHaveClass('ready'), { timeout: 5000 })
  expect(container.querySelectorAll('.slides > section')).toHaveLength(8)
  expect(container.querySelector('#title')).toHaveClass('present')
  expect(screen.getByRole('heading', { name: 'Watermill.' })).toBeInTheDocument()
  expect(container.querySelector('#speaker')).toHaveTextContent('Matt Spurlin')
  expect(container.querySelector('#speaker')).toHaveTextContent('Senior Software Engineerat Datadog')
  expect(container.querySelector('#speaker a')).toHaveAttribute('href', 'https://github.com/mattsp1290')
  expect(container.querySelector('#watermill')).toHaveTextContent('Publish & subscribe')
  expect(container.querySelector('#watermill')).toHaveTextContent('Compose middleware')
  expect(container.querySelector('#watermill')).toHaveAttribute('data-notes', expect.stringContaining('idempotent'))
  expect(container.querySelector('#report-publish')).toHaveTextContent('Accept the request.')
  expect(container.querySelector('#report-subscribe')).toHaveTextContent('Receive the message.')
  expect(container.querySelector('#report-subscribe')).toHaveTextContent('Subscribe(ctx, topic)')
  expect(container.querySelector('#report-subscribe')).toHaveTextContent('closed messages channel')
  const subscriberSource = container.querySelector('[aria-label="Actual Go subscribe implementation"]')
  expect(subscriberSource).toHaveTextContent('.Subscribe(')
  expect(subscriberSource).toHaveTextContent('ctx.Done()')
  expect(subscriberSource).toHaveTextContent('.Ack()')
  expect(subscriberSource).toHaveTextContent('.Nack()')
  expect(subscriberSource).toHaveTextContent('if !ok')
  expect(subscriberSource).toHaveTextContent('publisher and demo staging')
  expect(subscriberSource?.querySelectorAll('.report-code-line').length).toBeLessThanOrEqual(12)
  expect(container.querySelector('#report-publish')).toHaveAttribute('data-notes', expect.stringContaining('five-part story'))
  expect(container.querySelector('#report-subscribe')).toHaveAttribute('data-notes', expect.stringContaining('four seconds'))
  expect([...container.querySelectorAll('.slides > section')].map(slide => slide.id)).toEqual([
    'title', 'speaker', 'watermill', 'report-publish', 'report-subscribe', 'report-router', 'report-retry', 'report-durable',
  ])
  expect(container.querySelector('#report-router')).toHaveTextContent('05 / HANDLE THE MESSAGE')
  expect(container.querySelector('#report-retry')).toHaveTextContent('06 / RETRY A TRANSIENT FAILURE')
  expect(container.querySelector('#report-durable')).toHaveTextContent('07 / KEEP WORK WHILE THE WORKER IS OFFLINE')
  expect(container.querySelector('#report-router')).toHaveTextContent('Return nil')
  expect(container.querySelector('#report-retry')).toHaveTextContent('Finish on attempt three.')
  expect(container.querySelector('#report-durable')).toHaveTextContent('SQLite')
  expect(container.querySelector('#report-durable')).toHaveTextContent('Starts automatically')
  expect(container.querySelector('#report-durable')).toHaveAttribute('data-notes', expect.stringContaining('not a process crash'))
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

it('starts only the current subscriber from a direct hash and stops for real overview and navigation', async () => {
  window.location.hash = '#/report-subscribe'
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
  await waitFor(() => expect(container.querySelector('#report-subscribe')).toHaveClass('present'), { timeout: 5000 })
  await waitFor(() => expect(sequence).toBe(1))
  expect(starts).toEqual([{ mode: 'subscribe', slide: 'report-subscribe', overview: false }])
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
  fireEvent.click(screen.getByRole('button', { name: 'next slide' }))
  await waitFor(() => expect(container.querySelector('#report-router')).toHaveClass('present'))
  await waitFor(() => expect(sequence).toBe(3))
  expect(deleted(2)).toBe(true)
  expect(starts.map(start => start.mode)).toEqual(['subscribe', 'subscribe', 'router'])

  fireEvent.click(screen.getByRole('button', { name: 'previous slide' }))
  await waitFor(() => expect(container.querySelector('#report-subscribe')).toHaveClass('present'))
  await waitFor(() => expect(sequence).toBe(4))
  expect(deleted(3)).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'previous slide' }))
  await waitFor(() => expect(container.querySelector('#report-publish')).toHaveClass('present'))
  await waitFor(() => expect(sequence).toBe(5))
  expect(deleted(4)).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'previous slide' }))
  await waitFor(() => expect(container.querySelector('#watermill')).toHaveClass('present'))
  await waitFor(() => expect(deleted(5)).toBe(true))
  expect(activeRuns.size).toBe(0)
  const openingReads = reads()
  await new Promise(resolve => setTimeout(resolve, 450))
  expect(sequence).toBe(5)
  expect(reads()).toBe(openingReads)

  fireEvent.click(screen.getByRole('button', { name: 'next slide' }))
  await waitFor(() => expect(sequence).toBe(6))
  unmount()
  await waitFor(() => expect(deleted(6)).toBe(true))
  expect(activeRuns.size).toBe(0)
  expect(maxActiveRuns).toBe(1)
  expect(starts).toEqual([
    { mode: 'subscribe', slide: 'report-subscribe', overview: false },
    { mode: 'subscribe', slide: 'report-subscribe', overview: false },
    { mode: 'router', slide: 'report-router', overview: false },
    { mode: 'subscribe', slide: 'report-subscribe', overview: false },
    { mode: 'publish', slide: 'report-publish', overview: false },
    { mode: 'publish', slide: 'report-publish', overview: false },
  ])
}, 15_000)
