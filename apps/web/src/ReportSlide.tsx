import { useEffect, useRef, useState } from 'react'
import { useReveal } from '@revealjs/react'
import { runReportScenario } from './reports'
import type { ReportMode, ReportRun } from './reports'
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
  return /\.Publish\(|AddNoPublisherHandler|middleware\.Retry|MaxRetries:|pub\.Close|db\.Close|openReportDB|NewSubscriber|return nil/.test(line)
}

function eventName(kind: string) { return kind.replace(/[_-]/g, ' ') }
function seconds(at: string, first?: string) {
  const elapsed = Date.parse(at) - Date.parse(first ?? at)
  return Number.isFinite(elapsed) ? `+${Math.max(0, elapsed / 1000).toFixed(1)}s` : ''
}

export function LiveReport({ mode }: { mode: ReportMode }) {
  const [run, setRun] = useState<ReportRun | null>(null)
  const [error, setError] = useState('')
  const [replay, setReplay] = useState(0)
  const timeline = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    void runReportScenario(mode, controller.signal, next => {
      if (!controller.signal.aborted) setRun(next)
    }).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'The report could not run.')
    })
    return () => controller.abort()
  }, [mode, replay])
  useEffect(() => { if (timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight }, [run?.events.length])
  const failed = error || run?.error || (run?.status === 'Error' ? 'The report worker stopped.' : '')
  const status = failed ? 'Error' : run?.status ?? 'Connecting'
  return <div className="report-live" aria-label="Live report demo">
    <header className="report-live-header"><div><span className="report-label">LIVE GO API</span><h3>Weekly team report</h3></div><button className="report-replay" type="button" onClick={() => { setRun(null); setError(''); setReplay(value => value + 1) }}>Replay ↻</button></header>
    <div className="report-state" role="status"><span className={`report-status status-${status.toLowerCase()}`}>{status}</span><span>{run ? `Attempt ${run.attempts}` : 'Starting one finite run…'}</span></div>
    <div className="report-identity"><span>ONE MESSAGE ID</span><code title={run?.messageId}>{run?.messageId ?? 'Waiting for the API…'}</code></div>
    <ol className="report-timeline" aria-label="Server event timeline" aria-live="polite" ref={timeline}>
      {run?.events.map(event => <li key={event.sequence} className={`event-${event.kind.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`}><span className="report-event-time">{seconds(event.at, run.events[0]?.at)}</span><div><strong>{eventName(event.kind)}</strong><p>{event.detail}</p></div></li>)}
      {!run && !failed && <li className="report-placeholder">Waiting for real server events, not simulated progress.</li>}
    </ol>
    {failed ? <div className="report-error" role="alert"><strong>Demo stopped</strong><p>{failed}</p><p>Start the Go API, then choose Replay. No automatic retry loop.</p></div>
      : run?.status === 'Ready' ? <div className="report-artifact"><span className="report-label">GENERATED CSV · SYNTHETIC DATA</span><pre aria-label="Generated report CSV">{run.csv || 'The API returned no CSV.'}</pre></div>
        : <div className="report-artifact report-artifact-pending"><span className="report-label">REPORT OUTPUT</span><p>The CSV appears only when the worker finishes.</p></div>}
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
      {active ? <LiveReport mode={story.mode} /> : <div className="report-live report-idle"><span className="report-label">LIVE DEMO</span><h3>Watch the report happen.</h3><p>Starts automatically on slide entry. Leaving or opening overview cancels the run.</p><span className="report-idle-states">Queued → Processing → Ready</span></div>}
    </div>
  </div>
}
