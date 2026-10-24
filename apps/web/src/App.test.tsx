// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { StrictMode } from 'react'
import App from './App'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const appStyles = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'App.css'), 'utf8')

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return Number.parseFloat(this.style.width) || 1280 })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return Number.parseFloat(this.style.height) || 720 })
  window.location.hash = ''
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.location.hash = '' })

it('presents fourteen minimal slides with source lessons before each live scene', async () => {
  const { container } = render(<App />)
  await waitFor(() => expect(container.querySelector('.reveal')).toHaveClass('ready'), { timeout: 5000 })
  expect([...container.querySelectorAll('.slides > section')].map(slide => slide.id)).toEqual([
    'title', 'speaker', 'watermill', 'lesson-publish', 'report-publish', 'lesson-subscriber',
    'lesson-receive', 'lesson-handle', 'report-router', 'lesson-middleware', 'report-retry',
    'lesson-durable', 'report-durable', 'closing',
  ])
  expect(container.querySelector('#title')).toHaveClass('present')
  expect(screen.getByRole('heading', { name: 'Watermill.' })).toBeInTheDocument()
  expect(container.querySelector('#speaker')).toHaveTextContent('Matt Spurlin')
  expect(container.querySelector('#speaker')).toHaveTextContent('Senior Software EngineerDatadog')
  expect(container.querySelector('#speaker a')).toHaveAttribute('href', 'https://github.com/mattsp1290')
  expect([...container.querySelectorAll('#watermill .concept-path span')].map(item => item.textContent)).toEqual(['Publish', 'Handle', 'Middleware.'])
  expect(container.querySelector('#watermill')).toHaveTextContent('A Go library, not a broker.')
  expect(container.querySelector('#closing')).toHaveTextContent('Publish.Handle.Extend.')
  expect(container.querySelector('#closing a')).toHaveAttribute('href', 'https://watermill.io')
  expect(container.querySelectorAll('.slide-header, .slide-footer, .lesson-node, .lesson-takeaway')).toHaveLength(0)
  expect(container.querySelectorAll('.controls[style*="display: block"], .progress[style*="display: block"]')).toHaveLength(0)
  expect(container.querySelector('#report-subscribe')).not.toBeInTheDocument()
  for (const slide of container.querySelectorAll('.lesson-slide')) {
    expect(slide.querySelectorAll('pre')).toHaveLength(1)
    expect(slide.querySelector('.report-live')).not.toBeInTheDocument()
    expect(slide.parentElement).toHaveAttribute('data-notes', expect.stringContaining('https://watermill.io/'))
    expect(slide.querySelector('h2')!.textContent!.split(/\s+/).length).toBeLessThanOrEqual(7)
  }
  for (const source of container.querySelectorAll('.lesson-source')) {
    const lines = source.textContent!.replaceAll('\t', '  ').split('\n')
    expect(lines.length).toBeLessThanOrEqual(14)
    expect(Math.max(...lines.map(line => line.length))).toBeLessThanOrEqual(70)
    expect(source.textContent?.endsWith('\n')).toBe(false)
  }
}, 15_000)

it('keeps the continued Subscribe example safe and attributes acknowledgement to its owner', () => {
  const { container } = render(<App />)
  const publish = container.querySelector('[aria-label="Actual Go publish implementation"]')!
  expect(publish).toHaveTextContent('message.NewMessage(')
  expect(publish).toHaveTextContent('pub.Publish(r.topic(), msg)')
  expect(publish.textContent!.split('\n')).toHaveLength(6)
  expect(container.querySelector('#lesson-publish')).toHaveTextContent('Published ≠ processed')
  const subscribe = container.querySelector('[aria-label="Actual Go Subscribe call"]')!
  expect(subscribe).toHaveTextContent('incoming, err := bus.Subscribe(r.ctx, reportTopic)')
  expect(subscribe).toHaveTextContent('if err != nil')
  expect(subscribe.textContent!.split('\n')).toHaveLength(4)
  const receive = container.querySelector('[aria-label="Actual Go receive implementation, continued"]')!
  expect(receive).toHaveTextContent('case <-r.ctx.Done():')
  expect(receive).toHaveTextContent('case msg, ok := <-incoming:')
  expect(receive).toHaveTextContent('if !ok')
  expect(receive).toHaveTextContent('r.process(msg)')
  expect(receive).toHaveTextContent('msg.Nack()')
  expect(receive).toHaveTextContent('msg.Ack()')
  expect(receive).toHaveTextContent('publish to GoChannel before receiving')
  expect(receive).toHaveTextContent('demo telemetry')
  expect(receive.textContent!.split('\n')).toHaveLength(14)
  expect(container.querySelector('#lesson-receive')).toHaveAttribute('data-notes', expect.stringContaining('one finite receive'))
  expect(container.querySelector('#lesson-subscriber')).toHaveAttribute('data-notes', expect.stringContaining('shared GoChannel Publisher/Subscriber adapter'))
  const router = container.querySelector('[aria-label="Actual Go router implementation"]')!
  expect(router).toHaveTextContent('router.AddConsumerHandler(')
  expect(router).toHaveTextContent('r.process(msg)')
  expect(router).toHaveTextContent('demo completion signal')
  expect(router.textContent!.split('\n').length).toBeLessThanOrEqual(8)
  expect(container.querySelector('#lesson-handle')).toHaveTextContent('Router: nil → Ack')
  expect(container.querySelector('#lesson-handle')).toHaveTextContent('Router: error → Nack')
  expect(container.querySelector('#lesson-middleware')).toHaveTextContent('One message. Three calls.')
  expect(container.querySelector('#lesson-middleware .lesson-attempts')).not.toBeInTheDocument()
  expect(container.querySelector('[aria-label="Actual Go Retry middleware"]')).toHaveTextContent('MaxRetries: 2')
})

it('compares both transport interfaces in a single fourteen-line diff without changing the handler', () => {
  const { container } = render(<App />)
  const diff = container.querySelector('[aria-label="GoChannel to PostgreSQL code diff"]')!
  expect(diff).toHaveTextContent('- bus := gochannel.NewGoChannel')
  expect(diff).toHaveTextContent('- pub := message.Publisher(bus)')
  expect(diff).toHaveTextContent('- sub = bus // shared Publisher + Subscriber')
  expect(diff).toHaveTextContent('+ pub, err := wmsql.NewPublisher(')
  expect(diff).toHaveTextContent('+ sub, err = wmsql.NewSubscriber(')
  expect(diff).toHaveTextContent('SchemaAdapter: schema')
  expect(diff).toHaveTextContent('OffsetsAdapter: offsets, ConsumerGroup: "report-worker"')
  expect(diff).toHaveTextContent('Same application handler: r.process(msg)')
  expect(diff.querySelectorAll('.is-removed')).toHaveLength(3)
  expect(diff.querySelectorAll('.is-added')).toHaveLength(10)
  expect(diff.querySelectorAll('.transport-diff-line')).toHaveLength(14)
  expect(container.querySelector('#lesson-durable')).toHaveTextContent('Illustrative configuration; setup omitted.')
  expect(container.querySelector('#lesson-durable')).toHaveAttribute('data-notes', expect.stringContaining('DefaultPostgreSQLSchema'))
  expect(container.querySelector('#lesson-durable')).toHaveAttribute('data-notes', expect.stringContaining("not the live demo's temporal order"))
  expect(container.querySelector('#report-publish')).toHaveAttribute('data-notes', expect.stringContaining('does not prove offline retention'))
  expect(container.querySelector('#report-durable')).toHaveAttribute('data-notes', expect.stringContaining('not a process crash'))
})

it('uses one proportionally scaled 1920 by 1080 stage rather than responsive webpage reflow', async () => {
  const { container } = render(<App />)
  await waitFor(() => expect(container.querySelector('.reveal')).toHaveClass('ready'), { timeout: 5000 })
  const stage = container.querySelector('.slides') as HTMLElement
  expect(stage.style.width).toBe('1920px')
  expect(stage.style.height).toBe('1080px')
  expect(stage.style.transform).toContain('scale(')
  expect(appStyles).toContain('padding: 90px 120px;')
  expect(appStyles).toContain('top: 260px; width: 1680px; height: 630px;')
  expect(appStyles).toContain('font: 36px/1.2')
  expect(appStyles).toContain('transition-duration: 250ms;')
  expect(appStyles).toContain('@media (prefers-reduced-motion: reduce)')
  expect(appStyles).not.toMatch(/@media[^{}]*(max-width|min-width|max-height|min-height)/)
  expect(appStyles).not.toContain('overflow-y: auto')
  expect(appStyles).not.toContain('overflow-x: auto')
})

it.each(['lesson-publish', 'lesson-subscriber', 'lesson-receive', 'lesson-handle', 'lesson-middleware', 'lesson-durable', 'closing'])('never starts a live run on the %s explanation slide', async id => {
  window.location.hash = `#/${id}`
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const { container } = render(<App />)
  await waitFor(() => expect(container.querySelector(`#${id}`)).toHaveClass('present'), { timeout: 5000 })
  expect(fetch).not.toHaveBeenCalled()
})

it('moves forward and back with keyboard navigation and updates the hash', async () => {
  const { container } = render(<App />)
  await waitFor(() => expect(container.querySelector('.reveal')).toHaveClass('ready'), { timeout: 5000 })
  fireEvent.keyDown(document, { key: 'ArrowRight', keyCode: 39, which: 39 })
  await waitFor(() => expect(container.querySelector('#speaker')).toHaveClass('present'))
  await waitFor(() => expect(window.location.hash).toContain('speaker'), { timeout: 3000 })
  fireEvent.keyDown(document, { key: 'ArrowLeft', keyCode: 37, which: 37 })
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
    fireEvent.keyDown(document, direction === 'next' ? { key: 'ArrowRight', keyCode: 39, which: 39 } : { key: 'ArrowLeft', keyCode: 37, which: 37 })
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
  await move('previous', 'lesson-receive')
  expect(sequence).toBe(4)
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
