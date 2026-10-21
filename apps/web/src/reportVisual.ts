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
  const databaseClosed = durable && observed.has('db-closed') && !observed.has('db-reopened')
  const databaseReopened = durable && observed.has('db-reopened')
  const storedMessage = durable && published && !received && !ready
  // Closing a pool proves only closure. Reading the original message after a
  // reconnect is the end-to-end evidence that the database retained it.
  const retentionObserved = durable && databaseReopened && observed.has('db-closed') && received
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
    if (offline) { stage = 'Consumer offline'; headline = published ? 'Stored in PostgreSQL. Consumer offline.' : 'No consumer has started.' }
    if (databaseClosed) { stage = 'Connections closed'; headline = 'Connections closed. Consumer still offline.' }
    if (databaseReopened && !received) { stage = 'Database reconnected'; headline = 'Fresh connection pool. Same database.' }
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
    transport: durable ? 'Message publication in PostgreSQL was observed.' : available ? 'Message availability was observed in a live subscriber channel.' : 'Publication observed in GoChannel.',
    subscriber: 'Message published; Subscriber delivery has not yet been observed.', handler: ready ? 'Application handler completed for the same message.' : 'The same message is at the application handler.',
    consumer: 'The saved message reached the consumer.',
  }[token]
  const detail = [location,
    working ? `Application handler call ${attempts} is processing.` : retrying ? `Call ${attempts} failed; waiting for the next call to the same handler.` : '',
    offline ? 'Consumer offline; no receipt or startup event yet.' : '',
    databaseClosed ? 'This run’s database connection pool is closed; receipt after reconnect has not been observed yet.' : '',
    retentionObserved ? 'The original message was received after closing and reopening the database connections; retention observed.' : '',
    databaseReopened ? 'A fresh pool reconnected to the same PostgreSQL database.' : '',
    !publication ? acknowledged ? 'Explicit Ack event observed.' : 'No explicit Ack event observed; the Router acknowledgement contract is not a measured event.' : 'This GoChannel configuration requires a live subscription and does not retain messages for offline subscribers.',
    failed ? 'Automatic replay paused.' : '',
  ].filter(Boolean).join(' ')
  return { stage, headline, detail, token, messageId: run?.messageId, transport: durable ? 'postgres' as const : 'memory' as const, published, available, received, acknowledged, ready, complete, failed, working, consumerOnline, executionState, offline, storedMessage, databaseClosed, databaseReopened, retentionObserved, retrying, attempts, failedAttempts }
}

export type ReportVisual = ReturnType<typeof reportVisual>
