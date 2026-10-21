import type { ReportMode, ReportRun } from './reports'

export type TokenLocation = 'none' | 'app' | 'transport' | 'worker' | 'artifact'
export type WorkerState = 'waiting' | 'offline' | 'online' | 'processing' | 'retrying' | 'complete' | 'error'

/** Project observed snapshots, not a clock-driven simulation of message transit. */
export function reportVisual(mode: ReportMode, run: ReportRun | null, stopped = false) {
  const events = run?.events ?? []
  const observed = new Set(events.map(event => event.kind))
  const latestWork = events.findLast(event => event.kind === 'attempt' || event.kind === 'retry')?.kind
  const failed = stopped || run?.status === 'Error' || !!run?.error
  const ready = run?.status === 'Ready'
  const attempts = run?.attempts ?? 0
  const received = attempts > 0 || observed.has('attempt')
  const acknowledged = observed.has('ack')
  const published = observed.has('published')
  const durable = mode === 'durable'
  // The attempt can race the worker-online event; receipt itself proves startup.
  const workerOnline = observed.has('worker-online')
  const offline = durable && observed.has('worker-offline') && !workerOnline && !received && !ready
  const retrying = mode === 'retry' && latestWork === 'retry' && !ready && !failed
  const working = run?.status === 'Processing' && !retrying && !failed && !offline
  const diskClosed = durable && observed.has('db-closed') && !observed.has('db-reopened')
  const diskRetained = durable && observed.has('db-closed') && !received && !ready
  const failedAttempts: number[] = []
  let attempt = 0
  for (const event of events) {
    if (event.kind === 'attempt') attempt++
    if (event.kind === 'retry' && attempt > 0 && !failedAttempts.includes(attempt)) failedAttempts.push(attempt)
  }

  let token: TokenLocation = !run ? 'none' : 'app'
  if (published || (durable && observed.has('db-closed'))) token = 'transport'
  if (received && !offline) token = 'worker'
  if (ready) token = 'artifact'
  let workerState: WorkerState = offline ? 'offline' : workerOnline ? 'online' : 'waiting'
  if (received && !offline) workerState = 'processing'
  if (retrying) workerState = 'retrying'
  if (ready && !offline) workerState = 'complete'
  if (failed && received && !offline) workerState = 'error'

  let stage = run ? run.status as string : 'Connecting'
  let headline = 'Waiting for the API.'
  if (run) headline = published ? 'Message published. Work is separate.' : 'Request accepted. Work comes next.'
  if (durable && run && offline) {
    stage = 'Worker offline'; headline = published ? 'On disk. No worker needed.' : 'No worker is running.'
  }
  if (diskRetained) {
    stage = 'Saved on disk'; headline = diskClosed ? 'Connections closed. Message preserved.' : 'Same file. Same message.'
  }
  if (durable && workerOnline && !received) {
    stage = 'Worker starts'; headline = 'Worker online. Read the saved message.'
  }
  if (working) {
    stage = 'Processing'; headline = mode === 'subscribe' ? 'Received. Work first, then Ack.' : 'One message. Worker generating the CSV.'
    if (mode === 'retry' && attempts > 1) headline = attempts === 3 ? 'Third attempt. Same message.' : 'Retry the handler, not the publish.'
  }
  if (retrying) { stage = 'Retrying'; headline = 'Temporary error. Same message, try again.' }
  if (ready) { stage = 'Ready'; headline = 'Your report is ready.' }
  if (acknowledged && ready && (mode === 'subscribe' || mode === 'publish')) headline = 'CSV ready. Ack observed.'
  if (failed) { stage = 'Error'; headline = 'The demo stopped.' }

  const location = { none: 'No message observed.', app: 'Accepted request at the app.', transport: durable ? 'Message in SQLite on disk.' : 'Message in the in-memory GoChannel.', worker: 'Same message at the worker.', artifact: 'CSV complete.' }[token]
  const detail = [location, offline ? 'Worker offline; no receipt or worker-online event yet.' : working ? `Worker processing attempt ${attempts}.` : retrying ? `Attempt ${attempts} failed; waiting for the next handler call.` : '', diskRetained ? 'Message retained after all database connections closed.' : '', acknowledged ? 'Explicit Ack event observed.' : 'No explicit Ack event observed.', failed ? 'Automatic replay paused.' : ''].filter(Boolean).join(' ')
  return { stage, headline, detail, token, messageId: run?.messageId, transport: durable ? 'disk' as const : 'memory' as const, published, received, acknowledged, ready, failed, working, workerOnline, workerState, offline, diskRetained, diskClosed, retrying, attempts, failedAttempts }
}

export type ReportVisual = ReturnType<typeof reportVisual>
