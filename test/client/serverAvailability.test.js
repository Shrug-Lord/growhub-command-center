import assert from 'node:assert/strict'
import test from 'node:test'
import { createServerAvailabilityMonitor, SERVER_STATUS } from '../../src/api/serverAvailability.js'

function fakeScheduler() {
  const intervals = []
  const timeouts = []
  return {
    intervals,
    timeouts,
    setIntervalFn(fn, ms) {
      const handle = { fn, ms, active: true, unref() {} }
      intervals.push(handle)
      return handle
    },
    clearIntervalFn(handle) {
      handle.active = false
    },
    setTimeoutFn(fn, ms) {
      const handle = { fn, ms, active: true, unref() {} }
      timeouts.push(handle)
      return handle
    },
    clearTimeoutFn(handle) {
      handle.active = false
    },
  }
}

function buildMonitor(overrides = {}) {
  const scheduler = fakeScheduler()
  let now = 1_000
  const monitor = createServerAvailabilityMonitor({
    readinessCheck: async () => ({ ready: false, reason: 'shutting_down' }),
    now: () => now,
    ...scheduler,
    ...overrides,
  })
  return {
    monitor,
    scheduler,
    setNow(value) {
      now = value
    },
  }
}

test('typed shutdown enters restarting, probes every five seconds, and escalates at one minute', () => {
  const { monitor, scheduler, setNow } = buildMonitor()

  monitor.reportIssue({ code: 'server_shutting_down', kind: 'shutdown' })
  assert.equal(monitor.getSnapshot().status, SERVER_STATUS.RESTARTING)
  assert.equal(scheduler.intervals[0].ms, 5_000)
  assert.equal(scheduler.timeouts[0].ms, 60_000)

  setNow(61_000)
  scheduler.timeouts[0].fn()
  assert.equal(monitor.getSnapshot().status, SERVER_STATUS.UNAVAILABLE)
  monitor.destroy()
})

test('network failures enter unavailable immediately', () => {
  const { monitor } = buildMonitor()
  monitor.reportIssue({ code: 'server_unavailable', kind: 'network' })
  assert.equal(monitor.getSnapshot().status, SERVER_STATUS.UNAVAILABLE)
  monitor.destroy()
})

test('recovery validates ordered read tasks before restoring availability', async () => {
  const calls = []
  const { monitor } = buildMonitor({
    readinessCheck: async () => {
      calls.push('readiness')
      return { ready: true, reason: null }
    },
  })
  monitor.registerRecoveryTask(
    'page',
    async () => {
      calls.push('page')
    },
    100,
  )
  monitor.registerRecoveryTask(
    'devices',
    async () => {
      calls.push('devices')
    },
    20,
  )
  monitor.registerRecoveryTask(
    'session',
    async () => {
      calls.push('session')
    },
    10,
  )
  monitor.reportIssue({ code: 'server_unavailable', kind: 'network' })

  assert.equal(await monitor.attemptRecovery(), true)
  assert.deepEqual(calls, ['readiness', 'session', 'devices', 'page'])
  assert.equal(monitor.getSnapshot().status, SERVER_STATUS.AVAILABLE)
  monitor.destroy()
})

test('an availability issue reported inside a swallowed page refresh keeps controls disabled', async () => {
  const { monitor } = buildMonitor({
    readinessCheck: async () => ({ ready: true, reason: null }),
  })
  monitor.registerRecoveryTask('page', async () => {
    monitor.reportIssue({ code: 'server_unavailable', kind: 'network' })
  })
  monitor.reportIssue({ code: 'server_shutting_down', kind: 'shutdown' })

  assert.equal(await monitor.attemptRecovery(), false)
  assert.equal(monitor.getSnapshot().status, SERVER_STATUS.UNAVAILABLE)
  monitor.destroy()
})

test('non-availability page errors do not block server recovery', async () => {
  const { monitor } = buildMonitor({
    readinessCheck: async () => ({ ready: true, reason: null }),
  })
  monitor.registerRecoveryTask('page', async () => {
    throw Object.assign(new Error('Page validation failed'), { kind: 'http' })
  })
  monitor.reportIssue({ code: 'server_unavailable', kind: 'network' })

  assert.equal(await monitor.attemptRecovery(), true)
  assert.equal(monitor.getSnapshot().status, SERVER_STATUS.AVAILABLE)
  monitor.destroy()
})
