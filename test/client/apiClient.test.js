import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ApiError,
  checkReadiness,
  clearCsrfToken,
  requestJson,
  setCsrfToken,
  subscribeApiIssues,
} from '../../src/api/apiClient.js'
import {
  getAuthBootstrap,
  getDevices,
  getDeviceLogsRange,
  getServerHealth,
  login,
  setupAdmin,
  waitForDeviceAction,
} from '../../src/api/piClient.js'

function jsonResponse(body, status = 200, requestId = 'request-1') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
    },
  })
}

function useFetchMock(t, implementation) {
  const original = globalThis.fetch
  globalThis.fetch = implementation
  t.after(() => {
    globalThis.fetch = original
  })
}

test('typed shutdown errors retain request metadata and report a restart issue', async (t) => {
  useFetchMock(t, async () =>
    jsonResponse(
      {
        error: { code: 'server_shutting_down', message: 'Restarting.' },
        request_id: 'shutdown-request',
      },
      503,
      'shutdown-request',
    ),
  )
  const issues = []
  const unsubscribe = subscribeApiIssues((issue) => issues.push(issue))
  t.after(unsubscribe)

  await assert.rejects(
    requestJson('/api/v1/devices'),
    (error) =>
      error instanceof ApiError &&
      error.code === 'server_shutting_down' &&
      error.kind === 'shutdown' &&
      error.requestId === 'shutdown-request',
  )
  assert.equal(issues.length, 1)
  assert.equal(issues[0].code, 'server_shutting_down')
})

test('typed service errors do not masquerade as server availability failures', async (t) => {
  useFetchMock(t, async () =>
    jsonResponse(
      {
        error: { code: 'broker_unavailable', message: 'MQTT is unavailable.' },
        request_id: 'broker-request',
      },
      503,
      'broker-request',
    ),
  )
  const issues = []
  const unsubscribe = subscribeApiIssues((issue) => issues.push(issue))
  t.after(unsubscribe)

  await assert.rejects(
    requestJson('/api/v1/devices/AABBCCDDEEFF/actions', { method: 'POST', body: '{}' }),
    (error) => error.code === 'broker_unavailable' && error.kind === 'http',
  )
  assert.deepEqual(issues, [])
})

test('network failures are reported once and state-changing requests are never replayed', async (t) => {
  let attempts = 0
  useFetchMock(t, async () => {
    attempts += 1
    throw new TypeError('fetch failed')
  })
  const issues = []
  const unsubscribe = subscribeApiIssues((issue) => issues.push(issue))
  t.after(unsubscribe)

  await assert.rejects(
    requestJson('/api/v1/devices/AABBCCDDEEFF/actions', { method: 'POST', body: '{}' }),
    (error) => error.code === 'server_unavailable' && error.kind === 'network',
  )
  assert.equal(attempts, 1)
  assert.equal(issues.length, 1)
})

test('request timeout aborts the fetch and reports an availability issue', async (t) => {
  useFetchMock(
    t,
    async (_url, options) =>
      new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        )
      }),
  )
  const issues = []
  const unsubscribe = subscribeApiIssues((issue) => issues.push(issue))
  t.after(unsubscribe)

  await assert.rejects(
    requestJson('/api/v1/devices', { timeoutMs: 5 }),
    (error) => error.code === 'request_timed_out' && error.kind === 'timeout',
  )
  assert.equal(issues.at(-1).kind, 'timeout')
})

test('isolated history failures remain local instead of reporting a server outage', async (t) => {
  useFetchMock(
    t,
    async (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        )
      }),
  )
  const issues = []
  const unsubscribe = subscribeApiIssues((issue) => issues.push(issue))
  t.after(unsubscribe)

  await assert.rejects(
    requestJson('/api/v1/data-logs/rangev3?deviceId=AA', {
      timeoutMs: 5,
      reportAvailability: false,
    }),
    (error) => error.code === 'request_timed_out' && error.kind === 'timeout',
  )
  assert.deepEqual(issues, [])
})

test('history adapter returns sampling metadata and forwards cancellation', async (t) => {
  const controller = new AbortController()
  useFetchMock(t, async (_url, options) => {
    assert.equal(options.signal.aborted, false)
    controller.abort()
    return jsonResponse({
      series: { temp: [[1, 24]] },
      meta: { source_count: 10, returned_count: 1, aggregated: true, bucket_ms: 10 },
    })
  })

  const result = await getDeviceLogsRange({
    deviceId: 'AA',
    fromDate: '2026-08-01T00:00:00.000Z',
    toDate: '2026-08-02T00:00:00.000Z',
    signal: controller.signal,
  })
  assert.deepEqual(result.meta, {
    source_count: 10,
    returned_count: 1,
    aggregated: true,
    bucket_ms: 10,
  })
})

test('readiness accepts the explicit ready and not-ready health contracts', async (t) => {
  const responses = [
    jsonResponse({ status: 'not_ready', reason: 'shutting_down' }, 503),
    jsonResponse({ status: 'ready' }),
  ]
  useFetchMock(t, async () => responses.shift())

  assert.deepEqual(await checkReadiness(), { ready: false, reason: 'shutting_down' })
  assert.deepEqual(await checkReadiness(), { ready: true, reason: null })
})

test('the session adapter decodes cookie-session resources without bearer credentials', async (t) => {
  const requests = []
  const responses = [
    jsonResponse({
      session: {
        csrf_token: 'csrf-value',
        expires_at: '2026-08-12T12:00:00.000Z',
        user: {
          id: 'local-admin',
          username: 'admin',
          devices: [{ id: 'AA', name: 'Tent', outlets: [] }],
        },
      },
    }),
    jsonResponse({ devices: [{ id: 'AA', name: 'Tent', outlets: [] }] }),
    jsonResponse({
      server_health: {
        broker: { status: 'connected', subscriptions_ready: true },
        retained_state_rebuild: { syncing_device_count: 0, missing_state_count: 0 },
      },
    }),
  ]
  useFetchMock(t, async (url, options) => {
    requests.push({ url, options })
    return responses.shift()
  })

  const session = await login({ username: 'admin', password: 'secret' })
  assert.equal(session.csrfToken, 'csrf-value')
  assert.equal(session.user.username, 'admin')
  assert.equal(session.user.devices[0]._id, 'AA')
  const devices = await getDevices()
  assert.equal(devices.length, 1)
  assert.equal(devices[0]._id, 'AA')
  assert.equal(devices[0].name, 'Tent')
  assert.deepEqual(devices[0].outlets, [])
  assert.equal((await getServerHealth()).broker.status, 'connected')
  assert.equal(requests[0].url, '/api/v1/session')
  assert.equal(requests[0].options.credentials, 'same-origin')
  assert.equal(requests[0].options.headers.Authorization, undefined)
})

test('pending device actions are polled until firmware confirmation', async (t) => {
  const requests = []
  const responses = [
    jsonResponse({
      action: {
        id: 'action-1',
        status: 'completed',
        timeout_at: new Date(Date.now() + 1_000).toISOString(),
      },
    }),
  ]
  useFetchMock(t, async (url, options) => {
    requests.push({ url, options })
    return responses.shift()
  })

  const action = await waitForDeviceAction({
    deviceId: 'AA',
    action: {
      id: 'action-1',
      status: 'pending',
      timeout_at: new Date(Date.now() + 1_000).toISOString(),
    },
    pollIntervalMs: 0,
  })

  assert.equal(action.status, 'completed')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/v1/devices/AA/actions/action-1')
  assert.equal(requests[0].options.method, undefined)
})

test('schedule actions keep polling through bounded late confirmation', async (t) => {
  const requests = []
  const responses = [
    jsonResponse({
      action: {
        id: 'schedule-1',
        status: 'timed_out',
        reason_code: 'confirmation_timeout',
        reconciliation_until: new Date(Date.now() + 10_000).toISOString(),
      },
    }),
    jsonResponse({
      action: {
        id: 'schedule-1',
        status: 'completed',
        reason_code: 'confirmed_after_timeout',
        reconciliation_until: new Date(Date.now() + 10_000).toISOString(),
      },
    }),
  ]
  useFetchMock(t, async (url, options) => {
    requests.push({ url, options })
    return responses.shift()
  })

  const updates = []
  const action = await waitForDeviceAction({
    deviceId: 'AA',
    action: {
      id: 'schedule-1',
      status: 'pending',
      timeout_at: new Date(Date.now() - 1_000).toISOString(),
      reconciliation_until: new Date(Date.now() + 10_000).toISOString(),
    },
    pollIntervalMs: 0,
    onUpdate: (next) => updates.push(next.status),
  })

  assert.equal(action.status, 'completed')
  assert.deepEqual(updates, ['timed_out', 'completed'])
  assert.equal(requests.length, 2)
})

test('auth bootstrap represents setup and authenticated sessions without expected 401 responses', async (t) => {
  const responses = [
    jsonResponse({ bootstrap: { session: null, setup_required: true } }),
    jsonResponse({
      bootstrap: {
        setup_required: false,
        session: {
          csrf_token: 'bootstrap-csrf',
          expires_at: '2026-08-12T12:00:00.000Z',
          user: {
            id: 'local-admin',
            username: 'admin',
            devices: [],
          },
        },
      },
    }),
  ]
  useFetchMock(t, async () => responses.shift())

  assert.deepEqual(await getAuthBootstrap(), {
    session: null,
    setupRequired: true,
  })
  const configured = await getAuthBootstrap()
  assert.equal(configured.setupRequired, false)
  assert.equal(configured.session.csrfToken, 'bootstrap-csrf')
  assert.equal(configured.session.user.username, 'admin')
})

test('CSRF stays in module memory and is attached only to state-changing requests', async (t) => {
  const requests = []
  useFetchMock(t, async (url, options) => {
    requests.push({ url, options })
    if (url === '/api/v1/setup') {
      return jsonResponse({ setup: { complete: true, username: 'admin' } }, 201)
    }
    return jsonResponse({ settings: {} })
  })
  t.after(clearCsrfToken)

  setCsrfToken('in-memory-csrf')
  await requestJson('/api/v1/settings')
  await requestJson('/api/v1/settings', { method: 'PUT', body: '{}' })
  clearCsrfToken()
  await setupAdmin({
    username: 'admin',
    password: 'correct horse battery staple',
    passwordConfirmation: 'correct horse battery staple',
  })

  assert.equal(requests[0].options.headers['X-CSRF-Token'], undefined)
  assert.equal(requests[1].options.headers['X-CSRF-Token'], 'in-memory-csrf')
  assert.equal(requests[2].options.headers['X-CSRF-Token'], undefined)
  assert.equal(JSON.stringify(requests).includes('Authorization'), false)
})
