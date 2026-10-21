# Boston Golang · October 26, 2026

A talk on Watermill. This monorepo contains a three-slide React presentation and a Go/Fiber JSON API. The presentation introduces the library; Watermill itself is not wired into the API yet.

## Requirements

- Node.js 24.15+ within the 24 LTS line recommended (`.nvmrc`), or Node 26+. The test dependencies require this newer baseline.
- npm 10+.
- Go 1.26+ (required by Fiber v3). Tests use Go's race detector, so a C compiler is required on supported platforms.

## Start developing

```sh
npm ci
# Optional: cp .env.example .env
npm run dev
```

Open http://127.0.0.1:5173 for the presentation. The deck is self-contained and does not need the API; `npm run dev:web` is sufficient for presenting. The original JSON API remains at http://127.0.0.1:3000, with Vite proxying `/api/*` during development. No CORS configuration is needed for this same-origin development flow.

React changes hot-reload. The API is compiled on startup; restart `npm run dev` after Go changes. Ctrl-C stops both servers. Either server failing also stops the other. Both bind to loopback by default.

To run them separately:

```sh
npm run dev:api
npm run dev:web
```

The optional root `.env` controls `API_ADDR` and `API_PROXY_TARGET`. Change both together when moving the API port. Shell environment variables take precedence. `API_PROXY_TARGET` is server-side configuration, not a browser secret. Never put secrets in `VITE_*` variables.

## Commands

Run from the repository root:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the API and Vite together |
| `npm run build` | Type-check and bundle React, compile Go |
| `npm test` | Frontend tests and Go tests with race detector |
| `npm run lint` | Oxlint, TypeScript, gofmt check, and go vet |
| `npm run check` | Lint, tests, and production builds |
| `npm run build:web` / `npm run build:api` | Build one application |
| `npm run test:web` / `npm run test:api` | Test one application |

Go-only commands work from `apps/api`, for example `go test -race ./...`. Format Go with `gofmt -w apps/api` from the root. The npm workspace lockfile and Go module sums are committed for reproducible dependency installation.

## Layout

```text
apps/
  api/
    cmd/server/          # Entrypoint, environment, graceful shutdown
    internal/server/     # Fiber application, routes, HTTP tests
    go.mod / go.sum
  web/
    src/                 # React slides, theme, typed API client, tests
    vite.config.ts       # Local /api proxy
scripts/api.mjs          # Cross-platform Go build/test/lint/dev commands
.env.example
package.json / package-lock.json
```

## API

- `GET /api/health` → `{"status":"ok","service":"boston-golang-api"}`. Liveness only; no dependencies are checked.
- `GET /api/message` → `{"message":"Hello from Go + Fiber!","topic":"A talk on Watermill"}`.
- Unknown routes return a JSON error with HTTP 404.

Smoke-test the running development stack:

```sh
curl --fail http://127.0.0.1:3000/api/health
curl --fail http://127.0.0.1:5173/api/message
```

## Production outputs

`npm run build` creates `apps/web/dist/` and `bin/api` (`bin/api.exe` on Windows). Run the API with `API_ADDR=127.0.0.1:3000 ./bin/api`. Serve `apps/web/dist/` with a static web server and route `/api/*` to the Go process on the same origin. Vite's development proxy is not part of the production bundle, and `vite preview` is not a production server. Configure an appropriate bind address, TLS/reverse proxy, and process supervisor for the deployment environment.

No database, auth system, container platform, or deployment provider is assumed.

## Upstream references

- [React](https://react.dev/)
- [Vite guide](https://vite.dev/guide/)
- [Fiber v3 documentation](https://docs.gofiber.io/)
- [Go downloads](https://go.dev/dl/)

## Presenting

The three opening slides are:

1. **Watermill**: message-driven applications, the Go way.
2. **Who I am**: Matt Spurlin, Senior Software Engineer at Datadog, [mattsp1290](https://github.com/mattsp1290).
3. **What is Watermill?**: publishing/subscribing, routing to handlers, middleware, and transport choices.

Use the arrow keys, Space, on-screen arrows, or horizontal touch swipes to navigate. The progress bar and slide counter show your place. URLs include stable slide hashes (`#/title`, `#/speaker`, `#/watermill`) so slides can be linked directly. Press **S** for the native speaker view with per-slide notes, **Esc** for the overview, and **F** for fullscreen. A browser popup permission may be needed for speaker view. On narrow screens, content reflows and longer slides can scroll vertically. Reduced-motion preferences disable slide transitions.

Edit slide content and speaker notes in `apps/web/src/App.tsx`; the presentation theme is `apps/web/src/App.css`. The speaker details were supplied by the presenter. This is not a statement of Datadog endorsement. This is a web presentation, not a generated PowerPoint `.pptx` file.

### Library choice and sources

We use the official **@revealjs/react 0.2.2** wrapper with **reveal.js 6.0.2**, pinned exactly in the web package and lockfile. It supports the existing React 19 app, React-authored slides, lifecycle cleanup, keyboard/touch navigation, progress, speaker notes, and presenter view without building those features ourselves. The wrapper is a newer 0.x package, so versions are pinned and real deck initialization/navigation/StrictMode cleanup are tested. Spectacle was considered, but its then-current react-spring dependency advertised React peer ranges that did not include this app's React 19 version.

Official references checked for this implementation:

- [React integration and lifecycle](https://revealjs.com/react/)
- [Reveal speaker view](https://revealjs.com/speaker-view/)
- [Reveal configuration](https://revealjs.com/config/)
- [Watermill introduction](https://watermill.io/learn/getting-started/)
- [Publisher/subscriber semantics](https://watermill.io/docs/pub-sub/)
- [Watermill router](https://watermill.io/docs/messages-router/)

Watermill offers common interfaces across transports, not identical delivery guarantees. Speaker notes call out redelivery and idempotent handlers; the deck does not promise exactly-once processing.

## Live Watermill + SSE chat demo

Run `npm ci` and `npm run dev`, then open the Vite URL and navigate to the two new chat slides, or visit `/demo` directly. No broker, account, or external service is needed. This is a local teaching demo, not a publicly deployed chat service.

### Presenter runbook (about two minutes)

1. Explain the split: HTTP POST sends; browser `EventSource` receives one-way SSE.
2. Open **Launch live demo**. Wait for Alice and Bob to be connected. They are two independent real HTTP streams, not simulated clients.
3. Send from Alice. Compare the same message ID in the publish/fanout display and both chat panes. One publication becomes two independent subscriber queue entries.
4. Disconnect Bob. Send another message from Alice: Alice still receives it. Reconnect Bob: the missed message does **not** reappear because this is live-only pub/sub.
5. Open another demo tab to add two more actual subscribers. Server totals include all tabs; browser receipt indicators are local to the current tab.
6. Return to the deck with the demo's back link.

### What is actually running

`POST /api/chat/messages` validates `{ "name": "Alice", "text": "Hello" }`, publishes one JSON Watermill message to `chat.messages`, and returns 202 with its ID. `GET /api/chat/events` makes a new GoChannel subscription for each SSE connection. Each bridge queues the message, acknowledges Watermill, and streams `event: chat`. The initial `event: ready` confirms subscription registration. `GET /api/chat/stats` exposes active subscribers, successful publications, queued copies, and slow-client disconnections.

The slides extract their Go snippets from `apps/api/internal/server/chat.go` during the frontend build, rather than maintaining pretend copies. The backend uses Watermill v1.5.3 with Fiber v3.6.1. Read the implementation and its socket-level tests in that directory.

### Important limits and semantics

- Single process, in-memory GoChannel; no durable storage, missed-message replay, or exactly-once delivery. Restart loses all state. A publication with no subscribers is discarded. Switching to a broker requires a delivery design, not just changing a constructor.
- One actively admitted publication at a time; concurrent requests may receive 429 and can be retried manually. Blocking until queue-boundary acknowledgements prevents GoChannel from accumulating unlimited pending delivery goroutines.
- At most 16 active stream bridges, 32 queued messages per bridge, 4 KiB request bodies, 40-character names and 500-character messages. The browser displays only the last 50 messages.
- A slow full queue is disconnected, not negatively acknowledged into an immediate retry loop. Acknowledgement means **queued for SSE**, not delivered to or read by the browser. The UI distinguishes server queue counts from observed browser arrivals.
- SSE heartbeat every two seconds detects broken sockets on write; detection is not instantaneous. Per-flush five-second write deadlines bound slow socket writes. Shutdown cancels all subscriptions before closing the server. EventSource reconnects automatically but does not recover missed events.
- No authentication, room authorization, persistence, multi-instance coordination, or production rate limiting. Bind locally (the default); do not expose this teaching API to an untrusted network.

### Verification and primary sources

`npm run check` includes frontend behavior tests, Go race tests, builds, and real TCP/HTTP tests that open two SSE streams, publish once, compare IDs, close streams, verify cleanup, and confirm no historical replay. Hub tests additionally exercise slow queues, connection limits, concurrent subscriptions/publications, and shutdown.

- [Watermill GoChannel semantics](https://watermill.io/pubsubs/gochannel/)
- [Watermill v1.5.3 GoChannel source](https://github.com/ThreeDotsLabs/watermill/blob/v1.5.3/pubsub/gochannel/pubsub.go)
- [Fiber streaming API](https://docs.gofiber.io/next/api/ctx/#sendstreamwriter)
- [Fiber v3.6.1 context source](https://github.com/gofiber/fiber/blob/v3.6.1/ctx.go)
- [MDN: server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
