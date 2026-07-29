const AVAILABILITY_KINDS = new Set(['network', 'timeout', 'proxy', 'protocol'])

export const SERVER_STATUS = Object.freeze({
  AVAILABLE: 'available',
  RESTARTING: 'restarting',
  RECOVERING: 'recovering',
  UNAVAILABLE: 'unavailable',
})

function isShutdownIssue(issue) {
  return issue?.code === 'server_shutting_down' || issue?.kind === 'shutdown'
}

function isAvailabilityIssue(issue) {
  return isShutdownIssue(issue) || AVAILABILITY_KINDS.has(issue?.kind)
}

export function createServerAvailabilityMonitor({
  readinessCheck,
  now = () => Date.now(),
  probeIntervalMs = 5_000,
  restartEscalationMs = 60_000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  if (typeof readinessCheck !== 'function') throw new TypeError('readinessCheck is required')

  let snapshot = Object.freeze({
    status: SERVER_STATUS.AVAILABLE,
    since: null,
    lastIssue: null,
    checking: false,
  })
  let probeHandle = null
  let escalationHandle = null
  let recoveryPromise = null
  let paused = false
  let destroyed = false
  let issueSequence = 0
  const listeners = new Set()
  const recoveryTasks = new Map()

  function emit(next) {
    snapshot = Object.freeze(next)
    for (const listener of listeners) listener(snapshot)
  }

  function clearEscalation() {
    if (escalationHandle === null) return
    clearTimeoutFn(escalationHandle)
    escalationHandle = null
  }

  function clearProbe() {
    if (probeHandle === null) return
    clearIntervalFn(probeHandle)
    probeHandle = null
  }

  function escalateRestart() {
    escalationHandle = null
    if (snapshot.status !== SERVER_STATUS.RESTARTING) return
    emit({
      ...snapshot,
      status: SERVER_STATUS.UNAVAILABLE,
      checking: false,
      lastIssue: snapshot.lastIssue || {
        code: 'restart_timed_out',
        kind: 'timeout',
        message: 'Command Center did not become ready after restarting.',
      },
    })
  }

  function scheduleEscalation() {
    if (paused || escalationHandle !== null || snapshot.status !== SERVER_STATUS.RESTARTING) return
    const elapsed = Math.max(0, now() - snapshot.since)
    const remaining = Math.max(0, restartEscalationMs - elapsed)
    escalationHandle = setTimeoutFn(escalateRestart, remaining)
    escalationHandle?.unref?.()
  }

  function scheduleProbe() {
    if (paused || probeHandle !== null || snapshot.status === SERVER_STATUS.AVAILABLE) return
    probeHandle = setIntervalFn(() => {
      void attemptRecovery()
    }, probeIntervalMs)
    probeHandle?.unref?.()
  }

  function scheduleMonitoring() {
    scheduleProbe()
    scheduleEscalation()
  }

  function reportIssue(issue) {
    if (destroyed) return
    const timestamp = now()
    if (isShutdownIssue(issue)) {
      const since =
        snapshot.status === SERVER_STATUS.AVAILABLE ? timestamp : (snapshot.since ?? timestamp)
      emit({
        status: SERVER_STATUS.RESTARTING,
        since,
        lastIssue: issue,
        checking: false,
      })
    } else if (isAvailabilityIssue(issue)) {
      clearEscalation()
      emit({
        status: SERVER_STATUS.UNAVAILABLE,
        since: snapshot.since ?? timestamp,
        lastIssue: issue,
        checking: false,
      })
    } else {
      return
    }
    issueSequence += 1
    scheduleMonitoring()
  }

  async function runRecoveryTasks() {
    const tasks = [...recoveryTasks.values()].sort((a, b) => a.priority - b.priority)
    for (const { task } of tasks) {
      try {
        await task()
      } catch (error) {
        if (isAvailabilityIssue(error)) throw error
      }
    }
  }

  function notReady(reason) {
    const restartReason = reason === 'starting' || reason === 'shutting_down'
    if (restartReason && snapshot.status !== SERVER_STATUS.UNAVAILABLE) {
      const since = snapshot.since ?? now()
      if (now() - since >= restartEscalationMs) {
        emit({ ...snapshot, status: SERVER_STATUS.UNAVAILABLE, since, checking: false })
      } else {
        emit({ ...snapshot, status: SERVER_STATUS.RESTARTING, since, checking: false })
      }
    } else {
      clearEscalation()
      emit({ ...snapshot, status: SERVER_STATUS.UNAVAILABLE, checking: false })
    }
    scheduleMonitoring()
  }

  function attemptRecovery() {
    if (destroyed) return Promise.resolve(false)
    if (snapshot.status === SERVER_STATUS.AVAILABLE) return Promise.resolve(true)
    if (recoveryPromise) return recoveryPromise

    emit({ ...snapshot, checking: true })
    recoveryPromise = (async () => {
      try {
        const readiness = await readinessCheck()
        if (!readiness.ready) {
          notReady(readiness.reason)
          return false
        }

        clearEscalation()
        emit({ ...snapshot, status: SERVER_STATUS.RECOVERING, checking: true })
        const recoveryIssueSequence = issueSequence
        await runRecoveryTasks()
        if (issueSequence !== recoveryIssueSequence) return false
        clearProbe()
        emit({
          status: SERVER_STATUS.AVAILABLE,
          since: null,
          lastIssue: null,
          checking: false,
        })
        return true
      } catch (error) {
        reportIssue(error)
        return false
      } finally {
        recoveryPromise = null
        if (snapshot.status !== SERVER_STATUS.AVAILABLE && snapshot.checking) {
          emit({ ...snapshot, checking: false })
        }
      }
    })()
    return recoveryPromise
  }

  function registerRecoveryTask(name, task, priority = 100) {
    if (!name || typeof task !== 'function')
      throw new TypeError('Recovery task name and function are required')
    const registration = { name, task, priority }
    recoveryTasks.set(name, registration)
    return () => {
      if (recoveryTasks.get(name) === registration) recoveryTasks.delete(name)
    }
  }

  function subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function pause() {
    paused = true
    clearProbe()
    clearEscalation()
  }

  function resume() {
    if (destroyed) return
    paused = false
    scheduleMonitoring()
  }

  function destroy() {
    destroyed = true
    pause()
    listeners.clear()
    recoveryTasks.clear()
  }

  return Object.freeze({
    attemptRecovery,
    destroy,
    getSnapshot: () => snapshot,
    pause,
    registerRecoveryTask,
    reportIssue,
    resume,
    subscribe,
  })
}
