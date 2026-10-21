# Boston Golang · October 26, 2026

A talk on Watermill. This monorepo starts with a TypeScript/React frontend and a Go/Fiber JSON API. Watermill itself is not wired in yet; the working request/response path is the foundation for the talk.

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

Open http://127.0.0.1:5173. The React page fetches `/api/message` through Vite's proxy to the API at http://127.0.0.1:3000. The page shows loading, success, and recoverable error states. No CORS configuration is needed for this same-origin development flow.

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
    src/                 # React UI, typed API client, component/client tests
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
