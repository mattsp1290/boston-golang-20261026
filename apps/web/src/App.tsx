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
  if (name !== 'durable') return source
  // Keep the real lifecycle calls, with omissions made explicit instead of showing
  // 30 lines of repeated error checks on a presentation slide.
  return source
    .replace(/if err := pub\.Close\(\); err != nil \{[\s\S]*?\n\}/, 'if err := pub.Close(); err != nil { /* … */ }')
    .replace(/if err := db\.Close\(\); err != nil \{[\s\S]*?\n\}/, 'if err := db.Close(); err != nil { /* … */ }')
    .replace(/r\.event\("db-closed"[\s\S]*?(?=db, err = openReportDB)/, '// … brief pause with every connection closed …\n')
    .replace(/if err != nil \{\n\treturn err\n\}/g, '// … error handling omitted …')
}

const reportStories: (ReportStory & { notes: string })[] = [
  {
    mode: 'publish', step: '03 / MOVE WORK OUT OF THE REQUEST',
    title: 'Accept the request.', accent: 'Do the work later.',
    explanation: 'A tiny CSV report is enough to see the boundary: HTTP accepts a job, then a subscriber generates the file.',
    concept: 'Publish a message. Return control to the caller. Let a worker finish the report.',
    boundary: 'GoChannel is in-memory. This first demo is not a durable job queue. The browser polls job state; Watermill carries the work.',
    source: sourceExcerpt('publish'),
    notes: 'The first three opening slides are unchanged. This four-part story builds one small synthetic CSV report. Entering this slide makes an actual HTTP POST to the Go API and starts one finite run. Watch Queued become Processing, then Ready. The message ID and events are server facts, not animation timers. The source excerpt comes from reports.go at build time. This first slide uses a plain subscriber and an explicit Ack. GoChannel is in-memory, not durable. A successful publish is not proof that the report has finished. Browser polling is only the observation path, not the lesson. Leaving, opening overview, Replay, and unmount all clean up. Start both apps using npm run dev.',
  },
  {
    mode: 'router', step: '04 / HANDLE THE MESSAGE',
    title: 'Give the work', accent: 'a handler.',
    explanation: 'The Router wires a subscription to application code. Your handler reports success or failure.',
    concept: 'Return nil → the Router acknowledges. Return an error → the Router negatively acknowledges.',
    boundary: 'Ack means this handler succeeded, not “exactly once.” Transport and configuration determine redelivery. Keep real handlers idempotent.',
    source: sourceExcerpt('router'),
    notes: 'Same report, now a Watermill Router handler. Read the small handler and explain the nil/error contract: returning nil acknowledges; returning an error negatively acknowledges. This automatic run follows the successful path. The next slide deliberately injects errors. Router wiring removes manual Ack/Nack from application code. Delivery semantics remain transport-dependent, so production handlers need idempotency. Source: https://watermill.io/docs/messages-router/.',
  },
  {
    mode: 'retry', step: '05 / RETRY A TRANSIENT FAILURE',
    title: 'Fail twice.', accent: 'Finish on attempt three.',
    explanation: 'A deliberately flaky generator makes Retry visible. One published message, three calls to the same handler.',
    concept: 'Retry wraps the handler. Two temporary errors, short backoffs, then a successful CSV.',
    boundary: 'These are middleware attempts, not three publications or proof of broker redelivery. Exhausted retries return an error to the Router.',
    source: sourceExcerpt('retry'),
    notes: 'No typing is needed. The actual generator fails on attempts one and two, then succeeds on attempt three. Point to the stable message ID and the real server event timeline. Watermill Retry middleware re-invokes the handler within this delivery; do not describe it as publishing three messages or three transport redeliveries. MaxRetries two means three total handler calls. Retry backoff is finite. If every retry fails, the resulting error goes to the Router, whose Nack behavior depends on the transport. Source: https://watermill.io/docs/middlewares/.',
  },
  {
    mode: 'durable', step: '06 / KEEP WORK WHILE THE WORKER IS OFFLINE',
    title: 'Worker offline.', accent: 'Message preserved.',
    explanation: 'Publish to a real SQLite file with no worker. Close the database, reopen it, then start a subscriber.',
    concept: 'Watch Queued survive closing every connection. Start the first worker, then generate the CSV.',
    boundary: 'Official Watermill SQLite transport (beta). Messages survive closing and reopening database connections before a worker starts. Not a process-crash or exactly-once guarantee.',
    source: sourceExcerpt('durable'),
    notes: 'This is an actual disk-backed SQLite demonstration, not a slice retained in Go memory. The server publishes with the worker offline, closes the publisher and database connection, waits briefly, opens the same database file, and starts a new worker. The run stays Queued until that subscriber processes the message. The official Watermill SQLite transport is beta. This controlled connection restart before the first subscriber starts is not a process crash, power-loss test, or exactly-once claim. Job status is demo memory, while the queued message is in SQLite. Each run is isolated, finite, and deleted on cleanup, with server expiry as a fallback. In production choose a transport based on explicit persistence, delivery, throughput, and operations requirements.',
  },
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

export default function App() {
  return (
    <Deck config={config} plugins={plugins} className="watermill-deck">
      <Slide id="title" notes="Welcome to Boston Golang. This is a short introduction to Watermill, a Go library for building message-driven applications. The opening deck has three slides; live examples can come later.">
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
      <Slide id="watermill" notes="Watermill is a library, not a message broker. Publisher and Subscriber interfaces provide a shared API across transports, while the Router coordinates handlers and middleware. Kafka, RabbitMQ, and PostgreSQL are examples of supported implementations. Delivery semantics depend on the transport and configuration: plan for redelivery and make handlers idempotent. Do not assume exactly-once processing or identical broker semantics. Source: https://watermill.io/learn/getting-started/ and https://watermill.io/docs/pub-sub/.">
        <div className="slide-content intro-slide">
          <SlideHeader section="02 / THE IDEA" />
          <div className="intro-body"><p className="eyebrow">WHAT IS WATERMILL?</p><h2>Go services.<br /><span className="accent">Connected by messages.</span></h2><p className="intro-description">A Go library for message-driven and event-driven applications. Not another broker.</p>
            <ol className="concepts">
              <li><span className="concept-number">01</span><h3>Publish & subscribe</h3><p>Send and receive messages through a common interface.</p></li>
              <li><span className="concept-number">02</span><h3>Route to handlers</h3><p>Connect incoming messages to your application logic.</p></li>
              <li><span className="concept-number">03</span><h3>Compose middleware</h3><p>Add concerns like retries and logging around handlers.</p></li>
            </ol>
            <div className="transport-line"><span>CHOOSE YOUR TRANSPORT</span><p>Kafka <b>·</b> RabbitMQ <b>·</b> PostgreSQL <b>·</b> and more</p></div>
          </div>
          <div className="slide-footer"><a href="https://watermill.io/learn/getting-started/" target="_blank" rel="noreferrer">watermill.io / getting started ↗</a><span>ONE API. DIFFERENT TRANSPORTS.</span></div>
        </div>
      </Slide>
      {reportStories.map(story => <Slide key={story.mode} id={`report-${story.mode}`} notes={story.notes}>
        <div className="slide-content report-slide"><SlideHeader section={story.step} /><ReportSlide story={story} /><div className="slide-footer"><span>SOURCE: apps/api/internal/server/reports.go</span><span>MOVE WORK → HANDLE IT → RETRY IT → PRESERVE IT</span></div></div>
      </Slide>)}
    </Deck>
  )
}
