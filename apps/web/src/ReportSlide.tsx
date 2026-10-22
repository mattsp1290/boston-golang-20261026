import { useEffect, useState } from 'react'
import { useReveal } from '@revealjs/react'
import { reportDelay, runReportScenario, UnconfirmedReportCreation } from './reports'
import type { ReportMode, ReportRun } from './reports'
import { reportVisual } from './reportVisual'
import type { ReportVisual } from './reportVisual'
import { ReportFlow } from './ReportFlow'
import './ReportSlide.css'

export type ReportStory = {
  mode: ReportMode
  step: string
  title: string
  accent: string
  explanation: string
  concept: string
  boundary: string
  source: string
}

/** Short presentation copy, projected from the unchanged API evidence mapping. */
function observedState(mode: ReportMode, visual: ReportVisual) {
  if (visual.failed) return 'Demo paused.'
  if (visual.stage === 'Connecting') return 'Waiting for the API.'
  if (mode === 'publish') return visual.available ? 'Message available.' : visual.published ? 'Published. Awaiting availability.' : 'Request accepted.'
  if (mode === 'durable') {
    if (visual.ready) return 'Delivered after reconnect.'
    if (visual.received) return 'Saved message received.'
    if (visual.consumerOnline) return 'Subscriber + Router started.'
    if (visual.databaseReopened) return 'Database reconnected.'
    if (visual.databaseClosed) return 'Connections closed.'
    return visual.published ? 'Request stored.' : 'Subscriber + Router not started.'
  }
  if (mode === 'retry') {
    if (visual.ready) return `Succeeded on call ${visual.attempts}.`
    if (visual.retrying) return `Call ${visual.attempts} returned an error.`
    if (visual.working) return `Handler call ${visual.attempts}.`
    return 'Waiting for a handler call.'
  }
  return visual.ready ? 'CSV ready.' : visual.working ? 'Handler is running.' : 'Awaiting delivery.'
}

export function LiveReport({ mode }: { mode: ReportMode }) {
  const [run, setRun] = useState<ReportRun | null>(null)
  const [error, setError] = useState('')
  const [retryable, setRetryable] = useState(true)
  const [restart, setRestart] = useState(0)
  const [countdown, setCountdown] = useState<number | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal
    async function repeat() {
      try {
        while (!signal.aborted) {
          setRun(null); setError(''); setCountdown(null); setRetryable(true)
          const result = await runReportScenario(mode, signal, next => { if (!signal.aborted) setRun(next) })
          if (signal.aborted || !result) return
          if (result.status === 'Error' || result.error) return
          // The completed result remains visible. Start the hold only after DELETE
          // confirms cleanup, and cancel the countdown immediately when leaving.
          for (let remaining = 4; remaining > 0; remaining--) {
            if (signal.aborted) return
            setCountdown(remaining)
            await reportDelay(1000, signal)
          }
        }
      } catch (failure) {
        if (!signal.aborted) {
          setCountdown(null)
          setRetryable(!(failure instanceof UnconfirmedReportCreation))
          setError(failure instanceof Error ? failure.message : 'The report could not run.')
        }
      }
    }
    void repeat()
    return () => controller.abort()
  }, [mode, restart])
  const failed = error || run?.error || (run?.status === 'Error' ? 'The demo stopped.' : '')
  const visual = reportVisual(mode, run, !!failed)
  return <div className={`report-live ${failed ? 'is-failed' : ''} ${visual.complete && !failed ? 'is-complete' : ''}`} aria-label="Live report demo">
    <div className="report-state" role="status" aria-live="polite">
      <h3>{observedState(mode, visual)}</h3><span className="report-sr-only">{visual.detail}</span>
    </div>
    <ReportFlow mode={mode} visual={visual} csv={run?.status === 'Ready' && !failed ? run.csv : undefined} />
    {mode === 'durable' && !failed && <p className="report-scope">Database reconnect only</p>}
    {countdown !== null && !failed && <p className="report-repeat" aria-label="Replay status">Replay in {countdown}…</p>}
    {failed && <div className="report-error" role="alert"><p>{failed}</p>{retryable && <button className="report-replay" type="button" onClick={() => setRestart(value => value + 1)}>Try again ↻</button>}</div>}
    {run?.messageId && <span className="report-sr-only" aria-label="Message identity">Message ID: {run.messageId}</span>}
  </div>
}

export default function ReportSlide({ story }: { story: ReportStory }) {
  const deck = useReveal()
  const [active, setActive] = useState(false)
  useEffect(() => {
    if (!deck) return
    const update = () => setActive(deck.getCurrentSlide()?.id === `report-${story.mode}` && !deck.isOverview())
    update()
    deck.on('slidechanged', update); deck.on('overviewshown', update); deck.on('overviewhidden', update)
    return () => { deck.off('slidechanged', update); deck.off('overviewshown', update); deck.off('overviewhidden', update) }
  }, [deck, story.mode])
  return <div className="report-story">
    <div className="report-heading"><h2>{story.title}{story.accent && <> <span className="accent">{story.accent}</span></>}</h2></div>
    {active ? <LiveReport mode={story.mode} /> : <div className="report-live report-idle">
      <div className="report-state"><h3>Ready to run.</h3></div>
      <ReportFlow mode={story.mode} visual={reportVisual(story.mode, null)} />
      {story.mode === 'durable' && <p className="report-scope">Database reconnect only</p>}
    </div>}
  </div>
}
