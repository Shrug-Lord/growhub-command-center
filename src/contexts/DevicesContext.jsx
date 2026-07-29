import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { decodeRelayState } from '../utils/relayUtils.js'
import { getDevices, getServerHealth } from '../api/piClient.js'
import { reportedOrExisting } from '../utils/deviceState.js'
import { useAuth } from './AuthContext.jsx'
import { useRecoveryTask } from './ServerAvailabilityContext.jsx'

const DevicesContext = createContext(null)

const UNKNOWN_SERVER_HEALTH = {
  broker: { status: 'unknown', subscriptions_ready: false },
  retained_state_rebuild: {
    generation: 0,
    device_count: 0,
    syncing_device_count: 0,
    missing_state_count: 0,
  },
}

function relayStateFromSchedule(scheduleState) {
  if (!Array.isArray(scheduleState?.outlet_status)) return null
  return Object.fromEntries(
    scheduleState.outlet_status.map((outlet) => [`o${outlet.id}`, outlet.state === 'on']),
  )
}

function pendingRelayStateFromActions(actions) {
  const pending = (actions ?? []).filter(
    (action) => action.status === 'pending' && action.type === 'set_manual_outlet_state',
  )
  if (pending.length === 0) return null
  return Object.fromEntries(
    pending.map((action) => [`o${action.context.outlet_id}`, action.context.target_state === 'on']),
  )
}

function makeDeviceState(device = null, existing = null) {
  const liveSnapshot = device?.sensor ?? existing?.liveSnapshot ?? null
  const scheduleRelayState = relayStateFromSchedule(device?.scheduleState)
  const sensorRelayState = liveSnapshot?.a ? decodeRelayState(liveSnapshot.a) : null
  const pendingActions = device?.pendingActions ?? existing?.pendingActions ?? []
  return {
    liveSnapshot,
    history: existing?.history ?? [],
    relayState: scheduleRelayState ??
      sensorRelayState ??
      existing?.relayState ?? { o1: false, o2: false, o3: false, o4: false },
    pendingRelayState: pendingRelayStateFromActions(pendingActions),
    lastSeen: device?.sensorState?.received_at
      ? new Date(device.sensorState.received_at)
      : (existing?.lastSeen ?? null),
    outletProfile:
      device?.outlets?.length === 4 ? device.outlets : (existing?.outletProfile ?? null),
    device: device ?? existing?.device ?? null,
    presence: device?.presence ?? existing?.presence ?? { status: 'unknown', online: false },
    mirror: device?.mirror ??
      existing?.mirror ?? { status: 'syncing', ready: false, missing_states: [] },
    compatibility: device?.compatibility ??
      existing?.compatibility ?? { status: 'pending', blockers: [] },
    scheduleState: device?.scheduleState ?? existing?.scheduleState ?? null,
    pendingActions,
    warnings: device?.warnings ?? existing?.warnings ?? [],
    setup: reportedOrExisting(device, existing, 'setup', null),
    expectedSchedule: reportedOrExisting(device, existing, 'expectedSchedule', null),
    drift: reportedOrExisting(device, existing, 'drift', null),
    driftActions: reportedOrExisting(device, existing, 'driftActions', null),
    labelDrift: device?.labelDrift ?? existing?.labelDrift ?? [],
    actionAvailability: device?.actionAvailability ?? existing?.actionAvailability ?? {},
  }
}

export function DevicesProvider({ children }) {
  const { auth } = useAuth()
  const [deviceMap, setDeviceMap] = useState({})
  const [deviceList, setDeviceList] = useState([])
  const [serverHealth, setServerHealth] = useState(UNKNOWN_SERVER_HEALTH)

  const acceptDevices = useCallback((devices) => {
    const visible = devices.filter((device) => !device.hidden)
    setDeviceList(visible)
    setDeviceMap((previous) => {
      const next = { ...previous }
      for (const device of visible) {
        next[device._id] = makeDeviceState(device, previous[device._id])
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (!auth?.devices?.length) return
    acceptDevices(auth.devices)
  }, [acceptDevices, auth?.devices])

  const refreshDevices = useCallback(async () => {
    if (!auth) return
    const [devices, health] = await Promise.all([getDevices(), getServerHealth()])
    acceptDevices(devices)
    setServerHealth(health)
  }, [acceptDevices, auth])

  useRecoveryTask('devices', refreshDevices, 20)

  useEffect(() => {
    if (!auth) {
      setDeviceList([])
      setDeviceMap({})
      setServerHealth(UNKNOWN_SERVER_HEALTH)
      return undefined
    }
    let active = true
    let inFlight = false
    async function poll() {
      if (!active || inFlight) return
      inFlight = true
      try {
        await refreshDevices()
      } catch (_) {
        // API availability handling owns user-facing recovery state.
      } finally {
        inFlight = false
      }
    }
    void poll()
    const handle = window.setInterval(poll, 5_000)
    return () => {
      active = false
      window.clearInterval(handle)
    }
  }, [auth, refreshDevices])

  const appendHistory = useCallback((mac, rows) => {
    setDeviceMap((previous) => ({
      ...previous,
      [mac]: { ...(previous[mac] ?? makeDeviceState()), history: rows },
    }))
  }, [])

  const setOutletProfile = useCallback((mac, profile) => {
    setDeviceMap((previous) => ({
      ...previous,
      [mac]: { ...(previous[mac] ?? makeDeviceState()), outletProfile: profile },
    }))
  }, [])

  const getDevice = useCallback((mac) => deviceMap[mac] ?? makeDeviceState(), [deviceMap])

  return (
    <DevicesContext.Provider
      value={{
        deviceList,
        deviceMap,
        serverHealth,
        appendHistory,
        setOutletProfile,
        getDevice,
        refreshDevices,
      }}
    >
      {children}
    </DevicesContext.Provider>
  )
}

export function useDevices() {
  return useContext(DevicesContext)
}
