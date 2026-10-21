import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const composeArgs = ['compose', '-f', 'compose.postgres.yaml']
const stopCommand = 'docker compose -f compose.postgres.yaml stop postgres'
const flags = process.argv.slice(2)
const usage = `Usage: ./scripts/run.sh [--external-postgres | --memory-only]

Default: start the official local PostgreSQL container, wait for healthy, then
start the built API and web preview. Set REPORT_POSTGRES_PASSWORD in your shell
or untracked .env. The local DSN is derived from that password in memory.

--external-postgres  Use REPORT_POSTGRES_DSN without starting a container.
--memory-only        Skip PostgreSQL explicitly; the persistence demo is unavailable.

REPORT_POSTGRES_WAIT_SECONDS sets the health timeout (default: 60).
Ctrl-C stops the applications, but leaves PostgreSQL and its data intact.
To stop the local database, run from the repository: ${stopCommand}`

if (flags.length === 1 && ['--help', '-h'].includes(flags[0])) {
  console.log(usage)
  process.exit(0)
}
if (flags.length > 1 || (flags.length && !['--external-postgres', '--memory-only'].includes(flags[0]))) {
  console.error(usage)
  process.exit(1)
}

let activeChild
let stopSignal
const signalExitCode = () => stopSignal === 'SIGINT' ? 130 : 143
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopSignal ??= signal
    activeChild?.kill(signal)
  })
}

// No shell interpolation: passwords containing $, quotes, or shell syntax stay data.
function run(program, args, { capture = false, timeoutMs } = {}) {
  return new Promise((resolve) => {
    const child = spawn(program, args, {
      cwd: root,
      env: process.env,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    })
    activeChild = child
    let output = ''
    let timedOut = false
    let error
    let forceTimer
    if (capture) {
      child.stdout.on('data', (chunk) => { output += chunk })
      child.stderr.on('data', (chunk) => { output += chunk })
    }
    const timer = timeoutMs && setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      forceTimer = setTimeout(() => child.kill('SIGKILL'), 3000)
      forceTimer.unref()
    }, timeoutMs)
    child.on('error', (cause) => { error = cause })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      clearTimeout(forceTimer)
      if (activeChild === child) activeChild = undefined
      resolve({ code, signal, error, timedOut, output })
    })
  })
}

function fail(message) {
  console.error(message)
  process.exitCode = stopSignal ? signalExitCode() : 1
}

async function main() {
  const envFile = path.join(root, '.env')
  if (existsSync(envFile)) process.loadEnvFile(envFile)
  try {
    accessSync(path.join(root, 'bin/api'), constants.X_OK)
    accessSync(path.join(root, 'apps/web/dist/index.html'))
    accessSync(path.join(root, 'node_modules/concurrently/dist/bin/index.js'))
    accessSync(path.join(root, 'node_modules/vite/bin/vite.js'))
  } catch {
    return fail('Build first with ./scripts/build.sh.')
  }

  if (flags[0] === '--memory-only') {
    delete process.env.REPORT_POSTGRES_DSN
    console.log('Memory-only mode: PostgreSQL is skipped; the persistence demo is unavailable.')
  } else if (flags[0] === '--external-postgres') {
    try {
      const dsn = new URL(process.env.REPORT_POSTGRES_DSN ?? '')
      if (!['postgres:', 'postgresql:'].includes(dsn.protocol) || !dsn.hostname) throw new Error('Invalid DSN')
    } catch {
      return fail('--external-postgres requires a valid REPORT_POSTGRES_DSN in your shell or untracked .env.')
    }
    console.log('Using external PostgreSQL from REPORT_POSTGRES_DSN; no container will be started. Its availability is your responsibility.')
  } else {
    const password = process.env.REPORT_POSTGRES_PASSWORD
    if (!password?.trim()) {
      return fail('Set REPORT_POSTGRES_PASSWORD to a local password in your shell or untracked .env (see .env.example), then rerun. For deliberate alternatives, use --external-postgres or --memory-only.')
    }
    const wait = process.env.REPORT_POSTGRES_WAIT_SECONDS ?? '60'
    if (!/^\d+$/.test(wait) || Number(wait) < 1 || Number(wait) > 600) {
      return fail('REPORT_POSTGRES_WAIT_SECONDS must be a whole number from 1 to 600.')
    }
    const localDSN = `postgres://watermill_demo:${encodeURIComponent(password)}@127.0.0.1:54329/watermill_demo?sslmode=disable`
    if (process.env.REPORT_POSTGRES_DSN && process.env.REPORT_POSTGRES_DSN !== localDSN) {
      console.log('Local mode derives its own DSN; REPORT_POSTGRES_DSN is ignored. Use --external-postgres to use that configured DSN instead.')
    }
    process.env.REPORT_POSTGRES_DSN = localDSN

    const version = await run('docker', ['compose', 'version'], { capture: true, timeoutMs: 15000 })
    if (stopSignal) { process.exitCode = signalExitCode(); return }
    if (version.error || version.code !== 0 || version.timedOut) {
      return fail('Docker with Compose v2 is required. Install/start Docker Desktop, or install Docker Engine and the Compose plugin, and verify `docker compose version`. Compose must support --wait and --wait-timeout. Alternatively, use --external-postgres or --memory-only explicitly.')
    }

    console.log(`Starting local PostgreSQL and waiting up to ${wait}s for a healthy container before launching the applications...`)
    // A retained named volume is never removed, even if startup fails or is interrupted.
    console.log(`PostgreSQL is left running on exit. Stop it from the repository with: ${stopCommand}`)
    const database = await run('docker', [...composeArgs, 'up', '-d', '--wait', '--wait-timeout', wait, 'postgres'], {
      // Also bound an unresponsive Docker CLI, not only Compose's health wait.
      timeoutMs: Number(wait) * 1000 + 15000,
    })
    if (stopSignal) { process.exitCode = signalExitCode(); return }
    if (database.error || database.code !== 0 || database.timedOut) {
      return fail(`PostgreSQL startup ${database.timedOut ? 'timed out' : 'failed'}; API and web were not started. Check that Docker is running and inspect: docker compose -f compose.postgres.yaml logs postgres. If --wait is unsupported, update Docker Compose. A retained volume keeps its original password; changing .env does not reset it.`)
    }
    console.log('PostgreSQL is healthy. Starting the API and web preview.')
  }

  if (stopSignal) { process.exitCode = signalExitCode(); return }
  // Local preview, not a production hosting setup. Concurrently forwards termination
  // signals and stops the sibling server on any exit. No compose down/volume deletion.
  const apps = await run(process.execPath, [
    path.join(root, 'node_modules/concurrently/dist/bin/index.js'),
    '--kill-others', '--names', 'api,web',
    './bin/api',
    'node node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port 5173 --strictPort',
  ])
  if (apps.error) return fail(`Unable to start the applications: ${apps.error.message}`)
  process.exitCode = stopSignal ? signalExitCode() : (apps.code ?? 1)
}

main().catch((error) => fail(`Unable to start the demo: ${error.message}`))
