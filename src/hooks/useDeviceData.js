import { useCallback } from 'react'
import { useDevices } from '../contexts/DevicesContext.jsx'
import { createDeviceAction, getDeviceLogsRange } from '../api/piClient.js'
import { tryIngestLogsFromApi } from '../api/normalizeData.js'
import { useRecoveryTask } from '../contexts/ServerAvailabilityContext.jsx'

export function useDeviceData(mac) {
  const { getDevice, appendHistory, refreshDevices } = useDevices()
  const {
    liveSnapshot,
    history,
    relayState,
    pendingRelayState,
    lastSeen,
    outletProfile,
    presence,
    mirror,
    compatibility,
    scheduleState,
    pendingActions,
    warnings,
    setup,
    expectedSchedule,
    drift,
    driftActions,
    labelDrift,
    actionAvailability,
  } = getDevice(mac)

  const fetchHistory = useCallback(
    async (hours = 24 * 180) => {
      if (!mac) return
      try {
        const toDate = new Date()
        const fromDate = new Date(toDate.getTime() - hours * 60 * 60 * 1000)
        const result = await getDeviceLogsRange({
          deviceId: mac,
          fromDate: fromDate.toISOString(),
          toDate: toDate.toISOString(),
        })
        const normalized = tryIngestLogsFromApi(result)
        if (normalized && normalized.parsedData) {
          appendHistory(mac, normalized.parsedData)
        }
      } catch (e) {
        console.error('fetchHistory failed:', e)
      }
    },
    [mac, appendHistory],
  )

  useRecoveryTask(`history-${mac}`, fetchHistory, 100)

  const sendMode = useCallback(
    async (mode) => {
      const type = mode === 'manual' ? 'switch_to_manual' : 'return_to_auto'
      try {
        const input =
          mode === 'auto'
            ? {
                acknowledged_warning_codes: (warnings ?? [])
                  .filter((warning) => warning.source === 'firmware')
                  .map((warning) => warning.code),
              }
            : {}
        const action = await createDeviceAction({ deviceId: mac, type, input })
        await refreshDevices()
        return action
      } catch (e) {
        console.error('sendMode failed:', e)
        throw e
      }
    },
    [mac, refreshDevices, warnings],
  )

  const sendRelayToggle = useCallback(
    async (outletId, targetState) => {
      try {
        const action = await createDeviceAction({
          deviceId: mac,
          type: 'set_manual_outlet_state',
          input: { outlet_id: outletId, target_state: targetState ? 'on' : 'off' },
        })
        await refreshDevices()
        return action
      } catch (e) {
        console.error('sendRelayToggle failed:', e)
        throw e
      }
    },
    [mac, refreshDevices],
  )

  const sendAction = useCallback(
    async (type, input = {}) => {
      const action = await createDeviceAction({ deviceId: mac, type, input })
      await refreshDevices()
      return action
    },
    [mac, refreshDevices],
  )

  return {
    liveSnapshot,
    history,
    relayState,
    pendingRelayState,
    lastSeen,
    outletProfile,
    presence,
    mirror,
    compatibility,
    scheduleState,
    pendingActions,
    warnings,
    setup,
    expectedSchedule,
    drift,
    driftActions,
    labelDrift,
    actionAvailability,
    fetchHistory,
    sendMode,
    sendRelayToggle,
    sendAction,
  }
}
