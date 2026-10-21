import { Deck, Slide } from '@revealjs/react'
import type { DeckProps } from '@revealjs/react'
import RevealNotes from 'reveal.js/plugin/notes'
import 'reveal.js/reveal.css'
import './App.css'

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
    </Deck>
  )
}
