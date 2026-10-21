# Boston Golang · October 26, 2026

A seven-slide Watermill talk by Matt Spurlin, Senior Software Engineer at Datadog. React + the official reveal.js React integration renders the slides; Go/Fiber runs real background report workers.

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

The title, speaker bio, and Watermill introduction lead into four deliberately small demonstrations:

1. **Move work out of the request.** A real Watermill GoChannel publication delivers one request to a subscriber. The request is handled in the background and explicitly acknowledged. The UI shows Queued → Processing → Ready and a small synthetic CSV.
2. **Give the worker a handler.** A real Watermill Router invokes the same report function. It owns acknowledgement: successful return means Ack; an error means failure/Nack unless middleware handles it. This slide runs the successful path; the next exercises errors.
3. **Retry a temporary failure.** The handler fails twice and succeeds on its third invocation. Watermill's actual Retry middleware performs the retries with bounded fixed delays. The message ID stays the same. There is no frontend retry simulation.
4. **Keep work while the worker is offline.** The official Watermill SQLite adapter publishes to a file with no subscriber. The publisher and every database connection are closed. A new connection pool and Router subscriber open the same file, consuming the original request without publishing again.

Every demo starts automatically when its slide becomes active. It runs once, not continuously; Replay starts a fresh isolated run. Polling only displays server observations. Leaving the slide, opening overview, or unmounting aborts polling and requests backend cancellation. Errors stop the scenario rather than silently restarting it.

### What the durability demo proves (and does not)

It proves real file-backed Watermill messages survive closing all database connections and can be consumed by a newly started worker/subscriber. It does **not** kill/restart the operating-system process, demonstrate recovery from a machine crash, or preserve the UI status registry across API restart. The queued message lives in SQLite, not in a custom imitation queue. The SQLite adapter is officially listed as **beta**.

The first three demos use GoChannel: in-process memory, no crash durability. The final run uses a separate temporary SQLite file. Each run deletes its temporary database only after its resources close. This is intentionally a finite teaching lifecycle, not a persistent production report service.

All four report outputs use deterministic synthetic rows. Replacing a run's CSV avoids accumulating a second artifact during retries, but is **not** a transactional idempotency mechanism or an exactly-once guarantee. Production side effects need durable idempotency keys, transaction/outbox design where appropriate, and explicit transport delivery semantics.

## Implementation map

- `apps/web/src/App.tsx`: seven-slide deck, notes, source excerpts.
- `apps/web/src/`: report UI, polling and reveal lifecycle tests.
- `apps/api/internal/server/reports.go`: Watermill publication, Router, Retry, SQLite lifecycle, cancellation and routes. The snippets on slides are extracted from this actual source using `demo:*` markers.
- `apps/api/internal/server/reports_test.go`: real API/worker integration tests, retries, lifecycle and persistent queue behavior.
- `scripts/build.sh`, `scripts/run.sh`: build and local preview.
- `scripts/api.mjs`: cross-platform Go commands.

The previous chat/SSE presentation remains in git history at `e911138`; it is no longer part of this teaching sequence or the running API.

## API and resource bounds

```text
POST   /api/reports/runs       {"mode":"publish"|"router"|"retry"|"durable"}
GET    /api/reports/runs/:id
DELETE /api/reports/runs/:id
GET    /api/health
GET    /api/message
```

POST returns 202 with a run ID, Watermill message ID, status, attempt count and real event timeline. GET returns the current snapshot and CSV when ready. DELETE is idempotent and cancels pending work; deleted/expired reads return 404. Invalid modes or malformed JSON return 400. At most 16 retained runs exist concurrently (503 when full). Each worker is limited to 20 seconds; snapshots expire after 90 seconds, including abandoned requests whose browsers never received a run ID. Each run has its own transport and subscriber. API shutdown cancels active work.

Only expose this unauthenticated demo on your own machine. Do not bind it publicly without authentication, rate limiting and an explicit operational design. Health is liveness only, not a SQLite dependency probe.

## Verify before presenting

```sh
npm run check          # lint/type checks, all tests (Go race), production builds
npm run test:web
npm run test:api
```

From `apps/api`, `go test -race ./...` runs backend checks. Use `gofmt -w apps/api` after Go edits. Dependency versions are pinned in npm's lockfile and Go module sums.

Manual rehearsal: visit all four live slides, verify the stable message ID, three retry attempts, queued/offline SQLite stage and Ready CSV. Leave during Processing, return, toggle overview, Replay, and stop the API to verify the visible error state. The flow should never invent successful progress if the API fails.

## Official references

- [Watermill getting started](https://watermill.io/learn/getting-started/)
- [Router](https://watermill.io/docs/messages-router/)
- [Middleware](https://watermill.io/docs/middlewares/)
- [GoChannel](https://watermill.io/pubsubs/gochannel/)
- [SQLite documentation](https://watermill.io/pubsubs/sqlite/)
- [Official SQLite adapter source](https://github.com/ThreeDotsLabs/watermill-sqlite)

This repository pins `github.com/ThreeDotsLabs/watermill-sqlite/wmsqlitemodernc` v0.1.2. The adapter's Publisher.Close does not close the supplied database handle; the demo explicitly closes both, then checks a newly opened pool with Ping.
