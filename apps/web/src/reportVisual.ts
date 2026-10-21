import type { ReportMode, ReportRun } from './reports'

// State labels describe observed API facts, never elapsed-time progress.
export function reportVisual(mode: ReportMode, run: ReportRun | null) {
  const observed = new Set(run?.events.map(event => event.kind))
  const latestWork = run?.events.findLast(event => event.kind === 'attempt' || event.kind === 'retry')?.kind
  const ready = run?.status === 'Ready'
  const processing = run?.status === 'Processing'
  let stage = run ? run.status : 'Connecting'
  let headline = 'Starting the report…'
  let detail = 'Waiting for the Go API. No work is shown until the server confirms it.'
  if (run) {
    headline = 'Your request is queued.'
    detail = 'The API accepted your report request. The worker has not finished the report.'
    if (mode === 'durable' && observed.has('worker-offline')) {
      stage = 'Worker offline'; headline = 'No worker is running.'
      detail = 'The API will publish to a real SQLite file without an active subscriber.'
    }
    if (mode === 'durable' && observed.has('db-closed')) {
      stage = 'Saved on disk'; headline = 'The message is on disk.'
      detail = 'Every database connection is closed. The queued message is preserved.'
    }
    if (mode === 'durable' && observed.has('db-reopened')) {
      detail = 'The same database file is reopened. The message was not republished.'
    }
    if (mode === 'durable' && observed.has('worker-online')) {
      stage = 'Worker starts'; headline = 'A worker is online.'
      detail = 'The subscriber can now receive the message saved in SQLite.'
    }
    if (processing) {
      stage = 'Processing'; headline = 'Generating the report.'
      detail = mode === 'subscribe' ? 'The subscriber received the message and is doing the work before Ack.' : 'The worker is processing the same message that the API accepted.'
      if (mode === 'retry' && run.attempts > 1) headline = run.attempts === 3 ? 'Third attempt. Same message.' : 'Trying the same message again.'
    }
    if (mode === 'retry' && latestWork === 'retry' && !ready) {
      stage = 'Retrying'; headline = 'Temporary error. Try again.'
      detail = 'Retry middleware will call the handler again. No second message is published.'
    }
    if (ready) {
      stage = 'Ready'; headline = 'Your report is ready.'
      detail = mode === 'subscribe' ? 'The subscriber finished the CSV and acknowledged the message.' : 'The worker finished successfully. This CSV came from the Go API.'
    }
  }
  const labels = mode === 'durable' ? ['Worker offline', 'Saved on disk', 'Worker starts', 'Ready']
    : mode === 'retry' ? ['Queued', 'Processing', 'Retrying', 'Ready'] : ['Queued', 'Processing', 'Ready']
  const current = mode === 'durable' && processing ? 'Worker starts' : stage
  const reached = (label: string) => {
    if (label === 'Queued') return !!run
    if (label === 'Processing') return (run?.attempts ?? 0) > 0
    if (label === 'Retrying') return observed.has('retry')
    if (label === 'Worker offline') return observed.has('worker-offline')
    if (label === 'Saved on disk') return observed.has('db-closed')
    if (label === 'Worker starts') return observed.has('worker-online') || processing || ready
    return ready
  }
  return { stage, headline, detail, steps: labels.map(label => ({ label, current: label === current, reached: reached(label) })) }
}

