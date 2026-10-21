import { useEffect, useRef, useState } from 'react'
import { useReveal } from '@revealjs/react'
import { runChatScenario } from './autoChat'
import type { ClientName, DemoMessage } from './autoChat'
import './AutoChatSlide.css'

export function AutomatedChat() {
  const feeds = useRef<Partial<Record<ClientName, HTMLOListElement>>>({})
  const [caption, setCaption] = useState('Preparing the live demo…')
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')
  const [status, setStatus] = useState({ Alice: 'Waiting', Bob: 'Waiting' })
  const [messages, setMessages] = useState<Record<ClientName, DemoMessage[]>>({ Alice: [], Bob: [] })
  const [published, setPublished] = useState<DemoMessage[]>([])
  useEffect(() => { for (const feed of Object.values(feeds.current)) feed.scrollTop = feed.scrollHeight }, [messages])
  useEffect(() => {
    const controller = new AbortController()
    void runChatScenario(controller.signal, {
      caption: (step, text) => { setStep(step); setCaption(text) },
      status: (name, value) => setStatus(previous => ({ ...previous, [name]: value })),
      received: (name, message) => setMessages(previous => ({ ...previous, [name]: [...previous[name].filter(item => item.id !== message.id), message].slice(-8) })),
      published: message => setPublished(previous => [...previous, message]),
    }).catch(error => { if (!controller.signal.aborted) setError(`${error instanceof Error ? error.message : 'Demo failed.'} Start the Go API, then leave this slide and return to retry.`) })
    return () => controller.abort()
  }, [])
  return <div className="auto-chat">
    <div className="auto-caption" role="status"><span>LIVE SCENARIO · {step}/6</span><p>{error || caption}</p></div>
    <div className="auto-route"><span>HTTP POST: {published.length} accepted</span><b>→ WATERMILL →</b><span>Independent SSE streams</span></div>
    <div className="auto-clients">{(['Alice', 'Bob'] as const).map(name => <section key={name} aria-label={`${name}'s automatic chat`}><header><h3>{name}</h3><span className={status[name] === 'Live' ? 'is-live' : ''}>{status[name]}</span></header><ol ref={element => { if (element) feeds.current[name] = element; else delete feeds.current[name] }} aria-live="polite">{messages[name].map(message => <li key={message.id}><strong>{message.name}</strong><p>{message.text}</p><small>received · {message.id.slice(0, 8)}</small></li>)}</ol></section>)}</div>
    <p className="auto-limits">Real API + real SSE. In-memory, live only, no replay. Receipt badges appear only after browser events. The finite run closes its streams when finished.</p>
  </div>
}

export default function AutoChatSlide() {
  const deck = useReveal()
  const [active, setActive] = useState(false)
  useEffect(() => {
    if (!deck) return
    const update = () => setActive(deck.getCurrentSlide()?.id === 'chat-demo' && !deck.isOverview())
    update()
    deck.on('slidechanged', update); deck.on('overviewshown', update); deck.on('overviewhidden', update)
    return () => { deck.off('slidechanged', update); deck.off('overviewshown', update); deck.off('overviewhidden', update) }
  }, [deck])
  return active ? <AutomatedChat /> : <p className="auto-waiting">The live scenario starts automatically when this slide is active.</p>
}
