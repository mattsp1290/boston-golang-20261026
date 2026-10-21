import { useId } from 'react'
import type { ReportMode } from './reports'
import type { ReportVisual, TokenLocation } from './reportVisual'

const tokenX: Record<TokenLocation, number> = { none: 110, app: 110, transport: 330, worker: 550, artifact: 770 }
const workerLabel = { waiting: 'Waiting', offline: 'OFFLINE', online: 'Online', processing: 'Working', retrying: 'Temporary error', complete: 'Work complete', error: 'Stopped' }

/** The same token changes position only when its projected server snapshot does. */
export function ReportFlow({ mode, visual }: { mode: ReportMode; visual: ReportVisual }) {
  const id = useId().replaceAll(':', '')
  const durable = mode === 'durable'
  const subscriber = mode === 'subscribe' || mode === 'publish'
  const hasToken = visual.token !== 'none'
  return <figure className={`report-flow ${visual.failed ? 'is-stopped' : ''}`} data-mode={mode}>
    <div className="report-flow-canvas" tabIndex={0} role="region" aria-label="Message flow diagram; scroll horizontally on small screens"><svg viewBox="0 0 880 340" role="img" aria-labelledby={`${id}-title ${id}-description`}>
      <title id={`${id}-title`}>Report message flow</title>
      <desc id={`${id}-description`}>{visual.detail} Positions illustrate observed API state, not measured transit time.</desc>
      <defs>
        <marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 1 1 L 8 5 L 1 9" className="flow-arrow-tip" /></marker>
      </defs>
      <g className="flow-connections" fill="none" markerEnd={`url(#${id}-arrow)`}>
        <path className={`flow-link ${visual.published ? 'is-observed' : ''}`} d="M 194 174 H 242" data-testid="publish-link" />
        <path className={`flow-link ${visual.received && !visual.offline ? 'is-observed' : ''}`} d="M 414 174 H 462" data-testid="receive-link" />
        <path className={`flow-link ${visual.ready ? 'is-observed' : ''}`} d="M 634 174 H 682" data-testid="artifact-link" />
      </g>
      <g className="flow-verb"><text x="220" y="151">publish</text><text x="440" y="151">receive</text><text x="660" y="151">write</text></g>

      <g className={`flow-station ${hasToken ? 'is-observed' : ''}`} data-testid="app-node">
        <rect x="28" y="66" width="164" height="154" rx="18" className="flow-card" />
        <g className="flow-icon" transform="translate(110 112)"><rect x="-29" y="-22" width="58" height="40" rx="5" /><path d="M -29 -10 H 29 M -12 28 H 12 M 0 18 V 28" /><circle cx="-20" cy="-16" r="1" /><circle cx="-13" cy="-16" r="1" /></g>
        <text x="110" y="249" className="flow-name">App</text><text x="110" y="272" className="flow-caption">{hasToken ? 'Request accepted' : 'Waiting for API'}</text>
      </g>

      <g className={`flow-station ${visual.token === 'transport' ? 'is-active' : ''} ${visual.diskRetained ? 'is-retained' : ''}`} data-testid="transport-node" data-transport={visual.transport}>
        <rect x="248" y="66" width="164" height="154" rx="18" className="flow-card" />
        {durable ? <g className="flow-icon flow-disk" transform="translate(330 116)"><path d="M -33 -15 V 64 C -33 78 33 78 33 64 V -15" /><ellipse cx="0" cy="-15" rx="33" ry="12" /><path d="M -33 3 C -33 18 33 18 33 3" /></g>
          : <g className="flow-icon flow-memory" transform="translate(330 112)"><rect x="-33" y="-20" width="66" height="40" rx="5" /><path d="M -23 -28 V -20 M -8 -28 V -20 M 8 -28 V -20 M 23 -28 V -20 M -23 20 V 28 M -8 20 V 28 M 8 20 V 28 M 23 20 V 28 M -21 -6 H 21 M -21 6 H 8" /></g>}
        <text x="330" y="249" className="flow-name">{durable ? 'SQLite' : 'GoChannel'}</text>
        <text x="330" y="272" className="flow-caption">{durable ? visual.diskClosed ? 'Connections closed' : visual.diskRetained ? 'Same file reopened' : 'On disk · beta' : 'In memory only'}</text>
        {visual.diskRetained && <g className="flow-retained" data-testid="disk-retention"><rect x="256" y="23" width="148" height="28" rx="14" /><path d="M 270 36 L 274 40 L 281 32" /><text x="338" y="42">PRESERVED</text></g>}
      </g>

      <g className={`flow-station worker-${visual.workerState} ${visual.working ? 'is-working' : ''}`} data-testid="worker-node" data-state={visual.workerState}>
        <rect x="468" y="66" width="164" height="154" rx="18" className="flow-card" />
        <g transform="translate(550 112)"><g className="flow-icon flow-worker-rotor"><circle r="22" /><circle r="8" /><path d="M 0 -34 V -23 M 24 -24 L 16 -16 M 34 0 H 23 M 24 24 L 16 16 M 0 34 V 23 M -24 24 L -16 16 M -34 0 H -23 M -24 -24 L -16 -16" /></g>
          {visual.offline && <g className="flow-offline-cross"><path d="M -26 -26 L 26 26 M -26 26 L 26 -26" /></g>}
          {(visual.retrying || (visual.failed && visual.received)) && <g className="flow-error-mark"><circle cx="25" cy="-22" r="13" /><path d="M 21 -26 L 29 -18 M 29 -26 L 21 -18" /></g>}
        </g>
        <text x="550" y="249" className="flow-name">{mode === 'subscribe' ? 'Subscriber' : 'Worker'}</text>
        <text x="550" y="272" className="flow-caption">{visual.attempts > 0 && !visual.offline ? `Attempt ${visual.attempts} · ${workerLabel[visual.workerState]}` : workerLabel[visual.workerState]}</text>
      </g>

      <g className={`flow-station ${visual.ready ? 'is-complete' : ''}`} data-testid="csv-node" data-ready={visual.ready}>
        <rect x="688" y="66" width="164" height="154" rx="18" className="flow-card" />
        <g className="flow-icon flow-file" transform="translate(770 113)"><path d="M -27 -27 H 13 L 29 -11 V 25 H -27 Z M 13 -27 V -11 H 29" />
          {visual.ready ? <path className="flow-file-rows" d="M -16 0 H 17 M -16 10 H 17 M -5 -1 V 20" /> : <path className="flow-pending-file" d="M -15 6 H 15" />}
        </g>
        {visual.ready && <g className="flow-complete-mark" transform="translate(805 89)"><circle r="13" /><path d="M -6 0 L -1 5 L 7 -5" /></g>}
        <text x="770" y="249" className="flow-name">CSV</text><text x="770" y="272" className="flow-caption">{visual.ready ? 'Generated by Go' : 'Not ready yet'}</text>
      </g>

      {mode === 'retry' && <g className={`flow-retry ${visual.retrying ? 'is-retrying' : ''} ${visual.failedAttempts.length ? 'has-errors' : ''}`} data-testid="retry-loop" data-active={visual.retrying}>
        <path d="M 623 112 C 674 6 426 6 477 112" markerEnd={`url(#${id}-arrow)`} />
        <text x="550" y="18" className="flow-retry-label">RETRY THE SAME MESSAGE</text>
        <g className="flow-attempts">{Array.from({ length: Math.min(visual.attempts, 6) }, (_, index) => {
          const number = index + 1
          const failed = visual.failedAttempts.includes(number)
          const complete = visual.ready && number === visual.attempts
          const x = 550 + (index - (Math.min(visual.attempts, 6) - 1) / 2) * 44
          return <g key={number} transform={`translate(${x} 43)`} className={failed ? 'is-error' : complete ? 'is-done' : 'is-attempting'} data-attempt={number} data-outcome={failed ? 'error' : complete ? 'complete' : 'observed'}><circle r="15" /><text x="-4" y="5">{number}</text>{failed ? <path d="M 3 -4 L 10 3 M 10 -4 L 3 3" /> : complete ? <path d="M 3 0 L 6 3 L 11 -4" /> : null}</g>
        })}</g>
      </g>}

      {subscriber && visual.acknowledged && <g className="flow-ack" data-testid="ack-return">
        <path d="M 550 282 V 296 Q 550 314 532 314 H 348 Q 330 314 330 296 V 282" markerEnd={`url(#${id}-arrow)`} />
        <rect x="371" y="298" width="138" height="30" rx="15" /><text x="440" y="318">✓ Ack observed</text>
      </g>}

      {hasToken && <g className={`flow-message ${visual.failed ? 'is-paused' : ''}`} transform={`translate(${tokenX[visual.token]} 174)`} style={{ transform: `translate(${tokenX[visual.token]}px, 174px)` }} data-testid="message-token" data-location={visual.token} data-message-id={visual.messageId}>
        <title>{`Message ${visual.messageId}`}</title><rect x="-20" y="-17" width="40" height="34" rx="8" /><path d="M -12 -9 H 4 L 11 -2 V 9 H -12 Z M 4 -9 V -2 H 11" /><text x="-1" y="5">1</text>
      </g>}
    </svg></div>
    <figcaption><span className="flow-token-key" aria-hidden="true">1</span><span>One message <code>{visual.messageId ? visual.messageId.slice(0, 8) : '…'}</code></span><span className="flow-observation">Observed API state</span><span className="flow-scroll-hint">Scroll to follow →</span></figcaption>
  </figure>
}
