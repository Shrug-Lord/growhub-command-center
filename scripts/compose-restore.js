import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBackup } from './compose-backup.js'
import {
  bindMount,
  ensureExistingDeployment,
  operations,
  repoRoot,
  sha256,
  startDataServices,
  stopDataServices,
  waitForReady,
} from './compose-operations.js'

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exitCode = 2
}

async function restore() {
  const args = process.argv.slice(2)
  const archiveArgument = args.find((argument) => !argument.startsWith('--'))
  if (!args.includes('--yes')) {
    fail(
      'Restore overwrites current app and broker state. Re-run with `npm run compose:restore -- <archive> --yes`.',
    )
    return
  }
  if (!archiveArgument) {
    fail('A backup archive path is required.')
    return
  }
  const archivePath = path.resolve(archiveArgument)
  if (!fs.statSync(archivePath, { throwIfNoEntry: false })?.isFile()) {
    fail(`Backup archive not found: ${archivePath}`)
    return
  }
  ensureExistingDeployment()
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'growhub-restore-'))
  const archiveDirectory = path.dirname(archivePath)
  const archiveName = path.basename(archivePath)
  let safetyBackup = null
  try {
    const entries = operations(['tar', '-tzf', `/input/${archiveName}`], {
      mounts: [bindMount(archiveDirectory, '/input', true)],
      capture: true,
    })
      .split(/\r?\n/)
      .map((entry) => entry.replace(/^\.\//, ''))
      .filter(Boolean)
    const allowedEntries = new Set(['manifest.json', 'server-data.tar.gz', 'mosquitto-data.tar.gz'])
    if (entries.some((entry) => !allowedEntries.has(entry))) {
      throw new Error('The backup archive contains an unexpected or unsafe path.')
    }
    operations(['tar', '-xzf', `/input/${archiveName}`, '-C', '/output'], {
      mounts: [bindMount(archiveDirectory, '/input', true), bindMount(temporary, '/output')],
    })
    const manifestPath = path.join(temporary, 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    if (manifest.format !== 'growhub-command-center-backup' || manifest.version !== 1) {
      throw new Error('The archive is not a supported Growhub backup.')
    }
    for (const file of ['server-data.tar.gz', 'mosquitto-data.tar.gz']) {
      const filePath = path.join(temporary, file)
      if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
        throw new Error(`Backup is missing ${file}.`)
      }
      if (manifest.files?.[file] !== sha256(filePath)) {
        throw new Error(`Checksum verification failed for ${file}.`)
      }
    }
    if (!args.includes('--skip-safety-backup')) {
      safetyBackup = createBackup({
        outputDirectory: path.join(repoRoot, 'backups', 'pre-restore'),
      })
    }
    process.stdout.write('Stopping services and replacing app and broker state...\n')
    stopDataServices()
    operations(
      [
        'sh',
        '-c',
        'rm -rf /volumes/server/* /volumes/server/.[!.]* /volumes/server/..?* /volumes/mosquitto/* /volumes/mosquitto/.[!.]* /volumes/mosquitto/..?* && tar -xzf /restore/server-data.tar.gz -C /volumes/server && tar -xzf /restore/mosquitto-data.tar.gz -C /volumes/mosquitto',
      ],
      { mounts: [bindMount(temporary, '/restore', true)] },
    )
    startDataServices()
    waitForReady()
    process.stdout.write(`Restore completed from ${archivePath}\n`)
  } catch (error) {
    if (safetyBackup) process.stderr.write(`Pre-restore safety backup: ${safetyBackup}\n`)
    throw error
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

restore().catch((error) => {
  process.stderr.write(`Restore failed: ${error.message}\n`)
  process.exitCode = 1
})
