import { Deck, Slide } from '@revealjs/react'
import type { DeckProps } from '@revealjs/react'
import RevealNotes from 'reveal.js/plugin/notes'
import 'reveal.js/reveal.css'
import './App.css'
import chatSource from '../../api/internal/server/chat.go?raw'

function sourceExcerpt(name: string) {
  return chatSource.split(`// demo:${name}:start`)[1].split(`// demo:${name}:end`)[0].trim()
}

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
      <Slide id="chat-flow" notes="A browser sends messages with HTTP POST. Server-Sent Events are a separate, one-way server-to-browser response held open by EventSource. This is not WebSockets or bidirectional SSE. The POST handler validates input and publishes one Watermill message. The code below is extracted directly from the running API source. Open the demo, send from Alice, and compare the same message ID in both panes.">
        <div className="slide-content chat-slide">
          <SlideHeader section="03 / A REAL-TIME CHAT ROOM" />
          <div className="intro-body"><p className="eyebrow">TWO DIRECTIONS. TWO SIMPLE TOOLS.</p><h2>POST to speak.<br /><span className="accent">SSE to listen.</span></h2>
            <div className="chat-architecture"><span>Browser → HTTP POST</span><span>Fiber → Watermill topic</span><span>SSE → every connected browser</span></div>
            <div className="chat-explanation"><p>HTTP accepts the message once. EventSource keeps a receive-only connection open. Watermill separates publishing from live delivery.</p><pre aria-label="Actual Go publish implementation"><code>{sourceExcerpt('publish')}</code></pre></div>
          </div>
          <div className="slide-footer"><span>ACTUAL SOURCE: apps/api/internal/server/chat.go</span><a href="/demo">Open the live chat demo ↗</a></div>
        </div>
      </Slide>
      <Slide id="chat-fanout" notes="Each EventSource connection has its own Watermill subscription. Sharing one Go channel between browsers would distribute messages instead of broadcasting. GoChannel is in-process and live-only: no durable broker, no missed-message replay, and no exactly-once guarantee. We bound connections and queues, admit one publisher at a time, Ack at the SSE queue boundary, and disconnect slow consumers. Ack does not prove browser delivery. Demo: send once; see Alice and Bob receive the same ID. Disconnect Bob, send again, then reconnect Bob: the missed message stays missing. Open a second tab to prove these are actual server connections.">
        <div className="slide-content chat-slide">
          <SlideHeader section="04 / WHERE WATERMILL HELPS" />
          <div className="intro-body"><p className="eyebrow">ONE PUBLICATION. INDEPENDENT SUBSCRIBERS.</p><h2>Publish once.<br /><span className="accent">Fan out to the room.</span></h2>
            <div className="chat-explanation"><pre aria-label="Actual Watermill configuration"><code>{sourceExcerpt('bus') + '\n\n' + sourceExcerpt('subscribe')}</code></pre><div><h3>Watch the boundary</h3><p>Send a message. Match its ID in Alice and Bob. Disconnect Bob and send again: Alice keeps receiving.</p><p className="chat-caveat">Local GoChannel demo: bounded queues, live only, no replay. An Ack means queued for SSE, not read by a browser. Production needs explicit durability and delivery design.</p><a className="demo-button" href="/demo">Launch live demo →</a></div></div>
          </div>
          <div className="slide-footer"><a href="https://watermill.io/pubsubs/gochannel/" target="_blank" rel="noreferrer">WATERMILL / GOCHANNEL ↗</a><span>NO BROKER REQUIRED FOR THIS DEMO.</span></div>
        </div>
      </Slide>
    </Deck>
  )
}
