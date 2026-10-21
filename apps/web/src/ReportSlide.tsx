import { useEffect, useState } from 'react'
import { useReveal } from '@revealjs/react'
import { reportDelay, runReportScenario, UnconfirmedReportCreation } from './reports'
import type { ReportMode, ReportRun } from './reports'
import { reportVisual } from './reportVisual'
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

function keySourceLine(line: string) {
  return /\.Publish\(|\.Subscribe\(|<-incoming|\.Ack\(|\.Nack\(|AddConsumerHandler|AddNoPublisherHandler|middleware\.Retry|MaxRetries:|pub\.Close|db\.Close|openReportDB|NewSubscriber|r\.routed|return nil/.test(line)
}

const sourceContext: Record<ReportMode, string> = { publish: 'GoChannel · in memory', subscribe: 'Subscriber · receive loop', router: 'Router · application handler', retry: 'Retry · handler middleware', durable: 'PostgreSQL · Watermill SQL' }

function eventName(kind: string) { return kind.replace(/[_-]/g, ' ') }
function seconds(at: string, first?: string) {
  const elapsed = Date.parse(at) - Date.parse(first ?? at)
  return Number.isFinite(elapsed) ? `+${Math.max(0, elapsed / 1000).toFixed(1)}s` : ''
}

export function LiveReport({ mode }: { mode: ReportMode }) {
  const [run, setRun] = useState<ReportRun | null>(null)
  const [error, setError] = useState('')
  const [retryable, setRetryable] = useState(true)
  const [restart, setRestart] = useState(0)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [cycle, setCycle] = useState(1)
  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal
    async function repeat() {
      let iteration = 0
      try {
        while (!signal.aborted) {
          setRun(null); setError(''); setCountdown(null); setRetryable(true); setCycle(++iteration)
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
  return <div className={`report-live ${failed ? 'is-failed' : ''}`} aria-label="Live report demo">
    <header className="report-live-header"><span className="report-label">LIVE · GO API</span><span className="report-cycle">RUN {cycle}</span></header>
    <div className={`report-state status-${visual.stage.toLowerCase().replaceAll(' ', '-')}`} role="status" aria-live="polite">
      <span className="report-status">{visual.stage}</span><h3>{visual.headline}</h3><span className="report-sr-only">{visual.detail}</span>
    </div>
    <ReportFlow mode={mode} visual={visual} />
    <div className="report-repeat" aria-label="Replay status">{failed ? 'Automatic replay paused' : countdown !== null ? `Next run in ${countdown}s` : visual.complete ? 'Demo complete · confirming cleanup' : 'Auto replay · leaving stops the run'}</div>
    {failed ? <div className="report-error" role="alert"><p>{failed}</p>{retryable && <button className="report-replay" type="button" onClick={() => setRestart(value => value + 1)}>Try again ↻</button>}</div>
      : (mode === 'router' || mode === 'subscribe') && run?.status === 'Ready' ? <div className="report-artifact"><span className="report-label">CSV · SYNTHETIC DATA</span><pre aria-label="Generated report CSV">{run.csv || 'The API returned no CSV.'}</pre></div>
        : (mode === 'router' || mode === 'subscribe') ? <div className="report-artifact report-artifact-pending"><span className="report-label">APPLICATION RESULT</span><span>Waiting for the handler</span></div> : null}
    <details className="report-details"><summary>Technical details · {run?.events.length ?? 0} server events</summary><div className="report-identity"><span>ONE MESSAGE ID</span><code title={run?.messageId}>{run?.messageId ?? 'Waiting for the API…'}</code></div><ol className="report-timeline" aria-label="Server event timeline">
      {run?.events.map(event => <li key={event.sequence}><span className="report-event-time">{seconds(event.at, run.events[0]?.at)}</span><div><strong>{eventName(event.kind)}</strong><p>{event.detail}</p></div></li>)}
      {!run && !failed && <li className="report-placeholder">Waiting for real server events, not simulated progress.</li>}
    </ol></details>
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
    <div className="report-heading"><h2>{story.title} <span className="accent">{story.accent}</span></h2></div>
    <div className="report-columns">
      {active ? <LiveReport mode={story.mode} /> : <div className="report-live report-idle"><header className="report-live-header"><span className="report-label">LIVE DEMO</span><span className="report-cycle">Starts automatically</span></header><div className="report-state"><span className="report-status">Ready to run</span><h3>Follow one message.</h3></div><ReportFlow mode={story.mode} visual={reportVisual(story.mode, null)} /><p className="report-repeat">Starts on entry · repeats after a four-second result hold</p></div>}
      <div className="report-lesson"><div className="report-code-heading"><span className="report-label">{story.mode === 'durable' ? 'GO SOURCE · SETUP & CHECKS FOLDED' : 'ACTUAL GO SOURCE'}</span><span>{sourceContext[story.mode]}</span></div><pre className="report-source" aria-label={`Actual Go ${story.mode} implementation`}><code>{story.source.split('\n').map((line, index) => <span key={index} className={keySourceLine(line) ? 'report-code-line is-emphasized' : 'report-code-line'}>{line || ' '}</span>)}</code></pre><details className="report-lesson-details"><summary>Concept &amp; boundaries</summary><p>{story.explanation}</p><p className="report-concept">{story.concept}</p><p className="report-boundary">{story.boundary}</p></details></div>
    </div>
  </div>
}
