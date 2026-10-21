import { useId } from 'react'
import type { ReportMode } from './reports'
import type { ReportVisual } from './reportVisual'

type FlowProps = { visual: ReportVisual; arrow: string }
const stateLabel = { waiting: 'Waiting', offline: 'OFFLINE', online: 'ONLINE', processing: 'Running', retrying: 'Returned error', complete: 'Succeeded', error: 'Stopped' }

function MessageToken({ visual, x, y = 212 }: { visual: ReportVisual; x: number; y?: number }) {
  if (visual.token === 'none') return null
  return <g className={`flow-message ${visual.failed ? 'is-paused' : ''}`} transform={`translate(${x} ${y})`} style={{ transform: `translate(${x}px, ${y}px)` }} data-testid="message-token" data-location={visual.token} data-message-id={visual.messageId}>
    <title>{`Message ${visual.messageId}`}</title><rect x="-23" y="-19" width="46" height="38" rx="8" /><path d="M -12 -10 H 4 L 12 -2 V 10 H -12 Z M 4 -10 V -2 H 12" /><text x="-1" y="6">1</text>
  </g>
}

function PublishFlow({ visual, arrow }: FlowProps) {
  return <>
    <g className={`flow-station ${visual.token === 'app' ? 'is-active' : ''}`} data-testid="app-node">
      <rect className="flow-card" x="55" y="70" width="260" height="190" rx="20" />
      <text className="flow-name" x="185" y="119">App / request</text><text className="flow-caption" x="185" y="153">{visual.messageId ? 'Request accepted' : 'Waiting for request'}</text>
    </g>
    <path className={`flow-link ${visual.published ? 'is-observed' : ''}`} d="M 318 212 H 559" markerEnd={arrow} data-testid="publish-link" />
    <text className="flow-verb" x="440" y="186">Publish(topic, msg)</text>
    <g className={`flow-station ${visual.available ? 'is-complete' : visual.published ? 'is-active' : ''}`} data-testid="transport-node" data-transport="memory">
      <rect className="flow-card" x="565" y="70" width="260" height="190" rx="20" />
      <text className="flow-name" x="695" y="119">GoChannel</text><text className="flow-caption" x="695" y="153">{visual.available ? 'Availability observed' : visual.published ? 'Published' : 'In-memory transport'}</text>
    </g>
    <MessageToken visual={visual} x={visual.token === 'app' ? 185 : 695} />
    <text className="flow-context" x="440" y="303">Live subscription established before Publish</text>
    <text className="flow-caption" x="440" y="328">Memory only · no offline retention</text>
  </>
}

function RouterFlow({ visual, arrow, manual = false }: FlowProps & { manual?: boolean }) {
  return <>
    <g data-testid={manual ? 'receive-loop-boundary' : 'router-boundary'}>
      <rect className="flow-boundary" x="275" y="33" width="580" height="226" rx="22" />
      <text className="flow-boundary-name" x="302" y="67">{manual ? 'Application receive loop' : 'Router'}</text>
    </g>
    <g className={`flow-station ${visual.published ? 'is-observed' : ''}`} data-testid="subscriber-node">
      <rect className="flow-card" x="23" y="94" width="184" height="145" rx="18" />
      <text className="flow-name" x="115" y="133">Subscriber</text><text className="flow-caption" x="115" y="162">{visual.published && !visual.received ? 'Awaiting delivery' : 'Transport adapter'}</text>
    </g>
    <path className={`flow-link ${visual.received ? 'is-observed' : ''}`} d="M 210 209 H 310" markerEnd={arrow} data-testid="receive-link" />
    <text className="flow-verb" x="259" y="184">deliver</text>
    <g className={`flow-station execution-${visual.executionState} ${visual.working ? 'is-working' : ''}`} data-testid="handler-node" data-state={visual.executionState}>
      <rect className="flow-card" x="316" y="94" width="256" height="145" rx="18" />
      <text className="flow-name" x="444" y="127">Application</text><text className="flow-name" x="444" y="155">handler</text>
      <text className="flow-caption" x="444" y="181">{stateLabel[visual.executionState]}</text>
    </g>
    <path className={`flow-link ${visual.ready ? 'is-observed' : ''}`} d="M 576 209 H 650" markerEnd={arrow} data-testid="result-link" />
    <text className="flow-verb" x="613" y="184">write</text>
    <g className={`flow-station ${visual.ready ? 'is-complete' : ''}`} data-testid="result-node" data-ready={visual.ready}>
      <rect className="flow-card" x="656" y="94" width="176" height="145" rx="18" />
      <text className="flow-name" x="744" y="133">Result</text><text className="flow-caption" x="744" y="162">{visual.ready ? 'CSV generated' : 'Not generated'}</text>{visual.ready && <text className="flow-result-check" x="744" y="222" aria-hidden="true">✓</text>}
    </g>
    <MessageToken visual={visual} x={visual.token === 'subscriber' ? 115 : 444} y={209} />
    {manual ? visual.acknowledged && <g className="flow-ack" data-testid="ack-return"><path d="M 444 265 V 292 H 115 V 248" markerEnd={arrow} /><text className="flow-contract-label" x="444" y="326">Explicit Ack observed</text></g>
      : <g className="flow-contract" data-testid="ack-contract"><path d="M 444 265 V 289 H 115 V 248" markerEnd={arrow} /><text className="flow-contract-label" x="440" y="321">Router contract: nil → Ack · error → Nack</text></g>}
  </>
}

function RetryFlow({ visual, arrow }: FlowProps) {
  return <>
    <g data-testid="retry-wrapper"><rect className="flow-boundary" x="125" y="23" width="630" height="242" rx="24" /><text className="flow-boundary-name" x="151" y="58">Retry middleware</text></g>
    <g className={`flow-retry ${visual.retrying ? 'is-retrying' : ''} ${visual.failedAttempts.length ? 'has-errors' : ''}`} data-testid="retry-loop" data-active={visual.retrying}>
      <path d="M 600 192 H 633 Q 703 192 703 139 Q 703 88 633 88 H 247 Q 177 88 177 139 Q 177 192 247 192 H 280" markerEnd={arrow} />
    </g>
    <g className={`flow-station execution-${visual.executionState} ${visual.working ? 'is-working' : ''}`} data-testid="handler-node" data-state={visual.executionState}>
      <rect className="flow-card" x="286" y="113" width="308" height="122" rx="18" />
      <text className="flow-name" x="440" y="151">Application handler</text><text className="flow-caption" x="440" y="177">Same function · same message</text>
    </g>
    <MessageToken visual={visual} x={440} y={211} />
    <g className="flow-attempts">{[1, 2, 3].map(number => {
      const failed = visual.failedAttempts.includes(number)
      const done = visual.ready && number === visual.attempts
      const started = number <= visual.attempts
      const outcome = failed ? 'error' : done ? 'success' : started ? 'running' : 'pending'
      return <g key={number} transform={`translate(${240 + (number - 1) * 200} 305)`} className={`attempt-${outcome}`} data-attempt={number} data-outcome={outcome}>
        <rect x="-88" y="-27" width="176" height="54" rx="12" /><text x="0" y="-5" className="flow-call-label">Call {number}</text><text x="0" y="17">{failed ? 'error ↻' : done ? 'success ✓' : started ? visual.failed ? 'stopped' : 'running' : 'not called'}</text>
      </g>
    })}</g>
  </>
}

function DurableFlow({ visual, arrow }: FlowProps) {
  const online = visual.consumerOnline || visual.received || visual.ready
  return <>
    <g className={`flow-station ${visual.diskRetained ? 'is-retained' : visual.published ? 'is-observed' : ''}`} data-testid="transport-node" data-transport="disk">
      <path className="flow-card" d="M 55 97 C 55 63 355 63 355 97 V 236 C 355 270 55 270 55 236 Z" />
      <path className="flow-disk-top" d="M 55 97 C 55 131 355 131 355 97" />
      <text className="flow-name" x="205" y="151">SQLite</text><text className="flow-caption" x="205" y="179">File-backed · beta</text>
      {visual.retentionObserved && <g className="flow-retained" data-testid="disk-retention"><rect x="95" y="24" width="220" height="31" rx="15" /><text x="205" y="45">RETENTION OBSERVED</text></g>}
    </g>
    <path className={`flow-link ${visual.received ? 'is-observed' : ''}`} d="M 361 212 H 532" markerEnd={arrow} data-testid="receive-link" />
    <text className="flow-verb" x="447" y="186">{visual.received ? 'read saved message' : 'wait for consumer'}</text>
    <g className={`flow-station execution-${visual.executionState} ${visual.working ? 'is-working' : ''}`} data-testid="consumer-node" data-state={visual.executionState}>
      <rect className="flow-card" x="538" y="80" width="287" height="180" rx="20" />
      <text className="flow-name flow-consumer-name" x="681" y="124">Subscriber + Router</text><text className="flow-consumer-status" x="681" y="157">{visual.offline ? 'OFFLINE' : online ? 'ONLINE' : 'Not started'}</text>
      <text className="flow-caption" x="681" y="184">{visual.ready ? 'Saved message consumed' : visual.received ? 'Saved message received' : online ? 'New subscription' : 'Starts after reopen'}</text>
      {visual.offline && <g className="flow-offline-cross" transform="translate(681 218)"><path d="M -12 -12 L 12 12 M -12 12 L 12 -12" /></g>}
    </g>
    <MessageToken visual={visual} x={visual.token === 'consumer' ? 681 : 205} y={222} />
    <g className="flow-disk-lifecycle" data-testid="disk-lifecycle">
      <g className={visual.retentionObserved ? 'is-observed' : ''}><rect x="44" y="287" width="197" height="38" rx="10" /><text x="142" y="312">{visual.retentionObserved ? '✓ ' : ''}Close connections</text></g>
      <text className="flow-verb" x="261" y="312">→</text>
      <g className={visual.diskReopened ? 'is-observed' : ''}><rect x="282" y="287" width="199" height="38" rx="10" /><text x="381" y="312">{visual.diskReopened ? '✓ ' : ''}Reopen same file</text></g>
    </g>
    <text className="flow-context" x="681" y="312">No republish</text>
  </>
}

const titles: Record<ReportMode, string> = { publish: 'Publish a message into GoChannel', router: 'Router connects delivery to an application handler', retry: 'Retry middleware calls the same application handler', durable: 'SQLite retains a message across connection close and reopen', subscribe: 'Subscriber delivery and application receive loop' }

/** Each demo isolates one Watermill concept. The API, not a clock, moves the token. */
export function ReportFlow({ mode, visual }: { mode: ReportMode; visual: ReportVisual }) {
  const id = useId().replaceAll(':', '')
  const arrow = `url(#${id}-arrow)`
  return <figure className={`report-flow ${visual.failed ? 'is-stopped' : ''}`} data-mode={mode}>
    <div className="report-flow-canvas" tabIndex={0} role="region" aria-label="Concept diagram; scroll horizontally on small screens"><svg viewBox="0 0 880 350" role="img" aria-labelledby={`${id}-title ${id}-description`}>
      <title id={`${id}-title`}>{titles[mode]}</title><desc id={`${id}-description`}>{visual.detail} Positions illustrate observed API state, not measured transit time.</desc>
      <defs><marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 1 1 L 8 5 L 1 9" className="flow-arrow-tip" /></marker></defs>
      {mode === 'publish' ? <PublishFlow visual={visual} arrow={arrow} /> : mode === 'retry' ? <RetryFlow visual={visual} arrow={arrow} /> : mode === 'durable' ? <DurableFlow visual={visual} arrow={arrow} /> : <RouterFlow visual={visual} arrow={arrow} manual={mode === 'subscribe'} />}
    </svg></div>
    <figcaption><span className="flow-token-key" aria-hidden="true">1</span><span>Same message <code>{visual.messageId ? visual.messageId.slice(0, 8) : '…'}</code></span><span className="flow-observation">Observed API state</span><span className="flow-scroll-hint">Scroll to explore →</span></figcaption>
  </figure>
}
