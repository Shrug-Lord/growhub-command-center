import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const composeFile = path.join(repoRoot, 'deploy', 'compose.yml')

function commandText(command, args) {
  return [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ')
}

export function run(command, args, { capture = false, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? 'pipe' : 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = capture && result.stderr ? `\n${result.stderr.trim()}` : ''
    throw new Error(`${commandText(command, args)} exited with status ${result.status}${detail}`)
  }
  return capture ? result.stdout.trim() : ''
}

export function compose(args, options) {
  return run('docker', ['compose', '-f', composeFile, ...args], options)
}

export function operations(args, { mounts = [], capture = false } = {}) {
  return compose(
    [
      '--profile',
      'operations',
      'run',
      '--rm',
      '--no-deps',
      '-T',
      ...mounts.flatMap((mount) => ['-v', mount]),
      'operations',
      ...args,
    ],
    { capture },
  )
}

export function bindMount(source, target, readOnly = false) {
  return `${path.resolve(source)}:${target}${readOnly ? ':ro' : ''}`
}

export function runningDataServices() {
  const output = compose(['ps', '--status', 'running', '--services'], { capture: true })
  return output.split(/\r?\n/).filter((service) => ['server', 'mosquitto'].includes(service))
}

export function stopDataServices() {
  compose(['stop', 'server', 'mosquitto'])
}

export function startDataServices(services = ['mosquitto', 'server']) {
  if (services.length > 0) compose(['up', '-d', ...services])
}

export function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_')
}

export function ensureExistingDeployment() {
  const services = compose(['ps', '-a', '--services'], { capture: true })
    .split(/\r?\n/)
    .filter(Boolean)
  if (!services.includes('server') || !services.includes('mosquitto')) {
    throw new Error(
      'No Compose deployment was found. Run `npm run compose:up` before backup or restore.',
    )
  }
}

export function waitForReady({ attempts = 30, delayMs = 2_000 } = {}) {
  const check = [
    'exec',
    '-T',
    'server',
    'node',
    '-e',
    "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
  ]
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync('docker', ['compose', '-f', composeFile, ...check], {
      cwd: repoRoot,
      stdio: 'ignore',
    })
    if (result.status === 0) return
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs)
  }
  throw new Error('Command Center did not become ready before the operation deadline.')
}
