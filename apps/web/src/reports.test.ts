import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReportMode, ReportRun } from './reports'

let reports: typeof import('./reports')
const modes: ReportMode[] = ['publish', 'subscribe', 'router', 'retry', 'durable']
const queued: ReportRun = { id: 'job-1', mode: 'retry', status: 'Queued', attempts: 0, messageId: 'message-1', events: [{ sequence: 1, kind: 'queued', detail: 'Accepted', at: '2026-10-26T10:00:00Z' }] }
const ready: ReportRun = { ...queued, status: 'Ready', attempts: 3, csv: 'region,total\nBoston,42\n' }
const reply = (run: ReportRun) => new Response(JSON.stringify(run))
const deleted = () => new Response(null, { status: 204 })
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve() }
beforeEach(async () => { vi.useFakeTimers(); vi.resetModules(); reports = await import('./reports') })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it.each(modes)('%s observes its terminal outcome and awaits successful cleanup', async mode => {
  const terminal: ReportRun = mode === 'publish' ? { ...queued, mode, status: 'Published' } : { ...ready, mode }
  const fetch = vi.fn().mockResolvedValueOnce(reply({ ...queued, mode })).mockResolvedValueOnce(reply(terminal)).mockResolvedValue(deleted())
  vi.stubGlobal('fetch', fetch)
  const update = vi.fn()
  const task = reports.runReportScenario(mode, new AbortController().signal, update)
  await vi.advanceTimersByTimeAsync(200)
  expect(await task).toEqual(terminal)
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ mode }) })
  expect(update.mock.calls.map(([run]) => run.status)).toEqual(['Queued', terminal.status])
  expect(fetch.mock.calls[2][1]).toMatchObject({ method: 'DELETE', keepalive: true })
  expect(fetch.mock.calls[2][1].signal.aborted).toBe(false)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(fetch).toHaveBeenCalledTimes(3)
})

it('serializes a late cancelled POST, its DELETE, and the next slide POST', async () => {
  let finishPost!: (response: Response) => void
  let finishDelete!: (response: Response) => void
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finishPost = resolve }))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finishDelete = resolve }))
    .mockResolvedValueOnce(reply({ ...ready, id: 'job-2', mode: 'subscribe' })).mockResolvedValue(deleted())
  vi.stubGlobal('fetch', fetch)
  const first = new AbortController()
  const update = vi.fn()
  const task1 = reports.runReportScenario('retry', first.signal, update)
  await flush()
  first.abort()
  const task2 = reports.runReportScenario('subscribe', new AbortController().signal, vi.fn())
  await flush()
  expect(fetch).toHaveBeenCalledTimes(1)
  finishPost(reply(queued)); await flush()
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(fetch.mock.calls[1][1].method).toBe('DELETE')
  expect(update).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1000)
  expect(fetch).toHaveBeenCalledTimes(2)
  finishDelete(deleted())
  await Promise.all([task1, task2])
  expect(fetch.mock.calls.map(([, options]) => options.method)).toEqual(['POST', 'DELETE', 'POST', 'DELETE'])
})

it('skips an aborted queued start behind another run, including StrictMode cleanup', async () => {
  let finish!: (response: Response) => void
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve })).mockResolvedValue(deleted())
  vi.stubGlobal('fetch', fetch)
  const first = new AbortController(), second = new AbortController()
  const task1 = reports.runReportScenario('retry', first.signal, vi.fn())
  await flush()
  const task2 = reports.runReportScenario('publish', second.signal, vi.fn())
  first.abort(); second.abort()
  finish(reply(queued))
  await Promise.all([task1, task2])
  expect(fetch.mock.calls.map(([, options]) => options.method)).toEqual(['POST', 'DELETE'])
})

it('aborts in-flight polling and releases once with a fresh signal', async () => {
  let pollingSignal!: AbortSignal
  const fetch = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
    if (options.method === 'POST') return reply(queued)
    if (options.method === 'DELETE') return deleted()
    pollingSignal = options.signal as AbortSignal
    return new Promise((_resolve, reject) => pollingSignal.addEventListener('abort', () => reject(pollingSignal.reason), { once: true }))
  })
  vi.stubGlobal('fetch', fetch)
  const controller = new AbortController()
  const task = reports.runReportScenario('retry', controller.signal, vi.fn())
  await vi.advanceTimersByTimeAsync(200)
  controller.abort(); await task
  expect(pollingSignal.aborted).toBe(true)
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'DELETE')).toHaveLength(1)
  expect(fetch.mock.calls.at(-1)![1].signal!.aborted).toBe(false)
})

it('does not start cancelled work and stops on refused API requests', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })))
  await reports.runReportScenario('retry', AbortSignal.abort(), vi.fn())
  expect(fetch).not.toHaveBeenCalled()
  await expect(reports.runReportScenario('retry', new AbortController().signal, vi.fn())).rejects.toThrow('503')
  await vi.advanceTimersByTimeAsync(30_000)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('stops if the API swaps identity and still cleans up the original run', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply(queued)).mockResolvedValueOnce(reply({ ...ready, messageId: 'different' })).mockResolvedValue(deleted())
  vi.stubGlobal('fetch', fetch)
  const assertion = expect(reports.runReportScenario('retry', new AbortController().signal, vi.fn())).rejects.toThrow('identity changed')
  await vi.advanceTimersByTimeAsync(200); await assertion
  expect(fetch.mock.calls.at(-1)![0]).toBe('/api/reports/runs/job-1')
  expect(fetch.mock.calls.at(-1)![1].method).toBe('DELETE')
})

it('times out unfinished work at 20 seconds and releases it', async () => {
  const fetch = vi.fn().mockImplementation(async (_url, options) => options.method === 'DELETE' ? deleted() : reply(queued))
  vi.stubGlobal('fetch', fetch)
  const assertion = expect(reports.runReportScenario('retry', new AbortController().signal, vi.fn())).rejects.toThrow('20 seconds')
  await vi.advanceTimersByTimeAsync(20_000); await assertion
  const count = fetch.mock.calls.length
  await vi.advanceTimersByTimeAsync(10_000)
  expect(fetch).toHaveBeenCalledTimes(count)
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'DELETE')).toHaveLength(1)
})

it.each(['network', 'http'])('retains failed %s cleanup and requires successful DELETE before another POST', async failure => {
  const fetch = vi.fn().mockResolvedValueOnce(reply(ready))
  if (failure === 'network') fetch.mockRejectedValueOnce(new Error('offline'))
  else fetch.mockResolvedValueOnce(new Response(null, { status: 503 }))
  fetch.mockResolvedValueOnce(deleted()).mockResolvedValueOnce(reply(ready)).mockResolvedValue(deleted())
  vi.stubGlobal('fetch', fetch)
  await expect(reports.runReportScenario('retry', new AbortController().signal, vi.fn())).rejects.toThrow('Cleanup was not confirmed')
  await vi.advanceTimersByTimeAsync(10_000)
  expect(fetch).toHaveBeenCalledTimes(2)
  await reports.runReportScenario('retry', new AbortController().signal, vi.fn())
  expect(fetch.mock.calls.map(([, options]) => options.method)).toEqual(['POST', 'DELETE', 'DELETE', 'POST', 'DELETE'])
})

it('times out cleanup after five seconds, stopping the next start if cleanup still fails', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply(ready)).mockImplementation((_url, options: RequestInit) => new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })))
  vi.stubGlobal('fetch', fetch)
  const assertion = expect(reports.runReportScenario('retry', new AbortController().signal, vi.fn())).rejects.toThrow('Cleanup was not confirmed')
  await vi.advanceTimersByTimeAsync(5000); await assertion
  const next = expect(reports.runReportScenario('subscribe', new AbortController().signal, vi.fn())).rejects.toThrow('Cleanup was not confirmed')
  await vi.advanceTimersByTimeAsync(5000); await next
  expect(fetch.mock.calls.map(([, options]) => options.method)).toEqual(['POST', 'DELETE', 'DELETE'])
})

it('cleans malformed snapshots with usable IDs instead of losing the run', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: 'known-id' }))).mockResolvedValue(deleted())
  vi.stubGlobal('fetch', fetch)
  await expect(reports.runReportScenario('retry', new AbortController().signal, vi.fn())).rejects.toThrow('Unexpected report response')
  expect(fetch.mock.calls.at(-1)![0]).toBe('/api/reports/runs/known-id')
  expect(fetch.mock.calls.at(-1)![1].method).toBe('DELETE')
})

it.each(['network', 'missing ID', 'invalid JSON', 'timeout'])('blocks every later start after unknown creation: %s', async failure => {
  const fetch = vi.fn()
  if (failure === 'network') fetch.mockRejectedValue(new Error('offline'))
  else if (failure === 'missing ID') fetch.mockResolvedValue(new Response('{}'))
  else if (failure === 'invalid JSON') fetch.mockResolvedValue(new Response('invalid'))
  else fetch.mockImplementation((_url, options: RequestInit) => new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })))
  vi.stubGlobal('fetch', fetch)
  const assertion = expect(reports.runReportScenario('retry', new AbortController().signal, vi.fn())).rejects.toBeInstanceOf(reports.UnconfirmedReportCreation)
  if (failure === 'timeout') await vi.advanceTimersByTimeAsync(20_000)
  await assertion
  await expect(reports.runReportScenario('publish', new AbortController().signal, vi.fn())).rejects.toThrow('Wait 90 seconds')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('rejects malformed report snapshots and accepts subscribe mode', () => {
  expect(() => reports.parseReportRun({})).toThrow('Unexpected report response')
  expect(() => reports.parseReportRun({ ...queued, events: [{ sequence: 1 }] })).toThrow('Unexpected report response')
  expect(() => reports.parseReportRun({ ...queued, attempts: -1 })).toThrow('Unexpected report response')
  expect(() => reports.parseReportRun({ ...queued, status: 'Pretend' })).toThrow('Unexpected report response')
  expect(reports.parseReportRun({ ...queued, mode: 'subscribe' }).mode).toBe('subscribe')
})
