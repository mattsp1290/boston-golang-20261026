import { spawnSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const api = path.join(root, 'apps/api')
const binary = path.join(root, 'bin', process.platform === 'win32' ? 'api.exe' : 'api')
const command = process.argv[2]

function run(program, args) {
  const result = spawnSync(program, args, { cwd: api, stdio: 'inherit' })
  if (result.error) {
    console.error(`Unable to run ${program}: ${result.error.message}. Install Go 1.26+ and put it on PATH.`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function build() {
  mkdirSync(path.dirname(binary), { recursive: true })
  run('go', ['build', '-o', binary, './cmd/server'])
}

switch (command) {
  case 'build': build(); break
  case 'test': run('go', ['test', '-race', './...']); break
  case 'lint': {
    const format = spawnSync('gofmt', ['-l', '.'], { cwd: api, encoding: 'utf8' })
    if (format.error || format.status !== 0 || format.stdout.trim()) {
      console.error(format.error?.message ?? format.stderr ?? '')
      console.error(`Run gofmt -w apps/api. Unformatted files:\n${format.stdout ?? ''}`)
      process.exit(1)
    }
    run('go', ['vet', './...'])
    break
  }
  case 'dev': {
    if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'))
    build()
    const child = spawn(binary, [], { cwd: root, stdio: 'inherit' })
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => child.kill(signal))
    }
    child.on('error', (error) => { console.error(error); process.exitCode = 1 })
    child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
    break
  }
  default: console.error('Expected build, test, lint, or dev'); process.exit(1)
}
