import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bindMount,
  ensureExistingDeployment,
  operations,
  repoRoot,
  runningDataServices,
  sha256,
  startDataServices,
  stopDataServices,
  timestamp,
} from './compose-operations.js'

function optionValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : process.argv[index + 1]
}

export function createBackup({ outputDirectory } = {}) {
  ensureExistingDeployment()
  const destination = path.resolve(outputDirectory || path.join(repoRoot, 'backups'))
  fs.mkdirSync(destination, { recursive: true })
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'growhub-backup-'))
  const archiveName = `growhub-backup-${timestamp()}.tar.gz`
  const archivePath = path.join(destination, archiveName)
  const running = runningDataServices()

  process.stdout.write('Stopping Command Center and Mosquitto for a consistent backup...\n')
  stopDataServices()
  try {
    operations(
      [
        'sh',
        '-c',
        'tar -C /volumes/server -czf /backup/server-data.tar.gz . && tar -C /volumes/mosquitto -czf /backup/mosquitto-data.tar.gz .',
      ],
      { mounts: [bindMount(temporary, '/backup')] },
    )
    const packageInfo = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    const manifest = {
      format: 'growhub-command-center-backup',
      version: 1,
      created_at: new Date().toISOString(),
      command_center_version: packageInfo.version,
      includes: ['server_data', 'mosquitto_data'],
      files: {
        'server-data.tar.gz': sha256(path.join(temporary, 'server-data.tar.gz')),
        'mosquitto-data.tar.gz': sha256(path.join(temporary, 'mosquitto-data.tar.gz')),
      },
    }
    fs.writeFileSync(
      path.join(temporary, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
    operations(
      [
        'tar',
        '-C',
        '/input',
        '-czf',
        `/output/${archiveName}`,
        'manifest.json',
        'server-data.tar.gz',
        'mosquitto-data.tar.gz',
      ],
      {
        mounts: [bindMount(temporary, '/input', true), bindMount(destination, '/output')],
      },
    )
  } finally {
    startDataServices(running)
    fs.rmSync(temporary, { recursive: true, force: true })
  }
  process.stdout.write(`Backup created: ${archivePath}\n`)
  return archivePath
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) {
  try {
    createBackup({ outputDirectory: optionValue('--output') })
  } catch (error) {
    process.stderr.write(`Backup failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
