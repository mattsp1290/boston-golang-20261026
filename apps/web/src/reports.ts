export type ReportMode = 'publish' | 'router' | 'retry' | 'durable'
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

const modes: ReportMode[] = ['publish', 'router', 'retry', 'durable']
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

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const cancel = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, milliseconds)
    signal.addEventListener('abort', cancel, { once: true })
  })
}

// A new DELETE request must not reuse the polling signal, which is already aborted.
function releaseRun(id: string) {
  void fetch(`/api/reports/runs/${encodeURIComponent(id)}`, {
    method: 'DELETE', keepalive: true, signal: AbortSignal.timeout(5000),
  }).catch(() => { /* Server expiry is the fallback if a browser goes away. */ })
}

/** One finite run. A cancelled POST may still create work, so read its ID and release it. */
export async function runReportScenario(mode: ReportMode, signal: AbortSignal, update: (run: ReportRun) => void) {
  if (signal.aborted) return
  const controller = new AbortController()
  let id: string | undefined
  let released = false
  const release = () => { if (id && !released) { released = true; releaseRun(id) } }
  const cancel = () => { controller.abort(signal.reason); release() }
  signal.addEventListener('abort', cancel, { once: true })
  const deadline = setTimeout(() => {
    controller.abort(new Error('The report did not finish within 20 seconds.'))
    release()
  }, 20_000)
  try {
    // Intentionally independent of navigation: if creation completes after leaving, its ID
    // is still available for DELETE. This request also has its own finite timeout.
    let run = await readResponse(await fetch('/api/reports/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }),
      signal: AbortSignal.timeout(20_000),
    }))
    id = run.id
    if (controller.signal.aborted) { release(); if (!signal.aborted) throw controller.signal.reason; return }
    if (run.mode !== mode) throw new Error('The API returned a different report mode.')
    const messageId = run.messageId
    while (!controller.signal.aborted) {
      update(run)
      if (run.status === 'Ready' || run.status === 'Error') return
      await delay(200, controller.signal)
      run = await readResponse(await fetch(`/api/reports/runs/${encodeURIComponent(id)}`, { signal: controller.signal }))
      if (run.id !== id || run.mode !== mode || run.messageId !== messageId) throw new Error('The report identity changed unexpectedly.')
    }
  } catch (error) {
    if (!signal.aborted) throw (controller.signal.aborted ? controller.signal.reason : error)
  } finally {
    clearTimeout(deadline)
    signal.removeEventListener('abort', cancel)
    release()
  }
}
