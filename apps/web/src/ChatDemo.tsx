import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './ChatDemo.css'

type ChatMessage = { id: string; name: string; text: string; sentAt: string }
type Stats = { subscribers: number; published: number; enqueued: number; slowDisconnects: number }
type Trace = { message: ChatMessage; published: boolean; clients: string[] }
function parseMessage(value: unknown): ChatMessage {
  if (!value || typeof value !== 'object') throw new Error('Invalid event')
  const message = value as Record<string, unknown>
  if (!['id', 'name', 'text', 'sentAt'].every(key => typeof message[key] === 'string')) throw new Error('Invalid event')
  return message as ChatMessage
}

function ChatClient({ name, onPublish, onReceive }: { name: string; onPublish: (message: ChatMessage) => void; onReceive: (name: string, message: ChatMessage) => void }) {
  const [connected, setConnected] = useState(true)
  const [status, setStatus] = useState('Connecting')
  const [subscriber, setSubscriber] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const feed = useRef<HTMLOListElement>(null)
  useEffect(() => { if (feed.current) feed.current.scrollTop = feed.current.scrollHeight }, [messages])
  useEffect(() => {
    if (!connected) return
    const stream = new EventSource('/api/chat/events')
    stream.addEventListener('ready', event => {
      try {
        const data = JSON.parse((event as MessageEvent<string>).data) as { subscriberId?: unknown }
        setSubscriber(typeof data.subscriberId === 'string' ? data.subscriberId : '')
        setStatus('Live')
      } catch { setStatus('Invalid ready event') }
    })
    stream.addEventListener('chat', event => {
      try {
        const message = parseMessage(JSON.parse((event as MessageEvent<string>).data))
        setMessages(previous => [...previous.filter(item => item.id !== message.id), message].slice(-50))
        onReceive(name, message)
      } catch { setError('An invalid chat event was ignored.') }
    })
    stream.onerror = () => setStatus('Reconnecting')
    return () => stream.close()
  }, [connected, name, onReceive])
  async function send(event: FormEvent) {
    event.preventDefault()
    if (!text.trim() || pending) return
    setPending(true); setError('')
    try {
      const response = await fetch('/api/chat/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, text: text.trim() }) })
      if (!response.ok) throw new Error(`Send failed (${response.status}). Try again.`)
      const message = parseMessage(await response.json())
      onPublish(message)
      setText('')
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not send message.') }
    finally { setPending(false) }
  }
  return <section className="chat-client" aria-label={`${name}'s chat`}>
    <header className="client-header"><div className={`client-avatar ${name.toLowerCase()}`}>{name[0]}</div><div><h2>{name}</h2><span role="status" className={`connection ${connected && status === 'Live' ? 'live' : ''}`}>{connected ? status : 'Disconnected'}</span></div><button className="secondary" onClick={() => { setStatus('Connecting'); setSubscriber(''); setConnected(value => !value) }}>{connected ? `Disconnect ${name}` : `Reconnect ${name}`}</button></header>
    <p className="stream-id">Own EventSource → own Watermill subscription{subscriber ? ` · ${subscriber.slice(0, 8)}` : ''}</p>
    <ol ref={feed} className="chat-feed" aria-label={`${name}'s received messages`} aria-live="polite" aria-relevant="additions">
      {messages.length === 0 && <li className="empty-chat">Send a message. It appears here only when this client receives its SSE event.</li>}
      {messages.map(message => <li key={message.id} className={message.name === name ? 'own-message' : ''}><div><strong>{message.name}</strong><time dateTime={message.sentAt}>{new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div><p>{message.text}</p><small>event {message.id.slice(0, 8)}</small></li>)}
    </ol>
    <form onSubmit={send}><label htmlFor={`message-${name}`}>Send as {name}</label><div className="compose"><input id={`message-${name}`} maxLength={500} value={text} onChange={event => setText(event.target.value)} placeholder="Hello, Boston!" /><button disabled={pending || !text.trim()} type="submit">{pending ? 'Sending…' : 'Send →'}</button></div></form>
    {error && <p className="chat-error" role="alert">{error}</p>}
  </section>
}

export default function ChatDemo() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [statsError, setStatsError] = useState(false)
  const [traces, setTraces] = useState<Trace[]>([])
  const record = useCallback((message: ChatMessage, client?: string) => {
    setTraces(previous => {
      const existing = previous.find(trace => trace.message.id === message.id)
      const trace = { message, published: existing?.published === true || !client, clients: [...new Set([...(existing?.clients ?? []), ...(client ? [client] : [])])] }
      return [trace, ...previous.filter(item => item.message.id !== message.id)].slice(0, 8)
    })
  }, [])
  const onPublish = useCallback((message: ChatMessage) => record(message), [record])
  const onReceive = useCallback((name: string, message: ChatMessage) => record(message, name), [record])
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const response = await fetch('/api/chat/stats', { signal: controller.signal })
        if (!response.ok) throw new Error('Stats unavailable')
        const data = await response.json() as Stats
        if (!['subscribers', 'published', 'enqueued', 'slowDisconnects'].every(key => Number.isFinite(data[key as keyof Stats]))) throw new Error('Invalid stats')
        if (!controller.signal.aborted) { setStats(data); setStatsError(false) }
      } catch { if (!controller.signal.aborted) setStatsError(true) }
      if (!controller.signal.aborted) timer = setTimeout(poll, 1000)
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [])
  return <main className="chat-demo">
    <header className="demo-heading"><a href="/#/chat-flow">← Back to slides</a><span>BOSTON GOLANG / LIVE LAB</span></header>
    <div className="demo-title"><p className="demo-eyebrow">ONE PUBLICATION. TWO INDEPENDENT STREAMS.</p><h1>Watch the message move.</h1><p>Send from either client. Disconnect Bob, send again, then reconnect him. Alice keeps receiving; Bob’s missed messages are not replayed.</p></div>
    <section className="pipeline" aria-label="Live server metrics"><div><span>HTTP POST</span><strong>{stats?.published ?? '—'}</strong><small>published messages</small></div><span className="pipeline-arrow" aria-hidden="true">→</span><div className="watermill-stage"><span>WATERMILL · GOCHANNEL</span><strong>{stats?.subscribers ?? '—'}</strong><small>active subscriptions</small></div><span className="pipeline-arrow" aria-hidden="true">→</span><div><span>SSE BRIDGES</span><strong>{stats?.enqueued ?? '—'}</strong><small>accepted into queues, not browser ACKs</small></div></section>
    {statsError && <p role="status" className="chat-error">Live metrics unavailable. Is the Go API running? Displayed values may be stale.</p>}
    <div className="chat-clients"><ChatClient name="Alice" onPublish={onPublish} onReceive={onReceive} /><ChatClient name="Bob" onPublish={onPublish} onReceive={onReceive} /></div>
    <section className="delivery-tracker" aria-label="Observed message deliveries"><div className="tracker-header"><h2>Proof of fan-out</h2><span>Actual event IDs · last 8 observed messages</span></div><p>“Received” means this browser’s event listener ran. POST acceptance and SSE arrival can happen in either order.</p>{traces.length === 0 ? <p className="trace-empty">No messages yet. Send one to light up the path.</p> : <ol>{traces.map(trace => <li key={trace.message.id}><code>{trace.message.id.slice(0, 8)}</code><span className="trace-message">{trace.message.text}</span><span className={`receipt ${trace.published ? 'received' : ''}`}>{trace.published ? 'POST accepted' : 'SSE observed'}</span>{['Alice', 'Bob'].map(name => <span key={name} className={`receipt ${trace.clients.includes(name) ? 'received' : ''}`}>{name}: {trace.clients.includes(name) ? 'received ✓' : 'not observed'}</span>)}</li>)}</ol>}</section>
    <footer className="demo-footnote"><strong>Local teaching demo, not production chat.</strong> In-memory, single process, no history, durable replay, authentication, or exactly-once guarantee. Each pane keeps its latest 50 messages. Slow clients are disconnected rather than buffering forever. Slow-client disconnects: {stats?.slowDisconnects ?? '—'}.</footer>
  </main>
}
