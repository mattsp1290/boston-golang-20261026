// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import ChatDemo from './ChatDemo'

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = []
  url: string
  closed = false
  onerror: (() => void) | null = null
  constructor(url: string) { super(); this.url = url; FakeEventSource.instances.push(this) }
  close() { this.closed = true }
  emit(type: string, data: unknown) { this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) })) }
}
const message = { id: 'message-123', name: 'Alice', text: 'Hello Boston', sentAt: '2026-10-21T12:00:00Z' }
beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ subscribers: 2, published: 0, enqueued: 0, slowDisconnects: 0 }) }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('creates two independent subscriptions, renders actual received IDs, and closes both', async () => {
  const { unmount } = render(<ChatDemo />)
  expect(FakeEventSource.instances).toHaveLength(2)
  expect(FakeEventSource.instances.every(stream => stream.url === '/api/chat/events')).toBe(true)
  act(() => {
    FakeEventSource.instances[0].emit('ready', { subscriberId: 'alice-subscription' })
    FakeEventSource.instances[1].emit('ready', { subscriberId: 'bob-subscription' })
    FakeEventSource.instances[0].emit('chat', message)
  })
  expect(within(screen.getByRole('region', { name: "Alice's chat" })).getByText(message.text)).toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: "Bob's chat" })).queryByText(message.text)).not.toBeInTheDocument()
  expect(screen.getByText('Alice: received ✓')).toBeInTheDocument()
  expect(screen.getByText('Bob: not observed')).toBeInTheDocument()
  act(() => FakeEventSource.instances[1].emit('chat', message))
  expect(screen.getByText('Bob: received ✓')).toBeInTheDocument()
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  unmount()
  expect(FakeEventSource.instances.every(stream => stream.closed)).toBe(true)
})

it('disconnects and reconnects only Bob, retaining bounded live-only history', async () => {
  render(<ChatDemo />)
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect Bob' }))
  expect(FakeEventSource.instances[1].closed).toBe(true)
  expect(FakeEventSource.instances[0].closed).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect Bob' }))
  expect(FakeEventSource.instances).toHaveLength(3)
  act(() => {
    for (let index = 0; index < 55; index++) FakeEventSource.instances[2].emit('chat', { ...message, id: `id-${index}`, text: `Message ${index}` })
  })
  const feed = screen.getByRole('list', { name: "Bob's received messages" })
  expect(within(feed).getAllByRole('listitem')).toHaveLength(50)
  expect(within(feed).queryByText('Message 0')).not.toBeInTheDocument()
  expect(within(feed).getByText('Message 54')).toBeInTheDocument()
  await waitFor(() => expect(fetch).toHaveBeenCalled())
})

it('posts via HTTP, does not fabricate delivery, and keeps input on send failure', async () => {
  const mockedFetch = vi.mocked(fetch)
  mockedFetch.mockImplementation(async (url) => url === '/api/chat/messages' ? { ok: true, json: async () => message } as Response : { ok: true, json: async () => ({ subscribers: 2, published: 1, enqueued: 2, slowDisconnects: 0 }) } as Response)
  render(<ChatDemo />)
  const alice = screen.getByRole('region', { name: "Alice's chat" })
  expect(within(alice).getByRole('button', { name: 'Send →' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Send as Alice'), { target: { value: '  Hello Boston  ' } })
  fireEvent.click(within(alice).getByRole('button', { name: 'Send →' }))
  await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/chat/messages', expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Alice', text: 'Hello Boston' }) })))
  await screen.findByText('POST accepted')
  expect(screen.getByText('Alice: not observed')).toBeInTheDocument()
  expect(within(alice).queryByText(message.text)).not.toBeInTheDocument()
  expect(screen.getByLabelText('Send as Alice')).toHaveValue('')
  mockedFetch.mockResolvedValue({ ok: false, status: 503 } as Response)
  fireEvent.change(screen.getByLabelText('Send as Alice'), { target: { value: 'Retry me' } })
  fireEvent.click(within(alice).getByRole('button', { name: 'Send →' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Send failed (503)')
  expect(screen.getByLabelText('Send as Alice')).toHaveValue('Retry me')
})

it('cleans up StrictMode subscriptions and renders message text safely', async () => {
  const { container, unmount } = render(<StrictMode><ChatDemo /></StrictMode>)
  expect(FakeEventSource.instances.filter(stream => !stream.closed)).toHaveLength(2)
  act(() => FakeEventSource.instances.find(stream => !stream.closed)!.emit('chat', { ...message, text: '<img src=x onerror=alert(1)>' }))
  expect(container.querySelector('img')).toBeNull()
  expect(screen.getAllByText('<img src=x onerror=alert(1)>')).toHaveLength(2)
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  unmount()
  expect(FakeEventSource.instances.every(stream => stream.closed)).toBe(true)
})
