import type { ReactNode } from 'react'
import { Deck, Slide } from '@revealjs/react'
import type { DeckProps } from '@revealjs/react'
import RevealNotes from 'reveal.js/plugin/notes'
import 'reveal.js/reveal.css'
import './App.css'
import ReportSlide from './ReportSlide'
import type { ReportStory } from './ReportSlide'
import reportSource from '../../api/internal/server/reports.go?raw'

function sourceExcerpt(name: string) {
  const excerpt = reportSource.split(`// demo:${name}:start`)[1]?.split(`// demo:${name}:end`)[0]
  if (!excerpt) throw new Error(`Missing report source excerpt: ${name}`)
  const lines = excerpt.replace(/^\s*\n/, '').trimEnd().split('\n')
  const indent = Math.min(...lines.filter(line => line.trim()).map(line => line.match(/^\s*/)?.[0].length ?? 0))
  const source = lines.map(line => line.slice(indent)).join('\n')
  if (name === 'subscribe') {
    // Fold only formatting and explicitly marked demo scaffolding. Keep the real
    // Subscribe/select/channel check/process/Ack/Nack calls visible together.
    return source
      .replace(/if err != nil \{\n\treturn err\n\}/, 'if err != nil { return err }')
      .replace(/\n\/\/ Subscribe first:[\s\S]*?(?=\nselect \{)/, ' // … publisher and demo staging …')
      .replace(/case <-r\.ctx\.Done\(\):\n\treturn r\.ctx\.Err\(\)/, 'case <-r.ctx.Done(): return r.ctx.Err()')
      .replace(/\tif !ok \{\n\t\treturn errors\.New\("subscriber closed"\)\n\t\}/, '\tif !ok { return errors.New("subscriber closed") }')
      .replace(/\tif err := r\.process\(msg\); err != nil \{\n\t\tmsg\.Nack\(\)\n\t\treturn err\n\t\}/, '\tif err := r.process(msg); err != nil { msg.Nack(); return err }')
      .replace(/\n\tr\.event\("ack", [^\n]*\)/, ' // … demo event …')
  }
  if (name === 'router') return source.replace(/\n\t\tselect \{[\s\S]*?\n\t\t\}/, '\n\t\t// … demo completion signal …')
  if (name === 'durable-consume') return source.replace(/if err := r\.routed\(sub, nil\); err != nil \{[\s\S]*?\n\}/, 'if err := r.routed(sub, nil); err != nil { /* … */ }')
  if (name.startsWith('postgres-')) return source
    .replace(/if err != nil \{\n\treturn [^\n]*\n\}/g, '// … error handling omitted …')
  if (name !== 'durable') return source
  // Keep the real lifecycle calls, with omissions made explicit instead of showing
  // 30 lines of repeated error checks on a presentation slide.
  return source
    .replace(/if err := pub\.Close\(\); err != nil \{[\s\S]*?\n\}/, 'if err := pub.Close(); err != nil { /* … */ }')
    .replace(/if err := db\.Close\(\); err != nil \{[\s\S]*?\n\}/, 'if err := db.Close(); err != nil { /* … */ }')
    .replace(/r\.event\("db-closed"[\s\S]*?(?=db, err = openReportDB)/, '// … pause with this demo’s database connections closed …\n')
    .replace(/if err != nil \{\n\treturn err\n\}/g, '// … error handling omitted …')
}

type LessonMode = 'publish' | 'router' | 'retry' | 'durable'
const liveNotes = 'Entering the active demo slide makes a real HTTP POST to the Go API. All visible state comes from the server. Hold the completed result for four seconds, then replay only while active. Navigation, overview, and unmount cancel work and the replay timer. Errors pause replay. Cleanup must be confirmed before another run starts. The source excerpt is taken from reports.go at build time. Browser polling observes the demo; it is not part of Watermill. '
const reportStories: Record<LessonMode, ReportStory & { notes: string; footer: string }> = {
  publish: {
    mode: 'publish', step: '03 / PUBLISH · LIVE',
    title: 'Publish one request.', accent: 'Stop at the boundary.',
    explanation: 'Create a message and publish it to the reports topic. The demo confirms availability to a live subscription, then stops.',
    concept: 'Published is not processed. No handler runs and no CSV is generated on this slide.',
    boundary: 'A buffered GoChannel subscription is already listening, but no handler is attached. The demo cleans up the message after this run; it is not retained for a later slide.',
    source: sourceExcerpt('publish'),
    notes: liveNotes + 'This is deliberately only a Publisher demonstration. Point to the message ID, payload, topic, and Publish call. Before publishing, the demo establishes a live buffered GoChannel subscription. The terminal Published state means Publish returned nil and availability in that buffered channel was observed. No application receive, handler, Ack, or CSV occurs. This GoChannel configuration is live-only; cleanup removes the subscription and message, and later demos create isolated runs. This does not prove offline retention or durable storage. Source: https://watermill.io/docs/pub-sub/.',
    footer: 'PUBLISH: MESSAGE → TOPIC',
  },
  router: {
    mode: 'router', step: '04 / HANDLE · LIVE',
    title: 'Call the handler.', accent: 'Build the report.',
    explanation: 'The Subscriber delivers the message. The Router invokes the application handler, which generates a tiny CSV.',
    concept: 'Return nil → the Router calls Ack(). Return an error → the Router calls Nack().',
    boundary: 'Ack means this handler succeeded, not exactly once. Redelivery depends on the transport. Make handlers idempotent.',
    source: sourceExcerpt('router'),
    notes: liveNotes + 'The Subscriber is the transport adapter, not the function that makes the report. The Router connects the Subscriber to the handler, invokes it, and handles the acknowledgement outcome. This no-output handler returns only an error: nil means success, error means failure. AddConsumerHandler means the handler does not publish output messages; it can still produce an application result such as the CSV. This run takes the successful path. The demonstration completion signal is explicitly folded so the handler contract stays in focus. Source: https://watermill.io/docs/messages-router/.',
    footer: 'HANDLE: DELIVERY → APPLICATION FUNCTION',
  },
  retry: {
    mode: 'retry', step: '05 / MIDDLEWARE · LIVE',
    title: 'Fail twice.', accent: 'Finish on attempt three.',
    explanation: 'Retry middleware calls the same handler again after an error. This generator deliberately fails its first two attempts.',
    concept: 'MaxRetries: 2 means one initial call plus two retries. The message ID stays the same.',
    boundary: 'These are middleware attempts, not three publications or transport redeliveries. Exhausted retries return an error to the Router.',
    source: sourceExcerpt('retry'),
    notes: liveNotes + 'Focus only on the Retry wrapper and the handler attempts. MaxRetries two permits three total handler calls. The first two calls return a temporary error, Retry waits, then calls the handler again. The third succeeds and produces the CSV. Middleware returns that final outcome to the Router. Retry does not create three messages, and these attempts are not broker redeliveries. Source: https://watermill.io/docs/middlewares/.',
    footer: 'MIDDLEWARE: WRAP THE SAME HANDLER',
  },
  durable: {
    mode: 'durable', step: '06 / ADVANCED: PERSISTENCE · LIVE',
    title: 'Reconnect to Postgres.', accent: 'Keep the message.',
    explanation: 'Publish through Watermill SQL before a Subscriber exists. Close this demo’s database connections, reconnect to PostgreSQL, then start delivery.',
    concept: 'The Publisher and Subscriber adapters change. The Router still invokes the same report handler, without publishing again.',
    boundary: 'Requires REPORT_POSTGRES_DSN. This tests database connection close/reopen, not a process or PostgreSQL server restart or an exactly-once guarantee.',
    source: sourceExcerpt('durable') + '\n// … configure PostgreSQL Subscriber (previous slide) …\n' + sourceExcerpt('durable-consume'),
    notes: liveNotes + 'Advanced extension after Publish, Handle, and Middleware. GoChannel was our starting in-memory choice, not a universal Watermill default. Swap only the transport adapters for the official Watermill SQL PostgreSQL Publisher and Subscriber; the Router and r.process handler stay the same. The queued message is stored in PostgreSQL. No Subscriber exists when publishing. The publisher and this run’s database connection pool close, then the demo opens a new pool to the same database and only then creates the Subscriber. The PostgreSQL server and Go application process remain alive throughout: this is not a process crash or a power-loss test. If you use the word worker aloud, define it as the application process running a Subscriber, Router, and handler, not as another name for one of those components. Job status lives in demo memory. Each run is isolated and cleaned up. A missing REPORT_POSTGRES_DSN or unavailable PostgreSQL produces a visible API error; there is no simulated durable fallback. Source: https://watermill.io/pubsubs/sql/.',
    footer: 'ADVANCED: TRANSPORT DEFINES PERSISTENCE',
  },
}

// A configuration diff, not the temporal order of the persistence demo.
const transportDiff = [
  '- bus := gochannel.NewGoChannel(gochannel.Config{}, logger)',
  '- pub := message.Publisher(bus)',
  '- sub = bus // the same GoChannel implements both interfaces',
  '+ pub, err := wmsql.NewPublisher(',
  '+   wmsql.BeginnerFromStdSQL(db),',
  '+   wmsql.PublisherConfig{SchemaAdapter: schema}, logger)',
  '+ // … check err …',
  '+ sub, err = wmsql.NewSubscriber(',
  '+   wmsql.BeginnerFromStdSQL(db),',
  '+   wmsql.SubscriberConfig{',
  '+     SchemaAdapter: schema, OffsetsAdapter: offsets,',
  '+     ConsumerGroup: "report-worker",',
  '+   }, logger)',
  '+ // … check err …',
  '  // Same application handler: r.process(msg)',
]

const config: DeckProps['config'] = {
  width: '100%', height: '100%', margin: 0, disableLayout: true,
  center: false, embedded: true, hash: true, controls: true, progress: true,
  slideNumber: 'c/t', touch: true, transition: 'fade',
  // Keep the same deck/navigation model on phones; CSS adapts the actual content.
  scrollActivationWidth: 0,
}
const plugins = [RevealNotes]

function SlideHeader({ section }: { section: string }) {
  return <div className="slide-header"><span>BOSTON GOLANG</span><span>{section}</span></div>
}

function LessonSlide({ id, section, title, accent, description, notes, source, children }: {
  id: string; section: string; title: string; accent: string; description: string
  notes: string; source: string; children: ReactNode
}) {
  return <Slide id={id} notes={notes}>
    <div className="slide-content lesson-slide">
      <SlideHeader section={section} />
      <div className="lesson-body">
        <div className="lesson-heading"><p className="eyebrow">UNDERSTAND IT FIRST</p><h2>{title} <span className="accent">{accent}</span></h2><p className="lesson-description">{description}</p></div>
        {children}
      </div>
      <div className="slide-footer"><a href={source} target="_blank" rel="noreferrer">WATERMILL DOCS ↗</a><span>ONE IDEA. THEN ONE LIVE EXAMPLE.</span></div>
    </div>
  </Slide>
}

function LiveSlide({ mode }: { mode: LessonMode }) {
  const story = reportStories[mode]
  return <Slide id={`report-${mode}`} notes={story.notes}>
    <div className="slide-content report-slide"><SlideHeader section={story.step} /><ReportSlide story={story} /><div className="slide-footer"><span>SOURCE: apps/api/internal/server/reports.go</span><span>{story.footer}</span></div></div>
  </Slide>
}

function LessonNode({ label, title, detail }: { label: string; title: string; detail: string }) {
  return <div className="lesson-node"><span className="lesson-label">{label}</span><strong>{title}</strong><p>{detail}</p></div>
}

function LessonArrow({ text }: { text: string }) {
  return <div className="lesson-arrow"><span>{text}</span><b aria-hidden="true">→</b></div>
}

export default function App() {
  return (
    <Deck config={config} plugins={plugins} className="watermill-deck">
      <Slide id="title" notes="Welcome to Boston Golang. This is a short introduction to Watermill, a Go library for building message-driven applications. Follow the Watermill learning order: Publish, Handle, Middleware. Explain each idea before its live example, then move our in-memory GoChannel example to PostgreSQL as an advanced extension.">
        <div className="slide-content title-slide">
          <SlideHeader section="OCTOBER 26, 2026" />
          <div className="title-body">
            <p className="eyebrow">MESSAGES IN MOTION</p>
            <h1>Watermill<span className="title-dot">.</span></h1>
            <p className="subtitle">Message-driven applications.<br />The Go way.</p>
            <div className="title-flow" aria-hidden="true"><span /><i /><span /><i /><span /></div>
          </div>
          <div className="slide-footer"><span>Matt Spurlin</span><span className="navigation-hint">← → to navigate · S for speaker view</span></div>
        </div>
      </Slide>
      <Slide id="speaker" notes="Introduce yourself: Matt Spurlin, Senior Software Engineer at Datadog. GitHub: mattsp1290. No additional biographical or company claims are included in this deck.">
        <div className="slide-content">
          <SlideHeader section="01 / WHO I AM" />
          <div className="speaker-body">
            <div className="initials" aria-hidden="true">MS<span>HELLO, BOSTON.</span></div>
            <div className="speaker-details"><p className="eyebrow">NICE TO MEET YOU</p><h2>Matt <span className="surname">Spurlin</span></h2><p className="speaker-role">Senior Software Engineer<br /><span>at Datadog</span></p><a className="github-link" href="https://github.com/mattsp1290" target="_blank" rel="noreferrer">github.com/mattsp1290 <span aria-hidden="true">↗</span></a></div>
          </div>
          <div className="slide-footer"><span>WATERMILL / AN INTRODUCTION</span><span>GO, ONE MESSAGE AT A TIME.</span></div>
        </div>
      </Slide>
      <Slide id="watermill" notes="Watermill is a Go library, not a broker. Follow its getting-started progression: Publish, Handle, Middleware. Introduce the message first, then the function that processes it, then a wrapper around that function. Each idea gets an explanation before a live example. A short Subscriber bridge separates transport delivery from application handling. After the core path, PostgreSQL persistence is an advanced extension. GoChannel is this example’s starting in-memory choice, not a universal Watermill default. Publisher and Subscriber APIs are shared across transports, but persistence and delivery semantics depend on implementation and configuration. Make handlers idempotent. Source: https://watermill.io/learn/getting-started/.">
        <div className="slide-content intro-slide">
          <SlideHeader section="02 / THE LEARNING PATH" />
          <div className="intro-body"><p className="eyebrow">WHAT IS WATERMILL?</p><h2>Go services.<br /><span className="accent">Connected by messages.</span></h2><p className="intro-description">A Go library, not a broker. Learn one piece at a time.</p>
            <ol className="concepts">
              <li><span className="concept-number">01</span><h3>Publish</h3><p>Put a message on a topic.</p></li>
              <li><span className="concept-number">02</span><h3>Handle</h3><p>Run application code for a delivered message.</p></li>
              <li><span className="concept-number">03</span><h3>Middleware</h3><p>Wrap the handler with reusable behavior.</p></li>
            </ol>
            <div className="transport-line"><span>OUR RHYTHM</span><p>Explain the idea <b>→</b> watch it run <b>·</b> then add persistence</p></div>
          </div>
          <div className="slide-footer"><a href="https://watermill.io/learn/getting-started/" target="_blank" rel="noreferrer">watermill.io / getting started ↗</a><span>PUBLISH → HANDLE → MIDDLEWARE</span></div>
        </div>
      </Slide>
      <LessonSlide id="lesson-publish" section="03 / PUBLISH · THE IDEA" title="A message is data." accent="Publishing sends it." description="Our example: request a weekly team CSV. First send that request as a message; handling comes next." source="https://watermill.io/docs/pub-sub/" notes="First explain only publishing. A message has an ID and a payload; a topic names where it is sent. The Publisher is a transport-facing interface. Publish returns an error, and successful return does not mean business processing is complete. Synchronous versus asynchronous behavior is implementation-dependent. On the next slide, a buffered GoChannel subscription already exists. Publish returns successfully, then the demo observes message availability in its buffered channel without receiving or handling it. No report runs. Cleanup removes that subscription; the next demo publishes its own message. Source: https://watermill.io/docs/pub-sub/.">
        <div className="lesson-diagram" aria-label="A message is passed to Publisher.Publish and sent to a transport topic">
          <LessonNode label="DATA" title="Message" detail="ID + payload" /><LessonArrow text="pass to" />
          <LessonNode label="WATERMILL API" title="Publisher" detail="Publish(topic, msg)" /><LessonArrow text="send to" />
          <LessonNode label="DESTINATION" title="Topic" detail="reports" />
        </div>
        <div className="lesson-takeaway"><strong>Published ≠ processed.</strong><p>A successful call does not say the report is finished.</p></div>
        <p className="lesson-next">Next: watch only the message cross this boundary. No handler yet.</p>
      </LessonSlide>
      <LiveSlide mode="publish" />
      <LessonSlide id="lesson-subscriber" section="04 / BEFORE HANDLING: DELIVERY" title="Subscriber delivers." accent="Your code does the work." description="The Subscriber is a transport adapter. Subscribe returns a Go channel, not a report-generating function." source="https://watermill.io/docs/pub-sub/" notes="A terminology bridge before introducing the Router. Here bus is created by gochannel.NewGoChannel before this function is called. It implements both Publisher and Subscriber. The Subscriber implementation delivers messages from a transport as a Go channel. A handler is the application function that processes a message; these are not synonyms. With this low-level API, application code receives a message, calls its processing function, and explicitly calls Ack or Nack. Show cancellation and the closed-channel check. This is one finite receive, not a complete long-running consumer loop. The displayed code is extracted from the real subscribed function; publisher/demo staging and a telemetry event are explicitly folded. It is not an additional live demo. The following Router slide automates receiving, invocation, and the outcome. Source: https://watermill.io/docs/pub-sub/.">
        <div className="subscriber-bridge">
          <div className="subscriber-roles">
            <LessonNode label="TRANSPORT ADAPTER" title="Subscriber" detail="Delivers messages into a channel." />
            <LessonArrow text="your code receives" />
            <LessonNode label="APPLICATION FUNCTION" title="Handler" detail="Processes a message, such as generating a CSV." />
            <p className="lesson-small">Here, bus is a GoChannel instance: it implements both Publisher and Subscriber.</p><p className="lesson-small">Without a Router, your receiving code calls Ack() or Nack().</p>
          </div>
          <div className="subscriber-source"><p className="lesson-label">ACTUAL GO SOURCE · DEMO STAGING FOLDED</p><pre className="lesson-source" aria-label="Actual Go subscribe implementation"><code>{sourceExcerpt('subscribe').split('\n').map((line, index) => <span className="lesson-code-line" key={index}>{line || ' '}</span>)}</code></pre></div>
        </div>
        <p className="lesson-next">Next: let the Router connect delivery to your handler.</p>
      </LessonSlide>
      <LessonSlide id="lesson-handle" section="04 / HANDLE · THE IDEA" title="Write the handler." accent="Let the Router connect it." description="A handler is your application function. The Router connects it to a Subscriber and owns the acknowledgement outcome." source="https://watermill.io/docs/messages-router/" notes="Three distinct roles: Subscriber is the transport adapter that delivers messages, handler is the application function that processes each message, and Router is the wiring and lifecycle that subscribes, invokes handlers, and acknowledges outcomes. The highlighted box is a logical ownership diagram, not a separate service or broker. In this no-output handler example the handler returns an error: nil leads to Ack, an error leads to Nack. The contract assumes the handler does not manually acknowledge. Nack requests redelivery, whose details depend on the transport. Make handlers idempotent. The live example will generate a small synthetic CSV. Source: https://watermill.io/docs/messages-router/.">
        <div className="lesson-router" aria-label="Router connects a Subscriber to an application handler and acknowledges the returned outcome">
          <div className="lesson-wrapper-label"><strong>Router</strong><span>connects · invokes · acknowledges</span></div>
          <div className="lesson-diagram lesson-diagram-two"><LessonNode label="DELIVERY" title="Subscriber" detail="Transport adapter" /><LessonArrow text="message" /><LessonNode label="YOUR CODE" title="Handler" detail="Generate the CSV, return an error or nil" /></div>
          <div className="lesson-outcomes"><span>return nil <b>→</b> Router calls Ack()</span><span>return error <b>→</b> Router calls Nack()</span></div>
        </div>
        <p className="lesson-next">Next: one delivery, one handler call, one CSV.</p>
      </LessonSlide>
      <LiveSlide mode="router" />
      <LessonSlide id="lesson-middleware" section="05 / MIDDLEWARE · THE IDEA" title="Keep the handler." accent="Wrap its behavior." description="Middleware runs around the handler. Retry can call that same function again when it returns an error." source="https://watermill.io/docs/middlewares/" notes="Middleware wraps a handler rather than replacing the Subscriber or publishing another message. It can run behavior before or after a handler and inspect the result. This example adds Retry to one Router handler. MaxRetries two means one initial call plus two retries. The generator intentionally returns errors twice and succeeds the third time. The resulting success or final error returns to the Router. Distinguish middleware retry attempts within this delivery from transport redelivery. Keep handler side effects idempotent. Source: https://watermill.io/docs/middlewares/.">
        <div className="lesson-middleware" aria-label="Retry middleware wraps the same handler and allows three total calls">
          <div className="lesson-wrapper-label"><strong>Retry middleware</strong><span>MaxRetries: 2</span></div>
          <div className="lesson-handler-core"><span className="lesson-label">SAME APPLICATION FUNCTION</span><strong>Handler</strong><p>Generate the report</p></div>
          <ol className="lesson-attempts"><li><span>1</span><strong>Initial call</strong><p>error</p></li><li><span>2</span><strong>Retry</strong><p>error</p></li><li><span>3</span><strong>Retry</strong><p>nil ✓</p></li></ol>
        </div>
        <div className="lesson-takeaway"><strong>One message. Three handler calls.</strong><p>Not three publications. Not three transport deliveries.</p></div>
      </LessonSlide>
      <LiveSlide mode="retry" />
      <LessonSlide id="lesson-durable" section="06 / ADVANCED: PERSISTENCE · THE IDEA" title="Swap the transport." accent="Keep the handler." description="GoChannel → PostgreSQL. Only the transport wiring changes." source="https://watermill.io/pubsubs/sql/" notes="This is an advanced extension, separate from the core Publish, Handle, Middleware progression. GoChannel implements both Publisher and Subscriber in one in-memory adapter; it is not the universal Watermill default. The illustrative configuration diff shows a move to the official Watermill SQL PostgreSQL adapters. The SQL Publisher inserts messages; the SQL Subscriber polls stored rows and tracks consumer-group offsets. The schema and offsets adapters are PostgreSQL-specific. The diff assumes db is an open database/sql pool, logger is a Watermill logger, schema is DefaultPostgreSQLSchema, offsets is DefaultPostgreSQLOffsetsAdapter, and sub is declared message.Subscriber. Database/table initialization, imports, cleanup, and error checks are omitted here but implemented in reports.go. The GoChannel side reuses one instance for both interfaces. Constructors are shown together for comparison, but the demo constructs the SQL Subscriber only after reconnecting. The same r.process application handler and Router acknowledgement contract remain unchanged. Persistence comes from the selected transport and configuration, not the Router or Retry middleware. The demo publishes with no Subscriber, closes its database connection pool, reconnects to the same database, and then starts delivery without republishing. PostgreSQL and the application process keep running; no process restart, power loss, or exactly-once processing is demonstrated. REPORT_POSTGRES_DSN must point to a reachable PostgreSQL database; without it the live slide shows an actionable error instead of simulating storage. Source: https://watermill.io/pubsubs/sql/.">
        <pre className="transport-diff" aria-label="GoChannel to PostgreSQL code diff"><code>{transportDiff.map((line, index) => <span key={index} className={`transport-diff-line ${line.startsWith('+') ? 'is-added' : line.startsWith('-') ? 'is-removed' : 'is-context'}`}>{line}{index < transportDiff.length - 1 ? '\n' : ''}</span>)}</code></pre>
        <p className="transport-diff-note">Setup omitted: db, logger, PostgreSQL schema/offsets, and var sub message.Subscriber. − GoChannel · + PostgreSQL</p>
      </LessonSlide>
      <LiveSlide mode="durable" />
    </Deck>
  )
}
