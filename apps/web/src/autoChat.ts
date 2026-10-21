export type DemoMessage = { id: string; name: string; text: string; sentAt: string }
export type ClientName = 'Alice' | 'Bob'
export type DemoCallbacks = {
  caption: (step: number, text: string) => void
  status: (name: ClientName, status: string) => void
  received: (name: ClientName, message: DemoMessage) => void
  published: (message: DemoMessage) => void
}

// A finite real-network scenario. Delays pace the narration; observed SSE events
// (not those delays or POST success) are what establish browser delivery.
export async function runChatScenario(parentSignal: AbortSignal, ui: DemoCallbacks) {
  const controller = new AbortController()
  const signal = AbortSignal.any([parentSignal, controller.signal])
  const streams = new Map<ClientName, EventSource>()
  const received = { Alice: new Set<string>(), Bob: new Set<string>() }
  let streamError: Error | undefined
  const check = () => { signal.throwIfAborted(); if (streamError) throw streamError }
  const delay = (ms: number) => new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
  const until = async (predicate: () => boolean, description: string) => {
    const deadline = Date.now() + 8000
    while (!predicate()) { check(); if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}.`); await delay(50) }
    check()
  }
  const disconnect = (name: ClientName) => { streams.get(name)?.close(); streams.delete(name); ui.status(name, 'Disconnected') }
  const closeAll = () => { for (const stream of streams.values()) stream.close(); streams.clear() }
  signal.addEventListener('abort', closeAll, { once: true })
  const connect = async (name: ClientName) => {
    check(); ui.status(name, 'Connecting')
    const stream = new EventSource('/api/chat/events'); streams.set(name, stream)
    let ready = false
    stream.addEventListener('ready', () => { if (!signal.aborted && streams.get(name) === stream) { ready = true; ui.status(name, 'Live') } })
    stream.addEventListener('chat', event => {
      if (signal.aborted || streams.get(name) !== stream) return
      try {
        const message = JSON.parse((event as MessageEvent<string>).data) as DemoMessage
        if (!message || !['id', 'name', 'text', 'sentAt'].every(key => typeof message[key as keyof DemoMessage] === 'string')) throw new Error('Malformed chat event')
        // Only four publications are expected; cap observations from other tabs too.
        if (received[name].size >= 100) received[name].delete(received[name].values().next().value!)
        received[name].add(message.id); ui.received(name, message)
      } catch { streamError = new Error('The API returned an invalid SSE message.') }
    })
    stream.onerror = () => { if (streams.get(name) === stream && !signal.aborted) { streamError = new Error(`${name} lost the server connection.`); ui.status(name, 'Connection error'); stream.close() } }
    await until(() => ready, `${name}'s subscription`)
  }
  const publish = async (name: ClientName, text: string, audience: ClientName[]) => {
    check()
    const response = await fetch('/api/chat/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, text }), signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) })
    if (!response.ok) throw new Error(`The API rejected a message (${response.status}).`)
    const message = await response.json() as DemoMessage
    check()
    if (!message || typeof message.id !== 'string' || message.text !== text || message.name !== name) throw new Error('Invalid publish response.')
    ui.published(message)
    await until(() => audience.every(client => received[client].has(message.id)), 'actual SSE delivery')
    return message
  }
  try {
    ui.caption(1, 'Connecting two independent browsers to the same Watermill topic…')
    await Promise.all([connect('Alice'), connect('Bob')]); await delay(1800)
    ui.caption(2, 'Alice publishes once. Both browsers receive the same message ID.')
    await publish('Alice', 'Hello Boston! One publication, two deliveries.', ['Alice', 'Bob']); await delay(3800)
    ui.caption(3, 'Bob replies through HTTP POST. Watermill fans out again.')
    await publish('Bob', 'Hi Alice! I received your message over SSE.', ['Alice', 'Bob']); await delay(3800)
    ui.caption(4, 'Disconnect Bob. Alice stays connected and keeps receiving.')
    disconnect('Bob'); await delay(1800)
    const missed = await publish('Alice', 'Bob is offline. Only Alice receives this message.', ['Alice']); await delay(4000)
    if (received.Bob.has(missed.id)) throw new Error('Unexpected delivery to the disconnected browser.')
    ui.caption(5, 'Reconnect Bob: live-only GoChannel does not replay the missed message.')
    await connect('Bob'); await delay(2200)
    await publish('Bob', 'Back online! New messages reach both browsers again.', ['Alice', 'Bob']); await delay(3500)
    check()
    if (received.Bob.has(missed.id)) throw new Error('Unexpected replay of the offline message.')
    ui.caption(6, 'Complete: four publications. Alice received all four; Bob missed the offline message. Leave and return to replay.')
  } finally {
    closeAll(); controller.abort(); signal.removeEventListener('abort', closeAll)
    if (!parentSignal.aborted) { ui.status('Alice', 'Run ended'); ui.status('Bob', 'Run ended') }
  }
}
