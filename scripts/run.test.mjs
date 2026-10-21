import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('./', import.meta.url))
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fixture(t, { docker = true, built = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'watermill-run-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const dir of ['scripts', 'bin', 'commands', 'apps/web/dist', 'node_modules/concurrently/dist/bin', 'node_modules/vite/bin']) {
    await mkdir(path.join(root, dir), { recursive: true })
  }
  for (const file of ['run.mjs', 'run.sh']) await copyFile(path.join(source, file), path.join(root, 'scripts', file))
  // The fixture never invokes a real Docker daemon or application server.
  await writeFile(path.join(root, 'compose.postgres.yaml'), 'services: {}\n')
  await symlink(process.execPath, path.join(root, 'commands/node'))
  await symlink('/usr/bin/dirname', path.join(root, 'commands/dirname'))
  if (built) {
    await writeFile(path.join(root, 'bin/api'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    await writeFile(path.join(root, 'apps/web/dist/index.html'), '<html></html>')
    await writeFile(path.join(root, 'node_modules/vite/bin/vite.js'), '')
  }
  const log = path.join(root, 'events.jsonl')
  await writeFile(log, '')
  const logger = `import { appendFileSync } from 'node:fs';
const log = (entry) => appendFileSync(process.env.MOCK_LOG, JSON.stringify(entry) + '\\n');`
  if (docker) {
    const dockerPath = path.join(root, 'commands/docker')
    await writeFile(dockerPath, `#!${process.execPath}
${logger}
const args = process.argv.slice(2);
log({ event: 'docker', args, cwd: process.cwd() });
if (args.join(' ') === 'compose version') {
  if (process.env.MOCK_DOCKER_MODE === 'no-compose') process.exit(1);
  console.log('Docker Compose version v2.40.0');
  process.exit(0);
}
log({ event: 'starting' });
if (process.env.MOCK_DOCKER_MODE === 'failure') {
  console.error('Cannot connect to the Docker daemon');
  process.exit(1);
}
if (process.env.MOCK_DOCKER_MODE === 'timeout') {
  setTimeout(() => { console.error('container failed to become healthy before timeout'); process.exit(1); }, 40);
} else if (process.env.MOCK_DOCKER_MODE === 'hang') {
  setInterval(() => {}, 1000);
} else {
  setTimeout(() => { log({ event: 'healthy' }); process.exit(0); }, 40);
}
`)
    await chmod(dockerPath, 0o755)
  }
  await writeFile(path.join(root, 'node_modules/concurrently/dist/bin/index.js'), `${logger}
log({ event: 'apps', args: process.argv.slice(2), cwd: process.cwd(), dsn: process.env.REPORT_POSTGRES_DSN, password: process.env.REPORT_POSTGRES_PASSWORD });
if (process.env.MOCK_HOLD_APPS) {
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { log({ event: signal }); process.exit(0); });
  setInterval(() => {}, 1000);
} else process.exit(Number(process.env.MOCK_APPS_EXIT ?? 0));
`)
  const environment = { ...process.env, PATH: path.join(root, 'commands'), MOCK_LOG: log }
  for (const key of Object.keys(environment)) {
    if (key.startsWith('REPORT_POSTGRES_') || key.startsWith('MOCK_') && key !== 'MOCK_LOG' || key === 'NODE_OPTIONS') delete environment[key]
  }
  function start(args = [], env = {}, shell = false) {
    const child = spawn(shell ? '/bin/bash' : process.execPath, [path.join(root, 'scripts', shell ? 'run.sh' : 'run.mjs'), ...args], {
      cwd: os.tmpdir(), env: { ...environment, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    const done = once(child, 'close').then(([code, signal]) => ({ code, signal, output }))
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') })
    return { child, done }
  }
  async function events() {
    return (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  }
  async function waitFor(event) {
    const until = Date.now() + 5000
    while (Date.now() < until) {
      if ((await events()).some((entry) => entry.event === event)) return
      await pause(10)
    }
    assert.fail(`Timed out waiting for ${event}`)
  }
  return { root, start, events, waitFor }
}

function noApps(events) {
  assert.equal(events.some((entry) => entry.event === 'apps'), false, 'API/web must not launch')
}

test('default shell entrypoint starts healthy PostgreSQL before both applications, from any directory', async (t) => {
  const f = await fixture(t)
  const result = await f.start([], { REPORT_POSTGRES_PASSWORD: 'test-pass' }, true).done
  assert.equal(result.code, 0, result.output)
  const events = await f.events()
  assert.deepEqual(events.map((entry) => entry.event), ['docker', 'docker', 'starting', 'healthy', 'apps'])
  assert.deepEqual(events[1].args, ['compose', '-f', 'compose.postgres.yaml', 'up', '-d', '--wait', '--wait-timeout', '60', 'postgres'])
  const apps = events.at(-1)
  assert.equal(apps.cwd, f.root)
  assert.equal(apps.dsn, 'postgres://watermill_demo:test-pass@127.0.0.1:54329/watermill_demo?sslmode=disable')
  assert.ok(apps.args.includes('./bin/api'))
  assert.ok(apps.args.some((arg) => arg.includes('vite.js preview')))
  assert.ok(apps.args.includes('--kill-others'))
  assert.match(result.output, /PostgreSQL is left running on exit/)
  assert.match(result.output, /docker compose -f compose.postgres.yaml stop postgres/)
})

test('loads .env safely as data, URL-encodes credentials, and never writes a DSN or executes shell syntax', async (t) => {
  const f = await fixture(t)
  const marker = path.join(f.root, 'must-not-exist')
  const password = `test $DOLLAR @:/% # $(touch ${marker})`
  const contents = `REPORT_POSTGRES_PASSWORD='${password}'\nREPORT_POSTGRES_WAIT_SECONDS=12\n`
  await writeFile(path.join(f.root, '.env'), contents)
  const result = await f.start().done
  assert.equal(result.code, 0, result.output)
  const events = await f.events()
  assert.equal(events.at(-1).password, password)
  assert.equal(events.at(-1).dsn, `postgres://watermill_demo:${encodeURIComponent(password)}@127.0.0.1:54329/watermill_demo?sslmode=disable`)
  assert.ok(events[1].args.includes('12'))
  assert.equal(await readFile(path.join(f.root, '.env'), 'utf8'), contents)
  await assert.rejects(access(marker))
  assert.equal(result.output.includes(password), false)
})

test('shell environment takes precedence over .env', async (t) => {
  const f = await fixture(t)
  await writeFile(path.join(f.root, '.env'), 'REPORT_POSTGRES_PASSWORD=file-password\n')
  const result = await f.start([], { REPORT_POSTGRES_PASSWORD: 'shell-password' }).done
  assert.equal(result.code, 0, result.output)
  assert.equal((await f.events()).at(-1).password, 'shell-password')
})

test('fails before Docker or apps if the build is absent', async (t) => {
  const f = await fixture(t, { built: false })
  const result = await f.start([], { REPORT_POSTGRES_PASSWORD: 'test-pass' }).done
  assert.equal(result.code, 1)
  assert.match(result.output, /Build first/)
  assert.deepEqual(await f.events(), [])
})

test('missing password is actionable and does not launch Docker or apps', async (t) => {
  const f = await fixture(t)
  const result = await f.start().done
  assert.equal(result.code, 1)
  assert.match(result.output, /Set REPORT_POSTGRES_PASSWORD/)
  assert.deepEqual(await f.events(), [])
})

test('missing Docker is actionable and does not launch apps', async (t) => {
  const f = await fixture(t, { docker: false })
  const result = await f.start([], { REPORT_POSTGRES_PASSWORD: 'test-pass' }).done
  assert.equal(result.code, 1)
  assert.match(result.output, /Docker with Compose v2 is required/)
  assert.deepEqual(await f.events(), [])
})

test('missing Compose plugin is actionable and does not launch apps', async (t) => {
  const f = await fixture(t)
  const result = await f.start([], { REPORT_POSTGRES_PASSWORD: 'test-pass', MOCK_DOCKER_MODE: 'no-compose' }).done
  assert.equal(result.code, 1)
  assert.match(result.output, /Compose plugin/)
  assert.equal((await f.events()).length, 1)
  noApps(await f.events())
})

for (const mode of ['failure', 'timeout']) {
  test(`Docker ${mode} aborts startup without launching apps or removing volume`, async (t) => {
    const f = await fixture(t)
    const result = await f.start([], { REPORT_POSTGRES_PASSWORD: 'test-pass', MOCK_DOCKER_MODE: mode, REPORT_POSTGRES_WAIT_SECONDS: '1' }).done
    assert.equal(result.code, 1)
    assert.match(result.output, /API and web were not started/)
    const events = await f.events()
    noApps(events)
    assert.equal(events.filter((entry) => entry.event === 'docker').length, 2)
    assert.ok(events[1].args.includes('1'))
    assert.equal(events.some((entry) => entry.args?.includes('down')), false)
  })
}

for (const wait of ['0', '-1', '1.5', 'abc', '601']) {
  test(`rejects invalid wait timeout ${wait} without launch`, async (t) => {
    const f = await fixture(t)
    const result = await f.start([], { REPORT_POSTGRES_PASSWORD: 'test-pass', REPORT_POSTGRES_WAIT_SECONDS: wait }).done
    assert.equal(result.code, 1)
    assert.match(result.output, /whole number from 1 to 600/)
    assert.deepEqual(await f.events(), [])
  })
}

test('external mode preserves explicit DSN and bypasses Docker/password requirement', async (t) => {
  const f = await fixture(t, { docker: false })
  const dsn = 'postgresql://demo:external-test@localhost:5432/testdb?sslmode=disable'
  const result = await f.start(['--external-postgres'], { REPORT_POSTGRES_DSN: dsn }).done
  assert.equal(result.code, 0, result.output)
  const events = await f.events()
  assert.deepEqual(events.map((entry) => entry.event), ['apps'])
  assert.equal(events[0].dsn, dsn)
  assert.match(result.output, /availability is your responsibility/)
  assert.equal(result.output.includes(dsn), false)
})

for (const dsn of ['', 'not-a-dsn', 'https://localhost/test']) {
  test(`external mode rejects missing or invalid configuration ${JSON.stringify(dsn)}`, async (t) => {
    const f = await fixture(t)
    const result = await f.start(['--external-postgres'], { REPORT_POSTGRES_DSN: dsn }).done
    assert.equal(result.code, 1)
    assert.match(result.output, /requires a valid REPORT_POSTGRES_DSN/)
    assert.deepEqual(await f.events(), [])
  })
}

test('memory-only explicitly clears even a configured DSN and does not use Docker', async (t) => {
  const f = await fixture(t, { docker: false })
  const result = await f.start(['--memory-only'], { REPORT_POSTGRES_DSN: 'postgres://configured/test' }).done
  assert.equal(result.code, 0, result.output)
  const events = await f.events()
  assert.deepEqual(events.map((entry) => entry.event), ['apps'])
  assert.equal(events[0].dsn, undefined)
  assert.match(result.output, /persistence demo is unavailable/)
})

test('default local mode never silently uses a configured external DSN', async (t) => {
  const f = await fixture(t)
  const result = await f.start([], { REPORT_POSTGRES_PASSWORD: 'test-pass', REPORT_POSTGRES_DSN: 'postgres://external/test' }).done
  assert.equal(result.code, 0, result.output)
  assert.match(result.output, /REPORT_POSTGRES_DSN is ignored/)
  assert.match((await f.events()).at(-1).dsn, /127\.0\.0\.1:54329/)
})

test('forwards termination to the apps and leaves the database/volume intact', async (t) => {
  const f = await fixture(t)
  const running = f.start([], { REPORT_POSTGRES_PASSWORD: 'test-pass', MOCK_HOLD_APPS: '1' })
  await f.waitFor('apps')
  running.child.kill('SIGTERM')
  const result = await running.done
  assert.equal(result.code, 143, result.output)
  const events = await f.events()
  assert.equal(events.at(-1).event, 'SIGTERM')
  assert.equal(events.filter((entry) => entry.event === 'docker').length, 2)
  assert.equal(events.some((entry) => entry.args?.includes('down') || entry.args?.includes('stop')), false)
})

test('interruption during database startup never launches apps', async (t) => {
  const f = await fixture(t)
  const running = f.start([], { REPORT_POSTGRES_PASSWORD: 'test-pass', MOCK_DOCKER_MODE: 'hang' })
  await f.waitFor('starting')
  running.child.kill('SIGINT')
  const result = await running.done
  assert.equal(result.code, 130, result.output)
  noApps(await f.events())
})

test('application failure propagates its exit code', async (t) => {
  const f = await fixture(t)
  const result = await f.start(['--memory-only'], { MOCK_APPS_EXIT: '7' }).done
  assert.equal(result.code, 7)
})

test('help does not need build, Docker, or credentials', async (t) => {
  const f = await fixture(t, { docker: false, built: false })
  const result = await f.start(['--help']).done
  assert.equal(result.code, 0, result.output)
  assert.match(result.output, /Usage:/)
  assert.deepEqual(await f.events(), [])
})

test('rejects conflicting and unknown mode flags', async (t) => {
  const f = await fixture(t)
  for (const flags of [['--memory-only', '--external-postgres'], ['--typo']]) {
    const result = await f.start(flags).done
    assert.equal(result.code, 1)
    assert.match(result.output, /Usage:/)
  }
  assert.deepEqual(await f.events(), [])
})
