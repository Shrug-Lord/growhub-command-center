import fs from 'node:fs'
import path from 'node:path'
import { createBackup } from './compose-backup.js'
import { compose, repoRoot, run, waitForReady } from './compose-operations.js'

function update() {
  const args = process.argv.slice(2)
  const dirty = run('git', ['status', '--porcelain'], { capture: true })
  if (dirty) {
    throw new Error(
      'The checkout has local changes. Commit or move them before running the automatic update.',
    )
  }
  let backup = null
  if (!args.includes('--skip-backup')) {
    backup = createBackup({ outputDirectory: path.join(repoRoot, 'backups', 'pre-update') })
  }
  try {
    run('git', ['pull', '--ff-only'])
    run('npm', ['ci'])
    run('npm', ['ci', '--prefix', 'deploy/server'])
    compose(['pull', 'mosquitto', 'operations'])
    compose(['build', '--pull', 'server'])
    compose(['up', '-d', '--remove-orphans', 'mosquitto', 'server'])
    waitForReady()
  } catch (error) {
    if (backup) process.stderr.write(`Pre-update backup: ${backup}\n`)
    throw error
  }
  const version = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version
  process.stdout.write(`Growhub Command Center ${version} is ready.\n`)
}

try {
  update()
} catch (error) {
  process.stderr.write(`Update failed: ${error.message}\n`)
  process.exitCode = 1
}
