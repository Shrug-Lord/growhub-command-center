import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const composeFile = path.join(root, 'deploy', 'compose.yml')
const baseUrl = process.env.GROWHUB_SMOKE_URL || 'http://127.0.0.1'
const mac = 'AABBCCDDEEFF'

function compose(args) {
  const result = spawnSync('docker', ['compose', '-f', composeFile, ...args], {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'Docker Compose command failed.')
  }
}

async function jsonRequest(pathname, options = {}) {
  const response = await fetch(baseUrl + pathname, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(pathname + ' returned ' + response.status + ': ' + JSON.stringify(body))
  }
  return { body, response }
}

function publish(topic, payload) {
  compose([
    'exec',
    '-T',
    'mosquitto',
    'mosquitto_pub',
    '-h',
    '127.0.0.1',
    '-p',
    '1883',
    '-q',
    '1',
    '-r',
    '-t',
    topic,
    '-m',
    typeof payload === 'string' ? payload : JSON.stringify(payload),
  ])
}

async function waitFor(check, description, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await check()
    if (result) return result
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Timed out waiting for ' + description + '.')
}

async function main() {
  const live = await jsonRequest('/health/live')
  if (live.body.setup_required !== true) {
    throw new Error('Compose MQTT smoke requires a fresh Command Center data volume.')
  }

  await jsonRequest('/api/v1/setup', {
    method: 'POST',
    body: JSON.stringify({
      username: 'compose-smoke',
      password: 'compose smoke password',
      password_confirmation: 'compose smoke password',
    }),
  })
  const login = await jsonRequest('/api/v1/session', {
    method: 'POST',
    body: JSON.stringify({
      username: 'compose-smoke',
      password: 'compose smoke password',
    }),
  })
  const cookie = login.response.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('Login did not return a session cookie.')
  const authHeaders = { Cookie: cookie }

  await waitFor(async () => {
    const health = await jsonRequest('/api/v1/server/health', { headers: authHeaders })
    return health.body.server_health.broker.subscriptions_ready === true
  }, 'MQTT subscriptions')

  publish('growhub/' + mac + '/status', 'online')
  publish('growhub/' + mac + '/outlets/state', {
    v: 1,
    source: 'reconnect',
    outlets: [
      { id: 1, assignment: 'Light', label: 'Canopy Light' },
      { id: 2, assignment: 'Fan', label: 'Exhaust Fan' },
      { id: 3, assignment: 'Fan', label: 'Circulation Fan' },
      { id: 4, assignment: 'Water Pump', label: 'Reservoir Pump' },
    ],
  })
  publish('growhub/' + mac + '/schedule/state', {
    active: true,
    mode: 'auto',
    source: 'reconnect',
    time_valid: true,
    time_source: 'sntp',
    sntp_status: 'synced',
    time_warning: '',
    sensor_warning: '',
    warnings: [],
    schedule: {
      v: 3,
      outlets: [
        {
          id: 1,
          conditions: [{ type: 'time_window', start: '06:00', end: '22:00' }],
        },
      ],
    },
    outlet_status: [1, 2, 3, 4].map((id) => ({ id, state: 'off', summary: '' })),
  })

  const device = await waitFor(async () => {
    const devices = await jsonRequest('/api/v1/devices', { headers: authHeaders })
    return devices.body.devices.find((entry) => entry.id === mac && entry.mirror.ready)
  }, 'a ready CE device mirror')

  if (device.presence.status !== 'online') throw new Error('Presence was not mirrored.')
  if (device.outlets[0]?.label !== 'Canopy Light') {
    throw new Error('Firmware-owned outlets were not mirrored.')
  }
  if (device.schedule?.mode !== 'auto' || device.schedule?.schedule?.v !== 3) {
    throw new Error('CE v3 schedule state was not mirrored.')
  }

  process.stdout.write('Compose MQTT smoke passed: retained CE state rebuilt a ready device.\n')
}

main().catch((error) => {
  process.stderr.write('Compose MQTT smoke failed: ' + error.message + '\n')
  process.exitCode = 1
})
