import { useEffect, useState } from 'react'
import { useReveal } from '@revealjs/react'
import { reportDelay, runReportScenario, UnconfirmedReportCreation } from './reports'
import type { ReportMode, ReportRun } from './reports'
import { reportVisual } from './reportVisual'
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
  return /\.Publish\(|\.Subscribe\(|<-incoming|\.Ack\(|\.Nack\(|AddNoPublisherHandler|middleware\.Retry|MaxRetries:|pub\.Close|db\.Close|openReportDB|NewSubscriber|return nil/.test(line)
}

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
  const failed = error || run?.error || (run?.status === 'Error' ? 'The report worker stopped.' : '')
  const visual = reportVisual(mode, run)
  const status = failed ? 'Error' : visual.stage
  return <div className={`report-live ${failed ? 'is-failed' : ''}`} aria-label="Live report demo">
    <header className="report-live-header"><span className="report-label">LIVE GO API · WEEKLY TEAM REPORT</span><span className="report-cycle">RUN {cycle}</span></header>
    <div className={`report-state status-${status.toLowerCase().replaceAll(' ', '-')}`} role="status" aria-live="polite">
      <div className="report-state-copy"><span className="report-status">{status}</span><h3>{failed ? 'The demo stopped.' : visual.headline}</h3><p>{failed ? 'No new run will start automatically.' : visual.detail}</p></div>
      <div className="report-attempt"><strong>{String(run?.attempts ?? 0).padStart(2, '0')}</strong><span>HANDLER<br />ATTEMPT{run?.attempts === 1 ? '' : 'S'}</span></div>
    </div>
    <ol className="report-stages" aria-label="Report progress">
      {visual.steps.map((step, index) => <li key={step.label} className={`${step.current && !failed ? 'is-current' : ''} ${step.reached ? 'is-reached' : ''}`} aria-current={step.current && !failed ? 'step' : undefined}><span className="report-stage-marker" aria-hidden="true">{step.reached && !step.current ? '✓' : index + 1}</span><span>{step.label}</span></li>)}
    </ol>
    <div className="report-repeat" aria-label="Replay status">{failed ? 'Automatic replay paused' : countdown !== null ? `Next run in ${countdown}s · completed result held on screen` : run?.status === 'Ready' ? 'Report complete · confirming cleanup before the next run' : 'Repeats while this slide is active · stops when you leave'}</div>
    {failed ? <div className="report-error" role="alert"><p>{failed}</p>{retryable && <button className="report-replay" type="button" onClick={() => setRestart(value => value + 1)}>Try again ↻</button>}</div>
      : run?.status === 'Ready' ? <div className="report-artifact"><span className="report-label">GENERATED CSV · SYNTHETIC DATA</span><pre aria-label="Generated report CSV">{run.csv || 'The API returned no CSV.'}</pre></div>
        : <div className="report-artifact report-artifact-pending"><span className="report-label">REPORT OUTPUT</span><p>The CSV appears only when the worker finishes.</p></div>}
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
    <div className="report-heading"><p className="eyebrow">ONE REPORT. ONE NEW IDEA.</p><h2>{story.title}<br /><span className="accent">{story.accent}</span></h2><p className="report-explanation">{story.explanation}</p></div>
    <div className="report-columns"><div className="report-lesson"><div className="report-code-heading"><span className="report-label">{story.mode === 'durable' ? 'GO SOURCE · ERROR CHECKS FOLDED' : 'ACTUAL RUNNING GO SOURCE'}</span><span>{story.mode === 'durable' ? 'SQLite · beta' : 'GoChannel · in memory'}</span></div><pre className="report-source" aria-label={`Actual Go ${story.mode} implementation`}><code>{story.source.split('\n').map((line, index) => <span key={index} className={keySourceLine(line) ? 'report-code-line is-emphasized' : 'report-code-line'}>{line || ' '}</span>)}</code></pre><p className="report-concept">{story.concept}</p><p className="report-boundary">{story.boundary}</p></div>
      {active ? <LiveReport mode={story.mode} /> : <div className="report-live report-idle"><span className="report-label">LIVE DEMO</span><h3>Watch the report happen.</h3><p>Starts automatically on slide entry and repeats after a four-second result hold. Leaving or opening overview cancels the run.</p><span className="report-idle-states">{story.mode === 'durable' ? 'Worker offline → Saved on disk → Worker starts → Ready' : story.mode === 'retry' ? 'Queued → Processing → Retrying → Ready' : 'Queued → Processing → Ready'}</span></div>}
    </div>
  </div>
}
