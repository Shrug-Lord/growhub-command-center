import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildServicePath,
  resolveNpmPath,
  systemdAbsolutePath,
} from '../../scripts/install-update-agent.js'

function executablePaths(...paths) {
  const existing = new Set(paths)
  return (candidate) => {
    if (!existing.has(candidate)) throw new Error(`${candidate} is not executable`)
  }
}

test('resolves npm beside the Node executable when sudo PATH does not contain npm', () => {
  const nodePath = '/home/shrug/.nvm/versions/node/v24.18.0/bin/node'
  const npmPath = '/home/shrug/.nvm/versions/node/v24.18.0/bin/npm'

  assert.equal(
    resolveNpmPath({
      nodePath,
      configuredPath: '',
      accessSync: executablePaths(npmPath),
      lookup: () => '',
    }),
    npmPath,
  )
})

test('honors an explicit npm path before checking beside Node', () => {
  const npmPath = '/opt/custom/bin/npm'

  assert.equal(
    resolveNpmPath({
      nodePath: '/usr/bin/node',
      configuredPath: npmPath,
      accessSync: executablePaths(npmPath),
    }),
    npmPath,
  )
})

test('service PATH includes both runtime directories for npm env-node launchers', () => {
  const servicePath = buildServicePath(
    '/home/shrug/.nvm/versions/node/v24.18.0/bin/node',
    '/home/shrug/.nvm/versions/node/v24.18.0/bin/npm',
  )

  assert.equal(servicePath.split(':')[0], '/home/shrug/.nvm/versions/node/v24.18.0/bin')
  assert.ok(servicePath.includes('/usr/bin'))
})

test('scalar systemd paths remain absolute instead of retaining shell-style quotes', () => {
  const checkout = '/home/shrug/growhub-command-center'
  const request = `${checkout}/deploy/update/request.json`

  assert.equal(`WorkingDirectory=${systemdAbsolutePath(checkout)}`, `WorkingDirectory=${checkout}`)
  assert.equal(`PathExists=${systemdAbsolutePath(request)}`, `PathExists=${request}`)
  assert.throws(() => systemdAbsolutePath('"/home/shrug/growhub-command-center"'))
  assert.throws(() => systemdAbsolutePath('/home/shrug\nInjected=true'))
})
