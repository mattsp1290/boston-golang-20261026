# Boston Golang · October 26, 2026

A fourteen-slide Watermill talk by Matt Spurlin, Senior Software Engineer at Datadog. React + the official reveal.js React integration renders the slides; Go/Fiber runs real background report workers.

## Run the talk

Requirements: Node.js 24.15+ (24.x recommended) or 26+, npm 10+, Go 1.26+. Go race tests also require a C compiler. The first three live demos need no database. The optional persistence chapter requires PostgreSQL 17, either your dedicated local database or the Compose service below. The build script only builds; the run script starts the local PostgreSQL container and waits for it before launching either application. Docker with Compose v2 is required for that default full-stack path.

```sh
./scripts/build.sh
./scripts/run.sh
```

Before the first run, configure the local password as described below. Open http://127.0.0.1:5173. Both applications must be running for the four live slides; the persistence slide also needs REPORT_POSTGRES_DSN. The first three introduction slides work offline. Arrow keys/swipe navigate, Escape toggles overview, S opens speaker notes. Ctrl-C stops both servers. Run from any working directory; scripts locate the repository themselves.

Development:

```sh
npm ci
npm run dev
```

React hot-reloads. Restart after Go changes. Optional root `.env` (see `.env.example`) controls `API_ADDR` and `API_PROXY_TARGET`; change both together for a different API port. Shell environment variables take precedence. Vite development and preview proxy `/api` to the Go server; both servers bind to loopback by default. These are local presentation tools, not a production deployment.

## PostgreSQL transport and full-stack startup

GoChannel is this talk's simple in-memory starting choice, not a universal Watermill default. Before running the full stack:

1. Copy `.env.example` to the untracked `.env` and set `REPORT_POSTGRES_PASSWORD` to a local password of your choice.
2. For default local Compose mode, the run script derives a URI-safe DSN in memory from that password. It does not write credentials. Never use a production database or commit credentials.
3. Build and run. The run script starts the official PostgreSQL service and waits for its health check:

```sh
./scripts/build.sh
./scripts/run.sh
```

The Compose service uses PostgreSQL 17, binds only to loopback, and keeps its database in a named volume. An existing dedicated PostgreSQL 17 instance is also fine: set REPORT_POSTGRES_DSN and run `./scripts/run.sh --external-postgres` to skip Compose explicitly. For in-memory lessons only, `./scripts/run.sh --memory-only` deliberately disables database setup. The demo user needs permission to create and drop its own message/offset tables. The other slides remain runnable without this configuration; the persistence slide shows an actionable error and pauses automatic replay rather than faking success.

Default startup requires Docker Compose v2 with `up --wait` support. It fails before launching either app if Docker, configuration, or database health is unavailable. `REPORT_POSTGRES_WAIT_SECONDS` controls the readiness deadline (default 60 seconds). `npm run dev` does not manage containers; start the database explicitly for hot-reload development.

The run script leaves the database container running when the presentation stops. Stop it without deleting data:

```sh
docker compose -f compose.postgres.yaml stop
```

Do not use `down -v` unless you intentionally want to erase the local database volume. The Compose health check verifies PostgreSQL readiness, not the application password. A password change in `.env` does not change credentials already initialized in a retained volume; use the original credentials or manage that local database explicitly.

## The story: generate a report

The title, speaker bio, and roadmap follow Watermill's **Publish → Handle → Middleware** journey. Each live demonstration has its own preceding explanatory slide, and a code-focused subscriber bridge separates delivery from application work:

1. **Publish: make a request available.** A live GoChannel subscriber is established first. Publish places one request in its buffered channel. The backend verifies availability without reading, invoking a handler, acknowledging, or generating a CSV. The terminal status is Published, not Ready. This demonstrates live in-memory delivery, not retention for an offline consumer.
2. **Subscriber bridge: receive, then decide.** Actual Subscribe/context/channel code shows how an application receives a message, invokes its work function, then calls Ack or Nack. Subscriber means the transport adapter, not the application handler. This explanatory bridge has no redundant end-to-end live demo.
3. **Handle: application code does the work.** The explanatory slide introduces Router wiring. The live Router demo delivers to the report handler and generates the synthetic CSV. The Router interprets nil/error and manages acknowledgement; the handler does not manually Ack.
4. **Middleware: wrap the same handler.** The explanation introduces wrappers before a focused Retry demo. Actual Watermill Retry fails twice and succeeds on call three with the same message. These are handler attempts within one delivery, not new publications or broker redeliveries.
5. **Advanced extension: choose durable transport.** After an explicit persistence explanation, the PostgreSQL demo swaps the Publisher and Subscriber adapters, publishes with no subscriber, closes the connections, opens new connections to the same database, then starts delivery. The application handler is unchanged. The focused diagram shows the storage boundary and consumer lifecycle, not another whole application pipeline.

“Worker” means an application process running subscriber/Router/handler code, not a separate Watermill primitive or a synonym for Subscriber. The main teaching diagrams name the concrete roles instead.

Every demo starts automatically when its slide becomes active and repeats while that slide stays active. Each diagram focuses only on its chapter: publication, handling, a middleware wrapper, or durable storage. One identifiable message changes state based on observed server events. Retry stays at the same handler; the PostgreSQL scene keeps the message in the database before its Subscriber and Router start. An acknowledgement is shown only when the API reports the explicit Ack call. The projected stage contains only the focused diagram, observed state, and short labels. Code lives on separate explanation slides; full IDs remain available to assistive technology, and the Handle result uses the actual CSV. Detailed guarantees and source links are in speaker notes, not dashboard panels. Motion illustrates observed snapshots rather than measured transit time. Reduced-motion preferences preserve the same states without travel, spin or pulse animations. After Published or Ready, the finished result stays visible during a four-second countdown. The next cycle starts only after successful backend cleanup. A shared client-side start gate serializes canceled requests and late responses across navigation, overview and React remounts. Leaving the slide, opening overview, or unmounting stops polling/countdowns and cancels work. API or cleanup errors stop automatic cycling rather than creating a retry storm; server expiry remains a fallback for disconnected browsers. If creation has an unknown outcome and no usable run ID, the deck blocks further starts and asks you to wait 90 seconds before reloading. If an ID is known but cleanup fails, Try again retries cleanup before allowing a new run.

### What the durability demo proves (and does not)

It proves PostgreSQL-backed Watermill messages remain available after closing and reopening client database connections, then are consumed by a newly started Subscriber and Router. It does **not** kill/restart the operating-system process, demonstrate recovery from a machine crash, or preserve the UI status registry across API restart. The queued message lives in PostgreSQL via the official Watermill SQL adapter, not in a custom imitation queue. The PostgreSQL server stays running throughout.

The first three live demos use GoChannel: in-process memory, no crash durability. The final run uses unique, generated message and offset table names in the configured dedicated database. Cleanup drops only those run-owned tables after the Subscriber/Router and connections have closed; it never drops a database. Database outages or an API crash can leave those isolated tables behind. Cleanup failures stop replay; DELETE can retry cleanup for a retained run, but the 16-run limit bounds only in-memory bookkeeping, not database garbage collection. Cleanup-failed runs retain a slot beyond the normal 90-second expiry until retried successfully or the API restarts. Use a dedicated demo database and inspect residual `watermill_messages_<run-id>` / `watermill_offsets_<run-id>` tables before removing them manually. This is intentionally a finite teaching lifecycle, not a persistent production report service.

The handling, middleware and durable demos generate deterministic synthetic rows; publishing alone does not generate a report. Replacing a run's CSV avoids accumulating a second artifact during retries, but is **not** a transactional idempotency mechanism or an exactly-once guarantee. Production side effects need durable idempotency keys, transaction/outbox design where appropriate, and explicit transport delivery semantics.

## Implementation map

- `apps/web/src/App.tsx`: fourteen-slide deck, notes, source excerpts.
- `apps/web/src/`: report UI, polling and reveal lifecycle tests.
- `apps/api/internal/server/reports.go`: Watermill publication, Router, Retry, PostgreSQL lifecycle, cancellation and routes. The snippets on slides are extracted from this actual source using `demo:*` markers.
- `apps/api/internal/server/reports_test.go`: real API/worker integration tests, retries, lifecycle and persistent queue behavior.
- `scripts/build.sh`, `scripts/run.sh`, `scripts/run.mjs`: build, PostgreSQL readiness, and local preview.
- `scripts/run.test.mjs`: mocked Docker/app startup, failure, timeout, and shutdown tests.
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

POST returns 202 with a run ID, Watermill message ID, status, attempt count and real event timeline. GET returns the current snapshot, terminal Published for publish-only, and CSV when report-generating modes are Ready. The retained subscribe API mode supports the explanatory code and regression tests but is not a separate live slide. DELETE is idempotent, cancels pending work, and waits for its run resources to close. Failed PostgreSQL cleanup returns 503 and can be retried for that retained run; deleted/expired reads return 404. Invalid modes or malformed JSON return 400. At most 16 retained runs exist concurrently (503 when full). Each run is limited to 20 seconds; normally completed snapshots expire after 90 seconds; failed database cleanup retains its bounded slot for retry. This includes abandoned requests whose browsers never received a run ID. Each run has its own transport and subscriber. API shutdown cancels active work.

Only expose this unauthenticated demo on your own machine. Do not bind it publicly without authentication, rate limiting and an explicit operational design. Health is liveness only, not a PostgreSQL dependency probe.

## Verify before presenting

```sh
npm run check          # lint/type checks, script/web/API tests (Go race), builds
npm run test:web
npm run test:api
```

From `apps/api`, `go test -race ./...` runs backend checks. Real PostgreSQL integration tests require `TEST_REPORT_POSTGRES_DSN` pointing to a dedicated demo/test database; they explicitly skip when it is absent. For example, export that variable in your shell and run the same command. Use `go test -race -v ./...` to see individual integration skips; a default `npm run check` without this variable is not proof that database integration ran. Use `gofmt -w apps/api` after Go edits. Dependency versions are pinned in npm's lockfile and Go module sums.

Manual rehearsal: visit all four live slides, verify the stable message identity through accessible descriptions or API snapshots, publication-only Published state without CSV, three handler attempts, stored/not-started PostgreSQL stage, and the Handle demo’s Ready CSV. Leave during Processing, return, toggle overview, observe multiple countdown/replay cycles, and stop the API to verify the visible error state. The flow should never invent successful progress if the API fails.

## Official references

- [Watermill getting started](https://watermill.io/learn/getting-started/)
- [Publisher and Subscriber](https://watermill.io/docs/pub-sub/)
- [Router](https://watermill.io/docs/messages-router/)
- [Middleware](https://watermill.io/docs/middlewares/)
- [GoChannel](https://watermill.io/pubsubs/gochannel/)
- [SQL / PostgreSQL documentation](https://watermill.io/pubsubs/sql/)
- [Official SQL adapter source](https://github.com/ThreeDotsLabs/watermill-sql)

The official Watermill SQL adapter and PostgreSQL driver versions are pinned in `go.mod`/`go.sum`. Publisher shutdown and database connection shutdown are separate operations; the demo closes both before reconnecting.

### Projected-stage design

The deck uses a fixed 1920 × 1080 canvas, uniformly scaled by Reveal for 16:9 displays and letterboxed on 4:3 screens. It does not reflow into stacked website cards. Titles use 86 px design type and code uses 36 px, equivalent to approximately 57 px and 24 px at 1280 × 720. The approved slide-by-slide plan is in `docs/presentation-redesign-plan.md`.
