// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { runChatScenario } from './autoChat'
import type { DemoCallbacks, DemoMessage } from './autoChat'

class FakeStream {
  static all: FakeStream[] = []
  listeners = new Map<string, (event: { data: string }) => void>()
  closed = false
  onerror: (() => void) | null = null
  constructor() { FakeStream.all.push(this); setTimeout(() => this.emit('ready', { subscriberId: String(FakeStream.all.length) }), 1) }
  addEventListener(type: string, listener: (event: { data: string }) => void) { this.listeners.set(type, listener) }
  emit(type: string, data: unknown) { if (!this.closed) this.listeners.get(type)?.({ data: JSON.stringify(data) }) }
  close() { this.closed = true }
}
let sequence: DemoMessage[]
let ui: DemoCallbacks
beforeEach(() => {
  vi.useFakeTimers(); FakeStream.all = []; sequence = []
  ui = { caption: vi.fn(), status: vi.fn(), received: vi.fn(), published: vi.fn() }
  vi.stubGlobal('EventSource', FakeStream)
  vi.stubGlobal('fetch', vi.fn(async (_url, options: RequestInit) => {
    const message = { ...JSON.parse(options.body as string), id: String(sequence.length + 1), sentAt: new Date().toISOString() } as DemoMessage
    sequence.push(message)
    for (const stream of FakeStream.all) stream.emit('chat', message)
    return { ok: true, json: async () => message }
  }))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it('runs once using observed SSE deliveries and reconnects without replay', async () => {
  const run = runChatScenario(new AbortController().signal, ui)
  await vi.advanceTimersByTimeAsync(30000); await run
  expect(sequence).toHaveLength(4)
  expect(FakeStream.all).toHaveLength(3)
  expect(FakeStream.all.every(stream => stream.closed)).toBe(true)
  expect(ui.received).toHaveBeenCalledWith('Alice', sequence[2])
  expect(ui.received).not.toHaveBeenCalledWith('Bob', sequence[2])
  expect(ui.received).toHaveBeenCalledWith('Bob', sequence[3])
  expect(ui.caption).toHaveBeenLastCalledWith(6, expect.stringContaining('Complete'))
  await vi.advanceTimersByTimeAsync(60000)
  expect(fetch).toHaveBeenCalledTimes(4)
})
it('aborts pacing immediately and closes every stream with no later publications', async () => {
  const controller = new AbortController()
  const run = runChatScenario(controller.signal, ui).catch(error => error)
  await vi.advanceTimersByTimeAsync(3000)
  controller.abort(); await run
  const count = sequence.length
  await vi.advanceTimersByTimeAsync(60000)
  expect(sequence).toHaveLength(count)
  expect(FakeStream.all.every(stream => stream.closed)).toBe(true)
})
it('never claims delivery from a successful POST without an SSE event', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id: 'silent', name: 'Alice', text: 'Hello Boston! One publication, two deliveries.' }) })))
  const run = runChatScenario(new AbortController().signal, ui).catch(error => error)
  await vi.advanceTimersByTimeAsync(12000)
  expect((await run).message).toContain('actual SSE delivery')
  expect(ui.received).not.toHaveBeenCalled()
  expect(ui.caption).not.toHaveBeenCalledWith(6, expect.anything())
  expect(FakeStream.all.every(stream => stream.closed)).toBe(true)
})
it('stops cleanly on an API error without repeating', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })))
  const run = runChatScenario(new AbortController().signal, ui).catch(error => error)
  await vi.advanceTimersByTimeAsync(30000)
  expect((await run).message).toContain('503')
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(FakeStream.all.every(stream => stream.closed)).toBe(true)
})
it('does not announce completion after a connection fails during the final pause', async () => {
  const run = runChatScenario(new AbortController().signal, ui).catch(error => error)
  await vi.advanceTimersByTimeAsync(18000)
  expect(sequence).toHaveLength(4)
  FakeStream.all.at(-1)!.onerror?.()
  await vi.advanceTimersByTimeAsync(10000)
  expect((await run).message).toContain('lost the server connection')
  expect(ui.caption).not.toHaveBeenCalledWith(6, expect.anything())
})
