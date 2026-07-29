import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { checkReadiness, subscribeApiIssues } from '../api/apiClient.js'
import { createServerAvailabilityMonitor, SERVER_STATUS } from '../api/serverAvailability.js'

const ServerAvailabilityContext = createContext(null)

export function ServerAvailabilityProvider({ children }) {
  const monitorRef = useRef(null)
  if (!monitorRef.current) {
    monitorRef.current = createServerAvailabilityMonitor({ readinessCheck: checkReadiness })
  }
  const monitor = monitorRef.current
  const [snapshot, setSnapshot] = useState(monitor.getSnapshot)

  useEffect(() => {
    monitor.resume()
    const unsubscribeMonitor = monitor.subscribe(setSnapshot)
    const unsubscribeApi = subscribeApiIssues(monitor.reportIssue)
    return () => {
      unsubscribeApi()
      unsubscribeMonitor()
      monitor.pause()
    }
  }, [monitor])

  const registerRecoveryTask = useCallback(
    (name, task, priority) => monitor.registerRecoveryTask(name, task, priority),
    [monitor],
  )
  const retryNow = useCallback(() => monitor.attemptRecovery(), [monitor])

  return (
    <ServerAvailabilityContext.Provider
      value={{
        ...snapshot,
        isReadOnly: snapshot.status !== SERVER_STATUS.AVAILABLE,
        registerRecoveryTask,
        retryNow,
      }}
    >
      {children}
    </ServerAvailabilityContext.Provider>
  )
}

export function useServerAvailability() {
  const value = useContext(ServerAvailabilityContext)
  if (!value)
    throw new Error('useServerAvailability must be used inside ServerAvailabilityProvider')
  return value
}

export function useRecoveryTask(name, task, priority = 100) {
  const { registerRecoveryTask } = useServerAvailability()
  const taskRef = useRef(task)
  taskRef.current = task

  useEffect(() => {
    return registerRecoveryTask(name, () => taskRef.current(), priority)
  }, [name, priority, registerRecoveryTask])
}
