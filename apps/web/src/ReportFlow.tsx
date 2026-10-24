import { useId } from 'react'
import type { ReportMode } from './reports'
import type { ReportVisual } from './reportVisual'

type FlowProps = { visual: ReportVisual; arrow: string }


function MessageToken({ visual, x, y }: { visual: ReportVisual; x: number; y: number }) {
  if (visual.token === 'none') return null
  return <g className={`flow-message ${visual.failed ? 'is-paused' : ''}`} transform={`translate(${x} ${y})`} style={{ transform: `translate(${x}px, ${y}px)` }} data-testid="message-token" data-location={visual.token} data-message-id={visual.messageId}>
    <title>{`Message ${visual.messageId}`}</title>
    <path className="flow-message-paper" d="M -35 -44 H 15 L 35 -24 V 44 H -35 Z" />
    <text className="flow-message-label" x="0" y="96">ID: {visual.messageId?.slice(0, 6)}</text>
    <path className="flow-message-fold" d="M 15 -44 V -24 H 35 M -17 -4 H 17 M -17 12 H 17 M -17 28 H 5" />
  </g>
}

function PublishFlow({ visual, arrow }: FlowProps) {
  return <>
    <g className={`flow-station ${visual.token === 'app' ? 'is-active' : ''}`} data-testid="app-node">
      <rect className="flow-equipment" x="130" y="130" width="300" height="260" rx="28" />
      <path className="flow-publish-boundary" d="M 385 300 V 220 M 360 245 L 385 220 L 410 245" />
      <text className="flow-name" x="280" y="445">Publish</text>
    </g>
    <path className={`flow-link ${visual.published ? 'is-observed' : ''}`} d="M 430 260 H 1110" markerEnd={arrow} data-testid="publish-link" />
    <g className={`flow-station ${visual.available ? 'is-complete' : visual.published ? 'is-active' : ''}`} data-testid="transport-node" data-transport="memory">
      <path className="flow-channel" d="M 1110 170 V 370 H 1550 V 170 M 1110 290 H 1170 L 1200 325 H 1460 L 1490 290 H 1550" />
      <text className="flow-name" x="1330" y="445">Subscription</text>
    </g>
    <MessageToken visual={visual} x={visual.token === 'app' ? 280 : 1330} y={260} />
    {visual.available && <text className="flow-result-check" x="1535" y="282" aria-hidden="true">✓</text>}
  </>
}

function RouterFlow({ visual, arrow, manual = false }: FlowProps & { manual?: boolean }) {
  return <>
    <g data-testid={manual ? 'receive-loop-boundary' : 'router-boundary'}>
      <rect className="flow-boundary" x="65" y="65" width="950" height="420" rx="32" />
      <text className="flow-boundary-name" x="540" y="48">{manual ? 'Application receive loop' : 'Router'}</text>
    </g>
    <g className={`flow-station ${visual.published ? 'is-observed' : ''}`} data-testid="subscriber-node">
      <text className="flow-name" x="220" y="185">Subscriber</text>
      <path className="flow-channel" d="M 105 240 V 415 H 335 V 240 M 105 335 H 155 L 180 365 H 260 L 285 335 H 335" />
    </g>
    <path className={`flow-link ${visual.received ? 'is-observed' : ''}`} d="M 370 310 H 610" markerEnd={arrow} data-testid="receive-link" />
    <g className={`flow-station execution-${visual.executionState} ${visual.working ? 'is-working' : ''}`} data-testid="handler-node" data-state={visual.executionState}>
      <text className="flow-name" x="770" y="164">Application</text><text className="flow-name" x="770" y="218">handler</text>
      <rect className="flow-handler" x="630" y="230" width="280" height="230" rx="32" />
      {visual.working && <circle className="flow-work-ring" cx="770" cy="310" r="74" data-testid="work-indicator" />}
    </g>
    <path className={`flow-link ${visual.ready ? 'is-observed' : ''}`} d="M 945 310 H 1095" markerEnd={arrow} data-testid="result-link" />
    <g className={`flow-station ${visual.ready ? 'is-complete' : ''}`} data-testid="result-node" data-ready={visual.ready}>
      <text className="flow-name" x="1400" y="185">CSV</text>
      <path className="flow-result-paper" d="M 1135 220 H 1615 L 1660 265 V 430 H 1135 Z M 1615 220 V 265 H 1660" />
      {!visual.ready && <text className="flow-waiting-mark" x="1400" y="340" aria-label="Not generated">…</text>}
    </g>
    <MessageToken visual={visual} x={visual.token === 'subscriber' ? 220 : 770} y={310} />
    {manual && visual.acknowledged && <g className="report-svg-accessible" data-testid="ack-return"><title>Explicit Ack observed</title></g>}
  </>
}

function RetryFlow({ visual, arrow }: FlowProps) {
  return <>
    <g data-testid="retry-wrapper">
      <text className="flow-loop-name" x="1425" y="167">Retry</text>
      <g className={`flow-retry ${visual.retrying ? 'is-retrying' : ''} ${visual.failedAttempts.length ? 'has-errors' : ''}`} data-testid="retry-loop" data-active={visual.retrying}>
        <path d="M 1040 250 H 1170 Q 1300 250 1300 150 Q 1300 55 1170 55 H 510 Q 380 55 380 150 Q 380 250 510 250 H 640" markerEnd={arrow} />
      </g>
    </g>
    <g className={`flow-station execution-${visual.executionState} ${visual.working ? 'is-working' : ''}`} data-testid="handler-node" data-state={visual.executionState}>
      <text className="flow-name" x="840" y="140">Application handler</text>
      <rect className="flow-handler" x="665" y="165" width="350" height="220" rx="32" />
      {visual.working && <circle key={visual.attempts} className="flow-work-ring" cx="840" cy="240" r="74" data-testid="work-indicator" />}
    </g>
    <MessageToken visual={visual} x={840} y={240} />
    <g className="flow-attempts">{[1, 2, 3].map(number => {
      const failed = visual.failedAttempts.includes(number)
      const done = visual.ready && number === visual.attempts
      const started = number <= visual.attempts
      const outcome = failed ? 'error' : done ? 'success' : started ? visual.failed ? 'stopped' : 'running' : 'pending'
      return <g key={number} transform={`translate(${500 + (number - 1) * 340} 455)`} className={`attempt-${outcome}`} data-attempt={number} data-outcome={outcome}>
        <title>{`Call ${number}: ${outcome}`}</title>
        <rect className="flow-call-badge" x="-140" y="-48" width="280" height="105" rx="22" />
        <text className="flow-call-mark" x="-88" y="22" aria-hidden="true">{failed ? '×' : done ? '✓' : started ? '•' : '−'}</text>
        <text className="flow-call-label" x="28" y="-4">Call {number}</text>
        <text className="flow-call-outcome" x="28" y="36">{outcome}</text>
      </g>
    })}</g>
  </>
}

function DurableFlow({ visual, arrow }: FlowProps) {
  const online = visual.consumerOnline || visual.received || visual.ready
  return <>
    <g className={`flow-station ${visual.storedMessage ? 'is-retained' : visual.published ? 'is-observed' : ''}`} data-testid="transport-node" data-transport="postgres">
      <path className="flow-database" d="M 100 145 C 100 65 620 65 620 145 V 350 C 620 430 100 430 100 350 Z M 100 145 C 100 225 620 225 620 145" />
      <text className="flow-name" x="360" y="62">PostgreSQL</text>
    </g>
    <path className={`flow-link ${visual.databaseClosed ? 'is-disconnected' : ''} ${visual.received ? 'is-observed' : ''}`} d={visual.databaseClosed ? 'M 660 275 H 800 M 940 275 H 1070' : 'M 660 275 H 1070'} markerEnd={visual.databaseClosed ? undefined : arrow} data-testid="receive-link" data-connected={visual.databaseClosed ? false : visual.databaseReopened ? true : undefined} />
    {visual.databaseClosed && <path className="flow-connection-gap" d="M 800 252 V 298 M 785 262 H 800 M 785 288 H 800 M 940 252 V 298 M 940 262 H 955 M 940 288 H 955" aria-label="Application database connections closed" />}
    <g className={`flow-station execution-${visual.executionState} ${visual.working ? 'is-working' : ''}`} data-testid="consumer-node" data-state={visual.executionState}>
      <rect className="flow-equipment" x="1100" y="135" width="560" height="320" rx="32" />
      <text className="flow-name" x="1380" y="210">Subscriber + Router</text>
      <text className="flow-consumer-status" x="1380" y="275">{online ? 'Started' : 'Not started'}</text>
    </g>
    <MessageToken visual={visual} x={visual.token === 'consumer' ? 1380 : 360} y={visual.token === 'consumer' ? 340 : 300} />
    <g className="flow-database-lifecycle" data-testid="database-lifecycle">
      <text x="360" y="500"><tspan className={visual.databaseClosed || visual.databaseReopened ? 'is-observed' : ''}>Close connections</tspan><tspan> → </tspan><tspan className={visual.databaseReopened ? 'is-observed' : ''}>Reconnect</tspan></text>
    </g>
    <text className="flow-context" x="1380" y="500">{visual.retentionObserved ? "Original message received" : "No republish"}</text>
  </>
}

const titles: Record<ReportMode, string> = { publish: 'Publish a message into the existing GoChannel subscription', router: 'Router connects delivery to an application handler', retry: 'Retry middleware calls the same application handler', durable: 'PostgreSQL retains the message across application database reconnection before the Subscriber and Router start', subscribe: 'Subscriber delivery and application receive loop' }

/** One 1680 × 520 composition, displayed 1:1 on the 1920 × 1080 design stage. */
export function ReportFlow({ mode, visual, csv }: { mode: ReportMode; visual: ReportVisual; csv?: string }) {
  const id = useId().replaceAll(':', '')
  const arrow = `url(#${id}-arrow)`
  return <figure className={`report-flow ${visual.failed ? 'is-stopped' : ''}`} data-mode={mode}>
    <div className="report-flow-canvas" tabIndex={visual.failed ? -1 : 0} role="region" aria-label="Observed message flow"><svg viewBox="0 0 1680 520" role="img" aria-labelledby={`${id}-title ${id}-description`}>
      <title id={`${id}-title`}>{titles[mode]}</title><desc id={`${id}-description`}>{visual.detail} Positions illustrate observed API state, not measured transit time.{visual.messageId ? ` Full message ID: ${visual.messageId}.` : ''}</desc>
      <defs><marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 1 1 L 8 5 L 1 9" className="flow-arrow-tip" /></marker></defs>
      {mode === 'publish' ? <PublishFlow visual={visual} arrow={arrow} /> : mode === 'retry' ? <RetryFlow visual={visual} arrow={arrow} /> : mode === 'durable' ? <DurableFlow visual={visual} arrow={arrow} /> : <RouterFlow visual={visual} arrow={arrow} manual={mode === 'subscribe'} />}
    </svg></div>
    <ProgressBeats mode={mode} visual={visual} />
    {(mode === 'router' || mode === 'subscribe') && visual.ready && !visual.failed && <pre className="report-artifact" aria-label="Generated report CSV">{csv || 'No CSV returned.'}</pre>}
  </figure>
}

/** Chapter-specific beats describe evidence, never elapsed animation time. */
function ProgressBeats({ mode, visual }: { mode: ReportMode; visual: ReportVisual }) {
  if (mode === 'retry') return null // The three call badges are this chapter's beats.
  const beats: [string, boolean][] = mode === 'publish'
    ? [['Accepted', !!visual.messageId], ['Published', visual.published], ['Available', visual.available]]
    : mode === 'durable'
      ? [['Stored', visual.published], ['Reconnected', visual.databaseReopened], ['Received', visual.received]]
      : [['Published', visual.published], ['Processing', visual.received], ['Ready', visual.ready]]
  const current = beats.findLastIndex(([, observed]) => observed)
  return <ol className="flow-beats" aria-label="Observed demo steps">{beats.map(([label, observed], index) =>
    <li key={label} className={observed ? index === current ? 'is-current' : 'is-done' : ''} aria-current={index === current ? 'step' : undefined}>
      <span aria-hidden="true">{observed ? '✓' : index + 1}</span>{label}
    </li>)}</ol>
}
