import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { parseReportRun, runReportScenario } from './reports'
import type { ReportRun } from './reports'

const queued: ReportRun = { id: 'job-1', mode: 'retry', status: 'Queued', attempts: 0, messageId: 'message-1', events: [{ sequence: 1, kind: 'queued', detail: 'Accepted', at: '2026-10-26T10:00:00Z' }] }
const ready: ReportRun = { ...queued, status: 'Ready', attempts: 3, csv: 'region,total\nBoston,42\n' }
const reply = (run: ReportRun) => new Response(JSON.stringify(run))
const flush = async () => { for (let index = 0; index < 10; index++) await Promise.resolve() }
beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('publishes once, observes the same report, stops polling at Ready, and releases it', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply(queued)).mockResolvedValueOnce(reply(ready)).mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  const update = vi.fn()
  const task = runReportScenario('retry', new AbortController().signal, update)
  await vi.advanceTimersByTimeAsync(200)
  await task
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ mode: 'retry' }) })
  expect(update.mock.calls.map(([run]) => run.status)).toEqual(['Queued', 'Ready'])
  expect(fetch.mock.calls[2][1]).toMatchObject({ method: 'DELETE', keepalive: true })
  expect(fetch.mock.calls[2][1].signal.aborted).toBe(false)
  await vi.advanceTimersByTimeAsync(3000)
  expect(fetch).toHaveBeenCalledTimes(3)
})

it('cleans up a creation that completes after navigation, without any stale update', async () => {
  let complete!: (response: Response) => void
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve })).mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  const controller = new AbortController()
  const update = vi.fn()
  const task = runReportScenario('retry', controller.signal, update)
  controller.abort()
  complete(reply(queued))
  await task
  expect(update).not.toHaveBeenCalled()
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(fetch.mock.calls[1][0]).toBe('/api/reports/runs/job-1')
  expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'DELETE' })
  expect(fetch.mock.calls[1][1].signal.aborted).toBe(false)
})

it('aborts in-flight polling and releases once with a fresh signal', async () => {
  let pollingSignal!: AbortSignal
  const fetch = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
    if (options.method === 'POST') return reply(queued)
    if (options.method === 'DELETE') return new Response(null, { status: 204 })
    pollingSignal = options.signal as AbortSignal
    return new Promise((_resolve, reject) => pollingSignal.addEventListener('abort', () => reject(pollingSignal.reason), { once: true }))
  })
  vi.stubGlobal('fetch', fetch)
  const controller = new AbortController()
  const task = runReportScenario('retry', controller.signal, vi.fn())
  await vi.advanceTimersByTimeAsync(200)
  controller.abort()
  await task
  expect(pollingSignal.aborted).toBe(true)
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'DELETE')).toHaveLength(1)
  expect(fetch.mock.calls.at(-1)![1].signal!.aborted).toBe(false)
})

it('stops on API failures instead of retrying indefinitely', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })))
  await expect(runReportScenario('retry', new AbortController().signal, vi.fn())).rejects.toThrow('503')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('stops if the API swaps the message identity', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply(queued)).mockResolvedValueOnce(reply({ ...ready, messageId: 'different' })).mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  const task = runReportScenario('retry', new AbortController().signal, vi.fn())
  const assertion = expect(task).rejects.toThrow('identity changed')
  await vi.advanceTimersByTimeAsync(200)
  await assertion
  expect(fetch.mock.calls.at(-1)![1].method).toBe('DELETE')
})

it('times out a non-finishing run at 20 seconds and releases it', async () => {
  const fetch = vi.fn().mockImplementation(async (_url, options) => options.method === 'DELETE' ? new Response(null, { status: 204 }) : reply(queued))
  vi.stubGlobal('fetch', fetch)
  const task = runReportScenario('retry', new AbortController().signal, vi.fn())
  const assertion = expect(task).rejects.toThrow('20 seconds')
  await vi.advanceTimersByTimeAsync(20_000)
  await assertion
  const count = fetch.mock.calls.length
  await vi.advanceTimersByTimeAsync(2000)
  expect(fetch).toHaveBeenCalledTimes(count)
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'DELETE')).toHaveLength(1)
})

it('does not start already cancelled work and tolerates DELETE network failure', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply(ready)).mockRejectedValueOnce(new Error('offline'))
  vi.stubGlobal('fetch', fetch)
  await runReportScenario('retry', AbortSignal.abort(), vi.fn())
  expect(fetch).not.toHaveBeenCalled()
  await runReportScenario('retry', new AbortController().signal, vi.fn())
  await flush()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('rejects malformed report snapshots', () => {
  expect(() => parseReportRun({})).toThrow('Unexpected report response')
  expect(() => parseReportRun({ ...queued, events: [{ sequence: 1 }] })).toThrow('Unexpected report response')
  expect(() => parseReportRun({ ...queued, attempts: -1 })).toThrow('Unexpected report response')
  expect(() => parseReportRun({ ...queued, status: 'Pretend' })).toThrow('Unexpected report response')
})
