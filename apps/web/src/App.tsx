import { useEffect, useState } from 'react'
import { getMessage } from './api'
import './App.css'

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; message: string; topic: string }

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getMessage(controller.signal)
      .then((data) => setState({ status: 'ready', ...data }))
      .catch(() => { if (!controller.signal.aborted) setState({ status: 'error' }) })
    return () => controller.abort()
  }, [attempt])

  function refresh() {
    setState({ status: 'loading' })
    setAttempt((value) => value + 1)
  }

  return (
    <main>
      <header><span className="wordmark">BOSTON / GOLANG</span><span className="date">OCT 26, 2026</span></header>
      <section className="intro">
        <p className="eyebrow">THE STARTING POINT</p>
        <h1>Small pieces.<br /><span>Connected.</span></h1>
        <p className="description">A talk on Watermill. A React frontend and a Go API, ready for what comes next.</p>
      </section>
      <section className="connection" aria-label="API connection">
        <div className="connection-heading"><h2>Frontend meets backend</h2><span className={`badge ${state.status}`}>{state.status === 'ready' ? 'CONNECTED' : state.status === 'loading' ? 'CONNECTING' : 'OFFLINE'}</span></div>
        <div role="status" aria-live="polite" className="response">
          {state.status === 'ready' && <><p className="message">{state.message}</p><p className="detail">{state.topic}</p></>}
          {state.status === 'loading' && <p className="message">Reaching the API…</p>}
          {state.status === 'error' && <><p className="message">The API isn’t responding.</p><p className="detail">Start the Go server, then try again.</p></>}
        </div>
        <div className="connection-footer"><code>GET /api/message</code><button onClick={refresh} disabled={state.status === 'loading'}>{state.status === 'error' ? 'Try again' : 'Send another request'} <span aria-hidden="true">↗</span></button></div>
      </section>
      <footer><span>React + TypeScript</span><span className="line" /><span>Go + Fiber</span></footer>
    </main>
  )
}
