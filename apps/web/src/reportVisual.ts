import type { ReportMode, ReportRun } from './reports'

export type TokenLocation = 'none' | 'app' | 'transport' | 'subscriber' | 'handler' | 'consumer'
export type ExecutionState = 'waiting' | 'offline' | 'online' | 'processing' | 'retrying' | 'complete' | 'error'

/** Project server evidence into each concept's own diagram, never a simulated pipeline. */
export function reportVisual(mode: ReportMode, run: ReportRun | null, stopped = false) {
  const events = run?.events ?? []
  const observed = new Set(events.map(event => event.kind))
  const publication = mode === 'publish'
  const durable = mode === 'durable'
  const latestWork = events.findLast(event => event.kind === 'attempt' || event.kind === 'retry')?.kind
  const failed = stopped || run?.status === 'Error' || !!run?.error
  const ready = !publication && run?.status === 'Ready'
  const complete = ready || (publication && run?.status === 'Published')
  const attempts = publication ? 0 : run?.attempts ?? 0
  const received = !publication && (attempts > 0 || observed.has('attempt'))
  const acknowledged = !publication && observed.has('ack')
  const published = observed.has('published')
  const available = publication && observed.has('available')
  // Receipt itself proves startup, even if worker-online is logged slightly later.
  const consumerOnline = observed.has('worker-online')
  const offline = durable && observed.has('worker-offline') && !consumerOnline && !received && !ready
  const retrying = mode === 'retry' && latestWork === 'retry' && !ready && !failed
  const working = !publication && run?.status === 'Processing' && received && !retrying && !failed && !offline
  const diskClosed = durable && observed.has('db-closed') && !observed.has('db-reopened')
  const diskReopened = durable && observed.has('db-reopened')
  const diskRetained = durable && observed.has('db-closed') && !received && !ready
  const retentionObserved = durable && observed.has('db-closed')
  const failedAttempts: number[] = []
  let attempt = 0
  for (const event of events) {
    if (event.kind === 'attempt') attempt++
    if (event.kind === 'retry' && attempt > 0 && !failedAttempts.includes(attempt)) failedAttempts.push(attempt)
  }

  let token: TokenLocation = 'none'
  if (run) {
    if (publication) token = published || available ? 'transport' : 'app'
    else if (durable) token = received || ready ? 'consumer' : published || retentionObserved ? 'transport' : 'none'
    else if (mode === 'retry') token = received ? 'handler' : 'none'
    else token = received || ready ? 'handler' : published ? 'subscriber' : 'none'
  }
  let executionState: ExecutionState = offline ? 'offline' : consumerOnline ? 'online' : 'waiting'
  if (received && !offline) executionState = 'processing'
  if (retrying) executionState = 'retrying'
  if (ready && !offline) executionState = 'complete'
  if (failed && received && !offline) executionState = 'error'

  let stage = run ? run.status as string : 'Connecting'
  let headline = 'Waiting for the API.'
  if (publication) {
    if (run) headline = 'Request accepted. Publish next.'
    if (published) headline = 'Published. Waiting for availability.'
    if (available) headline = 'Message became available.'
  } else if (mode === 'retry') {
    if (run) headline = 'One message. One wrapped handler.'
    if (working) headline = attempts === 3 ? 'Third call. Same handler. Same message.' : `Handler call ${attempts}. Same message.`
    if (retrying) { stage = 'Retrying'; headline = `Call ${attempts} failed. Retry the handler.` }
    if (ready) headline = `Handler succeeded after ${attempts} calls.`
  } else if (durable) {
    if (run) headline = 'Store first. Consume later.'
    if (offline) { stage = 'Consumer offline'; headline = published ? 'On disk. Consumer still offline.' : 'No consumer has started.' }
    if (diskRetained) { stage = 'Saved on disk'; headline = diskClosed ? 'Connections closed. Message retained.' : 'Same file reopened. Same message.' }
    if (consumerOnline && !received) { stage = 'Consumer starts'; headline = 'Consumer online. Read the saved message.' }
    if (working) headline = 'The saved message reached the consumer.'
    if (ready) headline = 'Consumed after reopening. No republish.'
  } else {
    if (run) headline = 'Subscriber delivers. Your handler runs.'
    if (working) headline = 'Application handler is running.'
    if (ready) headline = 'Handler succeeded. Result generated.'
    if (mode === 'subscribe' && acknowledged && ready) headline = 'Result generated. Explicit Ack observed.'
  }
  if (failed) { stage = 'Error'; headline = 'The demo stopped.' }

  const location = {
    none: 'No message observed in this concept yet.', app: 'Accepted request at the app.',
    transport: durable ? 'Message retained in SQLite on disk.' : available ? 'Message availability was observed in a live subscriber channel.' : 'Publication observed in GoChannel.',
    subscriber: 'Message published; Subscriber delivery has not yet been observed.', handler: ready ? 'Application handler completed for the same message.' : 'The same message is at the application handler.',
    consumer: 'The saved message reached the consumer.',
  }[token]
  const detail = [location,
    working ? `Application handler call ${attempts} is processing.` : retrying ? `Call ${attempts} failed; waiting for the next call to the same handler.` : '',
    offline ? 'Consumer offline; no receipt or startup event yet.' : '',
    retentionObserved ? 'Database connections closed and the message persisted.' : '',
    diskReopened ? 'The same SQLite file was reopened.' : '',
    !publication ? acknowledged ? 'Explicit Ack event observed.' : 'No explicit Ack event observed; the Router acknowledgement contract is not a measured event.' : 'GoChannel requires a live subscription and does not retain messages for offline subscribers.',
    failed ? 'Automatic replay paused.' : '',
  ].filter(Boolean).join(' ')
  return { stage, headline, detail, token, messageId: run?.messageId, transport: durable ? 'disk' as const : 'memory' as const, published, available, received, acknowledged, ready, complete, failed, working, consumerOnline, executionState, offline, diskRetained, diskClosed, diskReopened, retentionObserved, retrying, attempts, failedAttempts }
}

export type ReportVisual = ReturnType<typeof reportVisual>
