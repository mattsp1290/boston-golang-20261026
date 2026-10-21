export type ReportMode = 'publish' | 'subscribe' | 'router' | 'retry' | 'durable'
export type ReportEvent = { sequence: number; kind: string; detail: string; at: string }
export type ReportRun = {
  id: string
  mode: ReportMode
  status: 'Queued' | 'Processing' | 'Ready' | 'Error'
  attempts: number
  messageId: string
  events: ReportEvent[]
  csv?: string
  error?: string
}

const modes: ReportMode[] = ['publish', 'subscribe', 'router', 'retry', 'durable']
const statuses = ['Queued', 'Processing', 'Ready', 'Error']

export function parseReportRun(data: unknown): ReportRun {
  if (typeof data !== 'object' || data === null) throw new Error('Unexpected report response')
  const run = data as ReportRun
  if (typeof run.id !== 'string' || !run.id || !modes.includes(run.mode) || !statuses.includes(run.status)
    || typeof run.messageId !== 'string' || !run.messageId || !Number.isInteger(run.attempts) || run.attempts < 0
    || !Array.isArray(run.events) || !run.events.every(event => event && Number.isInteger(event.sequence)
      && typeof event.kind === 'string' && typeof event.detail === 'string' && typeof event.at === 'string')
    || (run.csv !== undefined && typeof run.csv !== 'string') || (run.error !== undefined && typeof run.error !== 'string')) {
    throw new Error('Unexpected report response')
  }
  return run
}

async function readResponse(response: Response): Promise<ReportRun> {
  if (!response.ok) throw new Error(`Report API request failed (${response.status})`)
  return parseReportRun(await response.json())
}

export function reportDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const cancel = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, milliseconds)
    signal.addEventListener('abort', cancel, { once: true })
  })
}

// All slide instances (including StrictMode remounts) share one serial gate. A
// cancelled creation still owns the gate until its late ID has been cleaned up.
let runGate: Promise<unknown> = Promise.resolve()
let pendingCleanup: string | undefined
export class UnconfirmedReportCreation extends Error {}
let uncertainCreation: UnconfirmedReportCreation | undefined

async function releaseRun(id: string) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Cleanup timed out after 5 seconds.')), 5000)
  try {
    // Never reuse the already-aborted navigation/polling signal.
    const response = await fetch(`/api/reports/runs/${encodeURIComponent(id)}`, {
      method: 'DELETE', keepalive: true, signal: controller.signal,
    })
    if (!response.ok) throw new Error(`API returned ${response.status}`)
    pendingCleanup = undefined
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'No response from the API'
    throw new Error(`Cleanup was not confirmed. Replay is stopped to avoid overlapping runs. ${reason}`)
  } finally {
    clearTimeout(timer)
  }
}

async function executeScenario(mode: ReportMode, signal: AbortSignal, update: (run: ReportRun) => void): Promise<ReportRun | undefined> {
  if (signal.aborted) return
  if (uncertainCreation) throw uncertainCreation
  // A manual retry or later slide entry may retry cleanup, but never blindly POST.
  if (pendingCleanup) await releaseRun(pendingCleanup)
  if (signal.aborted) return

  const controller = new AbortController()
  const creation = new AbortController()
  let id: string | undefined
  const cancel = () => controller.abort(signal.reason)
  signal.addEventListener('abort', cancel, { once: true })
  const deadline = setTimeout(() => {
    const error = new Error('The report did not finish within 20 seconds.')
    controller.abort(error)
    creation.abort(error)
  }, 20_000)
  try {
    // Intentionally independent of navigation: retain the response's ID even if
    // this slide has left. A response lost to the network has an unknown outcome.
    let response: Response
    try {
      response = await fetch('/api/reports/runs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }),
        signal: creation.signal,
      })
    } catch (error) {
      uncertainCreation = new UnconfirmedReportCreation(`The API did not confirm whether a report was created. ${error instanceof Error ? error.message : ''} Wait 90 seconds for API expiry, then reload the deck.`)
      throw uncertainCreation
    }
    if (!response.ok) throw new Error(`Report API request failed (${response.status})`)
    let data: unknown
    try {
      data = await response.json()
      if (typeof data === 'object' && data !== null && 'id' in data && typeof data.id === 'string' && data.id) {
        id = data.id
        pendingCleanup = id
      }
      if (!id) throw new Error('The API returned no report ID.')
    } catch (error) {
      uncertainCreation = new UnconfirmedReportCreation(`The API returned no usable report ID. ${error instanceof Error ? error.message : ''} Wait 90 seconds for API expiry, then reload the deck.`)
      throw uncertainCreation
    }
    let run = parseReportRun(data)
    if (controller.signal.aborted) { if (!signal.aborted) throw controller.signal.reason; return }
    if (run.mode !== mode) throw new Error('The API returned a different report mode.')
    const messageId = run.messageId
    while (!controller.signal.aborted) {
      update(run)
      if (run.status === 'Ready' || run.status === 'Error') return run
      await reportDelay(200, controller.signal)
      run = await readResponse(await fetch(`/api/reports/runs/${encodeURIComponent(id)}`, { signal: controller.signal }))
      if (run.id !== id || run.mode !== mode || run.messageId !== messageId) throw new Error('The report identity changed unexpectedly.')
    }
  } catch (error) {
    if (!signal.aborted) throw (error instanceof UnconfirmedReportCreation ? error : controller.signal.aborted ? controller.signal.reason : error)
  } finally {
    clearTimeout(deadline)
    signal.removeEventListener('abort', cancel)
    // Await success before releasing the gate. Failure preserves pendingCleanup.
    if (id) await releaseRun(id)
  }
}

/** One finite run, settled only after the API confirms its worker is cleaned up. */
export function runReportScenario(mode: ReportMode, signal: AbortSignal, update: (run: ReportRun) => void): Promise<ReportRun | undefined> {
  const task = runGate.then(() => executeScenario(mode, signal, update))
  runGate = task.catch(() => { /* Next entry checks retained cleanup/uncertainty. */ })
  return task
}
