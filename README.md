# Boston Golang · October 26, 2026

A twelve-slide Watermill talk by Matt Spurlin, Senior Software Engineer at Datadog. React + the official reveal.js React integration renders the slides; Go/Fiber runs real background report workers.

## Run the talk

Requirements: Node.js 24.15+ (24.x recommended) or 26+, npm 10+, Go 1.26+. Go race tests also require a C compiler. SQLite itself uses the pure-Go modernc driver: no database server, Docker, CGO, email provider, or account setup is required for the demos.

```sh
./scripts/build.sh
./scripts/run.sh
```

Open http://127.0.0.1:5173. Both applications must be running for the four live slides. The first three introduction slides work offline. Arrow keys/swipe navigate, Escape toggles overview, S opens speaker notes. Ctrl-C stops both servers. Run from any working directory; scripts locate the repository themselves.

Development:

```sh
npm ci
npm run dev
```

React hot-reloads. Restart after Go changes. Optional root `.env` (see `.env.example`) controls `API_ADDR` and `API_PROXY_TARGET`; change both together for a different API port. Shell environment variables take precedence. Vite development and preview proxy `/api` to the Go server; both servers bind to loopback by default. These are local presentation tools, not a production deployment.

## The story: generate a report

The title, speaker bio, and roadmap follow Watermill's **Publish → Handle → Middleware** journey. Each live demonstration has its own preceding explanatory slide, and a code-focused subscriber bridge separates delivery from application work:

1. **Publish: make a request available.** A live GoChannel subscriber is established first. Publish places one request in its buffered channel. The backend verifies availability without reading, invoking a handler, acknowledging, or generating a CSV. The terminal status is Published, not Ready. This demonstrates live in-memory delivery, not retention for an offline consumer.
2. **Subscriber bridge: receive, then decide.** Actual Subscribe/context/channel code shows how an application receives a message, invokes its work function, then calls Ack or Nack. Subscriber means the transport adapter, not the application handler. This explanatory bridge has no redundant end-to-end live demo.
3. **Handle: application code does the work.** The explanatory slide introduces Router wiring. The live Router demo delivers to the report handler and generates the synthetic CSV. The Router interprets nil/error and manages acknowledgement; the handler does not manually Ack.
4. **Middleware: wrap the same handler.** The explanation introduces wrappers before a focused Retry demo. Actual Watermill Retry fails twice and succeeds on call three with the same message. These are handler attempts within one delivery, not new publications or broker redeliveries.
5. **Advanced extension: choose durable transport.** After an explicit persistence explanation, the SQLite demo publishes with no subscriber, closes every connection, reopens the same file, then starts a consumer. The focused diagram shows the storage boundary and consumer lifecycle, not another whole application pipeline.

“Worker” means an application process running subscriber/Router/handler code, not a separate Watermill primitive or a synonym for Subscriber. The main teaching diagrams name the concrete roles instead.

Every demo starts automatically when its slide becomes active and repeats while that slide stays active. Each diagram focuses only on its chapter: publication, handling, a middleware wrapper, or durable storage. One identifiable message changes state based on observed server events. Retry stays at the same handler; the SQLite scene keeps the message on disk while its worker is offline. An acknowledgement is shown only when the API reports the explicit Ack call. Short labels accompany the icons; code, full IDs, the CSV preview and the event log are secondary. Motion illustrates observed snapshots rather than measured transit time. Reduced-motion preferences preserve the same states without travel, spin or pulse animations. After Published or Ready, the finished result stays visible during a four-second countdown. The next cycle starts only after successful backend cleanup. A shared client-side start gate serializes canceled requests and late responses across navigation, overview and React remounts. Leaving the slide, opening overview, or unmounting stops polling/countdowns and cancels work. API or cleanup errors stop automatic cycling rather than creating a retry storm; server expiry remains a fallback for disconnected browsers. If creation has an unknown outcome and no usable run ID, the deck blocks further starts and asks you to wait 90 seconds before reloading. If an ID is known but cleanup fails, Try again retries cleanup before allowing a new run.

### What the durability demo proves (and does not)

It proves real file-backed Watermill messages survive closing all database connections and can be consumed by a newly started subscriber and Router. It does **not** kill/restart the operating-system process, demonstrate recovery from a machine crash, or preserve the UI status registry across API restart. The queued message lives in SQLite, not in a custom imitation queue. The SQLite adapter is officially listed as **beta**.

The first three live demos use GoChannel: in-process memory, no crash durability. The final run uses a separate temporary SQLite file. Each run deletes its temporary database only after its resources close. This is intentionally a finite teaching lifecycle, not a persistent production report service.

The handling, middleware and durable demos generate deterministic synthetic rows; publishing alone does not generate a report. Replacing a run's CSV avoids accumulating a second artifact during retries, but is **not** a transactional idempotency mechanism or an exactly-once guarantee. Production side effects need durable idempotency keys, transaction/outbox design where appropriate, and explicit transport delivery semantics.

## Implementation map

- `apps/web/src/App.tsx`: twelve-slide deck, notes, source excerpts.
- `apps/web/src/`: report UI, polling and reveal lifecycle tests.
- `apps/api/internal/server/reports.go`: Watermill publication, Router, Retry, SQLite lifecycle, cancellation and routes. The snippets on slides are extracted from this actual source using `demo:*` markers.
- `apps/api/internal/server/reports_test.go`: real API/worker integration tests, retries, lifecycle and persistent queue behavior.
- `scripts/build.sh`, `scripts/run.sh`: build and local preview.
- `scripts/api.mjs`: cross-platform Go commands.

The previous chat/SSE presentation remains in git history at `e911138`; it is no longer part of this teaching sequence or the running API.

## API and resource bounds

```text
POST   /api/reports/runs       {"mode":"publish"|"subscribe"|"router"|"retry"|"durable"}
GET    /api/reports/runs/:id
DELETE /api/reports/runs/:id
GET    /api/health
GET    /api/message
```

POST returns 202 with a run ID, Watermill message ID, status, attempt count and real event timeline. GET returns the current snapshot, terminal Published for publish-only, and CSV when report-generating modes are Ready. The retained subscribe API mode supports the explanatory code and regression tests but is not a separate live slide. DELETE is idempotent, cancels pending work, and waits for its run resources to close before returning; deleted/expired reads return 404. Invalid modes or malformed JSON return 400. At most 16 retained runs exist concurrently (503 when full). Each run is limited to 20 seconds; snapshots expire after 90 seconds, including abandoned requests whose browsers never received a run ID. Each run has its own transport and subscriber. API shutdown cancels active work.

Only expose this unauthenticated demo on your own machine. Do not bind it publicly without authentication, rate limiting and an explicit operational design. Health is liveness only, not a SQLite dependency probe.

## Verify before presenting

```sh
npm run check          # lint/type checks, all tests (Go race), production builds
npm run test:web
npm run test:api
```

From `apps/api`, `go test -race ./...` runs backend checks. Use `gofmt -w apps/api` after Go edits. Dependency versions are pinned in npm's lockfile and Go module sums.

Manual rehearsal: visit all four live slides, verify the stable message ID, publication-only Published state without CSV, three handler attempts, retained/offline SQLite stage, and the Handle demo’s Ready CSV. Leave during Processing, return, toggle overview, observe multiple countdown/replay cycles, and stop the API to verify the visible error state. The flow should never invent successful progress if the API fails.

## Official references

- [Watermill getting started](https://watermill.io/learn/getting-started/)
- [Publisher and Subscriber](https://watermill.io/docs/pub-sub/)
- [Router](https://watermill.io/docs/messages-router/)
- [Middleware](https://watermill.io/docs/middlewares/)
- [GoChannel](https://watermill.io/pubsubs/gochannel/)
- [SQLite documentation](https://watermill.io/pubsubs/sqlite/)
- [Official SQLite adapter source](https://github.com/ThreeDotsLabs/watermill-sqlite)

This repository pins `github.com/ThreeDotsLabs/watermill-sqlite/wmsqlitemodernc` v0.1.2. The adapter's Publisher.Close does not close the supplied database handle; the demo explicitly closes both, then checks a newly opened pool with Ping.
