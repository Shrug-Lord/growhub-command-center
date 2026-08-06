import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultRequestFile = path.join(repoRoot, 'deploy', 'update', 'request.json')
const releaseTagPattern = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`,
  )
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

function requestPath() {
  const args = process.argv.slice(2)
  const index = args.indexOf('--request')
  if (index === -1) return defaultRequestFile
  if (!args[index + 1] || args.length !== 2) throw new Error('Usage: --request <request.json>')
  return path.resolve(args[index + 1])
}

function readRequest(file) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (
    value?.v !== 1 ||
    !releaseTagPattern.test(value.tag) ||
    value.version !== value.tag.slice(1) ||
    !['user', 'automatic'].includes(value.requested_by) ||
    !Number.isFinite(Date.parse(value.requested_at))
  ) {
    throw new Error('The update request is invalid.')
  }
  return value
}

async function verifyRelease(tag) {
  const response = await fetch(
    `https://api.github.com/repos/Shrug-Lord/growhub-command-center/releases/tags/${encodeURIComponent(tag)}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'growhub-command-center-host-updater',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(8_000),
    },
  )
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status} for ${tag}.`)
  const release = await response.json()
  if (release.tag_name !== tag || release.draft === true || release.prerelease === true) {
    throw new Error(`${tag} is not a published stable GitHub Release.`)
  }
}

function verifyOrigin() {
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('The checkout has no readable Git origin.')
  const origin = result.stdout
    .trim()
    .replace(/\.git$/, '')
    .toLowerCase()
  if (
    origin !== 'https://github.com/shrug-lord/growhub-command-center' &&
    origin !== 'git@github.com:shrug-lord/growhub-command-center'
  ) {
    throw new Error('The checkout Git origin is not the official Command Center repository.')
  }
}

async function run() {
  const file = requestPath()
  const statusFile = path.join(path.dirname(file), 'status.json')
  let request
  try {
    request = readRequest(file)
    fs.unlinkSync(file)
    atomicJson(statusFile, {
      v: 1,
      state: 'installing',
      tag: request.tag,
      requested_at: request.requested_at,
    })
    verifyOrigin()
    await verifyRelease(request.tag)
    const npmPath = process.env.GROWHUB_NPM_PATH || 'npm'
    const result = spawnSync(npmPath, ['run', 'compose:update', '--', '--release', request.tag], {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    })
    if (result.error) throw result.error
    if (result.status !== 0)
      throw new Error(`The release updater exited with status ${result.status}.`)
    atomicJson(statusFile, {
      v: 1,
      state: 'installed',
      tag: request.tag,
      requested_at: request.requested_at,
      completed_at: new Date().toISOString(),
      message: `${request.tag} installed successfully.`,
    })
  } catch (error) {
    atomicJson(statusFile, {
      v: 1,
      state: 'failed',
      tag: request?.tag ?? null,
      requested_at: request?.requested_at ?? null,
      completed_at: new Date().toISOString(),
      message: error instanceof Error ? error.message : 'Update failed.',
    })
    throw error
  }
}

run().catch((error) => {
  process.stderr.write(`Update agent failed: ${error.message}\n`)
  process.exitCode = 1
})
