import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const composeFile = path.join(repoRoot, 'deploy', 'compose.yml')

function run(args) {
  const result = spawnSync('docker', ['compose', '-f', composeFile, ...args], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`docker compose ${args.join(' ')} exited with status ${result.status}`)
  }
}

if (!process.argv.slice(2).includes('--yes')) {
  process.stderr.write(
    'Refusing to delete Command Center development data without confirmation. Run `npm run compose:reset -- --yes`.\n',
  )
  process.exitCode = 2
} else {
  let serverStopped = false
  try {
    run(['build', 'server'])
    run(['stop', 'server'])
    serverStopped = true
    run(['run', '--rm', '--no-deps', 'server', 'npm', 'run', 'reset:dev', '--', '--yes'])
  } finally {
    if (serverStopped) run(['up', '-d', 'server'])
  }
}
