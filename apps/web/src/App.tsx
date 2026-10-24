import type { ReactNode } from 'react'
import { Deck, Slide } from '@revealjs/react'
import type { DeckProps } from '@revealjs/react'
import RevealNotes from 'reveal.js/plugin/notes'
import 'reveal.js/reveal.css'
import './App.css'
import ReportSlide from './ReportSlide'
import type { ReportStory } from './ReportSlide'
import reportSource from '../../api/internal/server/reports.go?raw'

// Extract the real implementation, then fold only formatting or explicitly
// marked demo scaffolding. The source stays tied to reports.go at build time.
function sourceExcerpt(name: string) {
  const excerpt = reportSource.split(`// demo:${name}:start`)[1]?.split(`// demo:${name}:end`)[0]
  if (!excerpt) throw new Error(`Missing report source excerpt: ${name}`)
  const lines = excerpt.replace(/^\s*\n/, '').trimEnd().split('\n')
  const indent = Math.min(...lines.filter(line => line.trim()).map(line => line.match(/^\s*/)?.[0].length ?? 0))
  return lines.map(line => line.slice(indent)).join('\n')
}

const publishSource = sourceExcerpt('publish').replace(
  'message.NewMessage(r.view.MessageID, ', 'message.NewMessage(\n\tr.view.MessageID, ',
)
const subscriberSource = sourceExcerpt('subscribe').split('\n// Subscribe first:')[0]
const receiveSource = '// … publish to GoChannel before receiving …\n' + sourceExcerpt('subscribe')
  .slice(sourceExcerpt('subscribe').indexOf('select {'))
  .replace(/\tif !ok \{\n\t\treturn errors\.New\("subscriber closed"\)\n\t\}/, '\tif !ok { return errors.New("subscriber closed") }')
  .replace(/\tr\.event\("ack", [^\n]*\)/, '\t// … demo telemetry …')
const routerSource = sourceExcerpt('router')
  .replace('router.AddConsumerHandler("generate-report", r.topic(), sub,', 'router.AddConsumerHandler(\n\t"generate-report", r.topic(), sub,')
  .replace(/\t\tif err := r\.process\(msg\); err != nil \{\n\t\t\treturn err\n\t\t\}/, '\t\tif err := r.process(msg); err != nil { return err }')
  .replace(/\n\t\tselect \{[\s\S]*?\n\t\t\}/, '\n\t\t// … demo completion signal …')
const retrySource = sourceExcerpt('retry')

type LessonMode = 'publish' | 'router' | 'retry' | 'durable'
const liveNotes = 'Entering the active demo slide makes a real HTTP POST to the Go API. Every visible state comes from the server. Hold the completed result for four seconds, then replay only while active. Navigation, overview, and unmount cancel work and the replay timer. Errors pause replay. Cleanup must be confirmed before another run starts. Browser polling observes the demo; it is not part of Watermill. Start the Go API before presenting. Source: apps/api/internal/server/reports.go. '
const reportStories: Record<LessonMode, ReportStory & { notes: string }> = {
  publish: {
    mode: 'publish', step: 'Publish', title: 'Make the message available.', accent: '',
    explanation: 'Create a message and publish it to the reports topic. The demo confirms availability to a live subscription, then stops.',
    concept: 'Published is not processed. No handler runs and no CSV is generated on this slide.',
    boundary: 'A buffered GoChannel subscription is already listening, but no handler is attached. The demo cleans up the message after this run; it is not retained for a later slide.',
    source: publishSource,
    notes: liveNotes + 'This is deliberately only a Publisher demonstration. Before publishing, the demo establishes a live buffered GoChannel subscription. The terminal Published state means Publish returned nil and availability in that buffered channel was observed. No application receive, handler, Ack, or CSV occurs. This GoChannel configuration is live-only; cleanup removes the subscription and message, and later demos create isolated runs. This does not prove offline retention or durable storage. Source: https://watermill.io/docs/pub-sub/.',
  },
  router: {
    mode: 'router', step: 'Handle', title: 'One delivery. One handler call.', accent: '',
    explanation: 'The Subscriber delivers the message. The Router invokes the application handler, which generates a tiny CSV.',
    concept: 'Return nil → the Router calls Ack(). Return an error → the Router calls Nack().',
    boundary: 'Ack means this handler succeeded, not exactly once. Redelivery depends on the transport. Make handlers idempotent.',
    source: routerSource,
    notes: liveNotes + 'The Subscriber is the transport adapter, not the function that makes the report. The Router connects the Subscriber to the application handler and handles the acknowledgement outcome. This no-output handler returns only an error: nil means success, error means failure. AddConsumerHandler means the handler does not publish output messages; it can still produce an application result such as the CSV. Show the actual CSV only after the real Ready API response. Acknowledgement is not an exactly-once guarantee; keep side effects idempotent. Source: https://watermill.io/docs/messages-router/.',
  },
  retry: {
    mode: 'retry', step: 'Middleware', title: 'Try again. Same message.', accent: '',
    explanation: 'Retry middleware calls the same handler again after an error. This generator deliberately fails its first two attempts.',
    concept: 'MaxRetries: 2 means one initial call plus two retries. The message ID stays the same.',
    boundary: 'These are middleware attempts, not three publications or transport redeliveries. Exhausted retries return an error to the Router.',
    source: retrySource,
    notes: liveNotes + 'Focus only on the Retry wrapper and the handler attempts. MaxRetries two permits three total handler calls. The first two calls return a temporary error, Retry waits, then calls the handler again. The third succeeds. Middleware returns that final outcome to the Router. Retry does not create three messages, and these attempts are not broker redeliveries. The full stable message ID remains accessible without dominating the projected scene. Source: https://watermill.io/docs/middlewares/.',
  },
  durable: {
    mode: 'durable', step: 'Persistence', title: 'Stored now. Delivered later.', accent: '',
    explanation: 'Publish through Watermill SQL before a Subscriber exists. Close this demo’s database connections, reconnect to PostgreSQL, then start delivery.',
    concept: 'The Publisher and Subscriber adapters change. The Router still invokes the same report handler, without publishing again.',
    boundary: 'Requires REPORT_POSTGRES_DSN. This tests database connection close/reopen, not a process or PostgreSQL server restart or an exactly-once guarantee.',
    source: sourceExcerpt('durable') + '\n// … configure PostgreSQL Subscriber …\n' + sourceExcerpt('durable-consume'),
    notes: liveNotes + 'Advanced extension after Publish, Handle, and Middleware. GoChannel was our starting in-memory choice, not a universal Watermill default. Swap only the transport adapters for the official Watermill SQL PostgreSQL Publisher and Subscriber; the Router and r.process handler stay the same. No Subscriber exists when publishing. The publisher and this run’s database connection pool close, then the demo opens a new pool to the same database and only then creates the Subscriber. The PostgreSQL server and Go application process remain alive throughout: this is not a process crash or a power-loss test. Job status lives in demo memory. Each run is isolated and cleaned up. A missing REPORT_POSTGRES_DSN or unavailable PostgreSQL produces a visible API error; there is no simulated durable fallback. Source: https://watermill.io/pubsubs/sql/.',
  },
}

// Illustrative configuration comparison, not the live demo's temporal order.
// Shared declarations and full schema/offset configuration are in the notes.
const transportDiff = [
  '- bus := gochannel.NewGoChannel(gochannel.Config{}, logger)',
  '- pub := message.Publisher(bus)',
  '- sub = bus // shared Publisher + Subscriber',
  '+ pub, err := wmsql.NewPublisher(',
  '+   wmsql.BeginnerFromStdSQL(db),',
  '+   wmsql.PublisherConfig{SchemaAdapter: schema}, logger)',
  '+ // … check err …',
  '+ sub, err = wmsql.NewSubscriber(',
  '+   wmsql.BeginnerFromStdSQL(db),',
  '+   wmsql.SubscriberConfig{SchemaAdapter: schema,',
  '+     OffsetsAdapter: offsets, ConsumerGroup: "report-worker"},',
  '+   logger)',
  '+ // … check err …',
  '  // Same application handler: r.process(msg)',
]

const config: DeckProps['config'] = {
  width: 1920, height: 1080, margin: 0, minScale: 0.05, maxScale: 4,
  center: false, embedded: true, hash: true, controls: false, progress: false,
  slideNumber: false, touch: true, transition: 'fade', backgroundTransition: 'none',
  // Always scale the same 16:9 stage. Never switch to a scrolling webpage.
  scrollActivationWidth: 0,
}
const plugins = [RevealNotes]

function Code({ source, label }: { source: string; label: string }) {
  return <pre className="lesson-source" aria-label={label}><code>{source.split('\n').map((line, index) =>
    <span key={index} className={`lesson-code-line${line.trim().startsWith('//') ? ' is-comment' : /\.Publish\(|\.Subscribe\(|\.process\(|\.Ack\(|\.Nack\(|AddConsumerHandler|middleware\.Retry/.test(line) ? ' is-emphasized' : ''}`}>{line}{index < source.split('\n').length - 1 ? '\n' : ''}</span>,
  )}</code></pre>
}

function CodeSlide({ id, title, notes, children, annotation, className = '' }: {
  id: string; title: string; notes: string; children: ReactNode; annotation?: ReactNode; className?: string
}) {
  return <Slide id={id} notes={notes}>
    <div className={`slide-content lesson-slide ${className}`}>
      <h2>{title}</h2>
      <div className="lesson-body">{children}</div>
      {annotation && <div className="lesson-annotation">{annotation}</div>}
    </div>
  </Slide>
}

function LiveSlide({ mode }: { mode: LessonMode }) {
  const story = reportStories[mode]
  return <Slide id={`report-${mode}`} notes={`${story.notes} ${story.explanation} ${story.concept} ${story.boundary}`}>
    <div className="slide-content report-slide"><ReportSlide story={story} /></div>
  </Slide>
}

export default function App() {
  return (
    <Deck config={config} plugins={plugins} className="watermill-deck">
      <Slide id="title" notes="Boston Golang, October 26, 2026. Welcome. This is a short introduction to Watermill, a Go library for building message-driven applications. Follow Publish, Handle, Middleware, then move the same report example to PostgreSQL. Navigate with arrow keys or swipe; press S for speaker view and Escape for overview. All four live slides call the real Go API.">
        <div className="slide-content title-slide">
          <div className="title-body"><h1>Watermill<span className="accent">.</span></h1><p className="subtitle">Message-driven applications. The Go way.</p></div>
          <svg className="message-motif" viewBox="0 0 120 84" aria-hidden="true"><rect x="2" y="2" width="116" height="80" rx="4" /><path d="m4 5 56 42L116 5" /></svg>
          <p className="presenter-name">Matt Spurlin</p>
        </div>
      </Slide>
      <Slide id="speaker" notes="Matt Spurlin, Senior Software Engineer at Datadog. GitHub: https://github.com/mattsp1290. No additional biographical or company claims are included in this deck.">
        <div className="slide-content speaker-slide">
          <div className="speaker-details"><h2>Matt Spurlin.</h2><p className="speaker-role">Senior Software Engineer<br /><span>Datadog</span></p><a className="github-link" href="https://github.com/mattsp1290" target="_blank" rel="noreferrer">@mattsp1290</a></div>
          <div className="initials" aria-hidden="true">MS</div>
        </div>
      </Slide>
      <Slide id="watermill" notes="Watermill is a Go library, not a broker. Follow its getting-started progression: Publish, Handle, Middleware. Our example requests a weekly team CSV using synthetic data. Explain each idea, then watch the real API run. The Subscriber is a transport adapter, distinct from the application handler. PostgreSQL persistence is an optional extension after the core path. GoChannel is this example’s in-memory starting choice, not a universal Watermill default. Persistence and delivery semantics depend on transport implementation and configuration. Make handlers idempotent. Source: https://watermill.io/learn/getting-started/.">
        <div className="slide-content intro-slide">
          <h2 className="concept-path"><span>Publish</span><b aria-hidden="true">→</b><span>Handle</span><b aria-hidden="true">→</b><span>Middleware.</span></h2>
          <p className="intro-description">A Go library, not a broker.</p>
        </div>
      </Slide>
      <CodeSlide id="lesson-publish" title="Publish a report request." annotation={<p>Published <span className="accent">≠</span> processed</p>} notes="Actual code from reports.go, with the message constructor wrapped for readability. A message has an ID and payload; a topic names where it is sent. r.view.MessageID is the generated stable ID, and the payload requests the weekly summary. r.ctx propagates cancellation. Publish returns an error; a successful return does not mean business processing is complete. Synchronous versus asynchronous behavior is implementation-dependent. On the next slide, a buffered GoChannel subscription already exists. Availability is observed without receiving or handling the message. No report runs. Each later demonstration publishes its own isolated message. Imports and enclosing reportRun method are omitted. Source: https://watermill.io/docs/pub-sub/.">
        <Code source={publishSource} label="Actual Go publish implementation" />
      </CodeSlide>
      <LiveSlide mode="publish" />
      <CodeSlide id="lesson-subscriber" title="Subscribe returns a channel." notes="This is the first part of a continued actual-source example from reportRun.subscribed in reports.go. bus is the shared GoChannel Publisher/Subscriber adapter, constructed before this method. r.ctx is its cancellable context and reportTopic is the topic. Subscribe returns a Go channel of messages, not a handler function. Keep incoming, err, and r.ctx in mind: the next slide continues this same scope. The Subscriber delivers; the application handler processes. Error handling remains visible. Source: https://watermill.io/docs/pub-sub/.">
        <Code source={subscriberSource} label="Actual Go Subscribe call" />
      </CodeSlide>
      <CodeSlide id="lesson-receive" title="Receive. Handle. Acknowledge." notes="Continued from the preceding slide with the same incoming channel, err, bus, and r.ctx. Actual source from reportRun.subscribed in reports.go. This is one finite receive, not a complete long-running loop. A visible omission marker stands for r.publish(bus) and its error check after subscribing and before receiving: this live-only GoChannel must have a subscription first. Cancellation and the closed-channel check remain visible. r.process is the unchanged application handler. Receiving code calls Nack and returns the error on failure, or calls Ack after success. The second omission marker folds only a telemetry event after Ack. This manual plumbing is not a fifth live demo. The Router will take over receiving, invocation, and acknowledgements next. Source: https://watermill.io/docs/pub-sub/.">
        <Code source={receiveSource} label="Actual Go receive implementation, continued" />
      </CodeSlide>
      <CodeSlide id="lesson-handle" title="Let the Router handle the plumbing." className="router-lesson" notes="Actual AddConsumerHandler wiring from reportRun.routed in reports.go. Formatting is folded, and a visible marker replaces only the demo completion signal. The unchanged application function is r.process(msg). The Subscriber is the transport adapter; the Router owns the receive lifecycle and invokes the application handler. The application handler returns an error or nil. The Router, not the function itself, calls Ack after nil or Nack after error. AddConsumerHandler does not publish output messages; a handler can still produce a CSV as an application result. Router construction, lifecycle, and error checks are in the actual source and omitted here. Acknowledgement is not an exactly-once guarantee; transport redelivery depends on configuration. Source: https://watermill.io/docs/messages-router/.">
        <Code source={routerSource} label="Actual Go router implementation" />
        <div className="router-outcomes"><p>Router: nil <span>→</span> Ack</p><p>Router: error <span>→</span> Nack</p></div>
      </CodeSlide>
      <LiveSlide mode="router" />
      <CodeSlide id="lesson-middleware" title="Retry wraps the same handler." annotation={<p>One message. Three calls.</p>} notes="Actual Retry middleware configuration from reports.go. handler is the Router handler returned by AddConsumerHandler. The delay comes from the demo's configured teaching interval. Middleware wraps a handler rather than replacing the Subscriber or publishing another message. MaxRetries: 2 means one initial call plus two retries. This generator intentionally returns errors twice and succeeds the third time. The final success or exhausted error returns to the Router. These middleware attempts occur within the same delivery; they are not transport redeliveries or three publications. Keep side effects idempotent. Source: https://watermill.io/docs/middlewares/.">
        <Code source={retrySource} label="Actual Go Retry middleware" />
      </CodeSlide>
      <LiveSlide mode="retry" />
      <CodeSlide id="lesson-durable" title="Swap the transport. Keep the handler." annotation={<p className="setup-note">Illustrative configuration; setup omitted.</p>} notes="This illustrative configuration diff is an advanced extension, not the live demo's temporal order. It compares one shared GoChannel implementing both Publisher and Subscriber with the official Watermill SQL PostgreSQL adapters. The same r.process application handler and Router acknowledgement contract remain unchanged. Persistence comes from the selected transport and configuration, not the Router or Retry middleware. Assume db is an open database/sql pool; logger is a Watermill logger; schema is wmsql.DefaultPostgreSQLSchema; offsets is wmsql.DefaultPostgreSQLOffsetsAdapter; sub is declared message.Subscriber; err exists for Subscriber assignment. Imports, error handling at the visible markers, close/defer cleanup, and table initialization are omitted. The actual demo uses OutputChannelBuffer: 1 on GoChannel, Watermill's NopLogger, run-isolated PostgreSQL table names, SubscribeBatchSize: 1, preinitialized tables, AutoInitializeSchema: false, InitializeSchema: false, and PollInterval: 50 * time.Millisecond. SQL Publisher inserts stored messages; SQL Subscriber polls and tracks consumer-group offsets. Constructors are shown together only for comparison: the live demo creates the Subscriber after reconnecting. It publishes with no Subscriber, closes its owned database connections, reconnects to the same PostgreSQL database, and then starts delivery without republishing. The application process and database server stay running. No process restart, power loss, or exactly-once guarantee is demonstrated. REPORT_POSTGRES_DSN must identify a reachable PostgreSQL database. Source: https://watermill.io/pubsubs/sql/.">
        <pre className="lesson-source transport-diff" aria-label="GoChannel to PostgreSQL code diff"><code>{transportDiff.map((line, index) => <span key={index} className={`transport-diff-line ${line.startsWith('+') ? 'is-added' : line.startsWith('-') ? 'is-removed' : 'is-context'}`}>{line}{index < transportDiff.length - 1 ? '\n' : ''}</span>)}</code></pre>
      </CodeSlide>
      <LiveSlide mode="durable" />
      <Slide id="closing" notes="Publish a message. Handle it in application code. Extend behavior with middleware and choose a transport for the guarantees you need. Questions. References: https://watermill.io/learn/getting-started/ ; https://watermill.io/docs/pub-sub/ ; https://watermill.io/docs/messages-router/ ; https://watermill.io/docs/middlewares/ ; https://watermill.io/pubsubs/sql/ . Source and running instructions are in the repository README.">
        <div className="slide-content closing-slide"><h2>Publish.<br />Handle.<br /><span className="accent">Extend.</span></h2><a href="https://watermill.io" target="_blank" rel="noreferrer">watermill.io</a></div>
      </Slide>
    </Deck>
  )
}
