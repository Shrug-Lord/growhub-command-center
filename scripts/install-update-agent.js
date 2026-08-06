import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const updateDirectory = path.join(repoRoot, 'deploy', 'update')
const requestFile = path.join(updateDirectory, 'request.json')
const serviceName = 'growhub-command-center-updater'
const systemPathDirectories = [
  '/usr/local/sbin',
  '/usr/local/bin',
  '/usr/sbin',
  '/usr/bin',
  '/sbin',
  '/bin',
]

function command(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options }).trim()
}

function systemdQuote(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

export function resolveNpmPath({
  nodePath = process.execPath,
  configuredPath = process.env.GROWHUB_NPM_PATH,
  accessSync = fs.accessSync,
  lookup,
} = {}) {
  const candidates = [configuredPath, path.join(path.dirname(nodePath), 'npm')].filter(Boolean)

  for (const candidate of candidates) {
    try {
      accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      // Try the next candidate before falling back to a PATH lookup.
    }
  }

  const located = lookup?.()
  if (located) return located
  throw new Error(
    `npm was not found beside ${nodePath}. Run with GROWHUB_NPM_PATH set to the absolute npm path.`,
  )
}

export function buildServicePath(nodePath, npmPath) {
  return [
    ...new Set([path.dirname(nodePath), path.dirname(npmPath), ...systemPathDirectories]),
  ].join(':')
}

export function installUpdateAgent() {
  if (process.platform !== 'linux') throw new Error('The automatic update agent requires Linux.')
  if (process.getuid?.() !== 0) {
    throw new Error('Run this installer with sudo so it can create the system service.')
  }

  const user =
    process.env.SUDO_USER && process.env.SUDO_USER !== 'root' ? process.env.SUDO_USER : null
  if (!user)
    throw new Error('Run the installer with sudo from the account that manages this checkout.')
  const uid = command('id', ['-u', user])
  const gid = command('id', ['-g', user])
  const home = command('getent', ['passwd', user]).split(':')[5] || os.homedir()
  const npmPath = resolveNpmPath({
    lookup: () =>
      command('sh', ['-c', 'command -v npm'], {
        env: { ...process.env, HOME: home, USER: user },
      }),
  })
  const servicePath = buildServicePath(process.execPath, npmPath)

  fs.mkdirSync(updateDirectory, { recursive: true, mode: 0o700 })
  fs.chownSync(updateDirectory, Number(uid), Number(gid))

  const service = `[Unit]
Description=Growhub Command Center verified release updater
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=${user}
Group=${gid}
WorkingDirectory=${systemdQuote(repoRoot)}
Environment=${systemdQuote(`HOME=${home}`)}
Environment=${systemdQuote(`PATH=${servicePath}`)}
Environment=${systemdQuote(`GROWHUB_NPM_PATH=${npmPath}`)}
ExecStart=${systemdQuote(process.execPath)} ${systemdQuote(path.join(repoRoot, 'scripts', 'host-update-agent.js'))} --request ${systemdQuote(requestFile)}

[Install]
WantedBy=multi-user.target
`

  const pathUnit = `[Unit]
Description=Watch for Growhub Command Center update requests

[Path]
PathExists=${systemdQuote(requestFile)}
Unit=${serviceName}.service

[Install]
WantedBy=multi-user.target
`

  fs.writeFileSync(`/etc/systemd/system/${serviceName}.service`, service, { mode: 0o644 })
  fs.writeFileSync(`/etc/systemd/system/${serviceName}.path`, pathUnit, { mode: 0o644 })
  fs.writeFileSync(
    path.join(updateDirectory, 'agent.json'),
    `${JSON.stringify({ v: 1, installed: true, installed_at: new Date().toISOString() })}\n`,
    { mode: 0o600 },
  )
  fs.chownSync(path.join(updateDirectory, 'agent.json'), Number(uid), Number(gid))

  command('systemctl', ['daemon-reload'])
  command('systemctl', ['enable', '--now', `${serviceName}.path`])
  process.stdout.write('Growhub Command Center automatic updates are enabled on this host.\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installUpdateAgent()
}
