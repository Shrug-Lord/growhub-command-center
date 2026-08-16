import { useCallback, useEffect, useRef, useState } from 'react'
import { useDevices } from '../contexts/DevicesContext.jsx'
import { createDeviceAction, getDeviceLogsRange } from '../api/piClient.js'
import { tryIngestLogsFromApi } from '../api/normalizeData.js'

export function useDeviceData(mac) {
  const { getDevice, appendHistory, refreshDevices } = useDevices()
  const {
    liveSnapshot,
    history,
    historyMeta,
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
  const historyRequestRef = useRef(null)
  const historySequenceRef = useRef(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState(null)

  useEffect(
    () => () => {
      historySequenceRef.current += 1
      historyRequestRef.current?.abort()
    },
    [mac],
  )

  const fetchHistory = useCallback(
    async (hours = 24) => {
      if (!mac) return
      historyRequestRef.current?.abort()
      const controller = new AbortController()
      historyRequestRef.current = controller
      const sequence = ++historySequenceRef.current
      setHistoryLoading(true)
      setHistoryError(null)
      try {
        const toDate = new Date()
        const fromDate = new Date(toDate.getTime() - hours * 60 * 60 * 1000)
        const result = await getDeviceLogsRange({
          deviceId: mac,
          fromDate: fromDate.toISOString(),
          toDate: toDate.toISOString(),
          signal: controller.signal,
        })
        const normalized = tryIngestLogsFromApi(result.series)
        if (normalized && normalized.parsedData) {
          if (sequence === historySequenceRef.current) {
            appendHistory(mac, normalized.parsedData, result.meta)
          }
        } else if (result.meta?.returned_count === 0 && sequence === historySequenceRef.current) {
          appendHistory(mac, [], result.meta)
        } else {
          throw new Error('Command Center returned invalid history data.')
        }
      } catch (e) {
        if (e?.code !== 'request_cancelled' && sequence === historySequenceRef.current) {
          console.error('fetchHistory failed:', e)
          setHistoryError(e)
        }
      } finally {
        if (sequence === historySequenceRef.current) {
          setHistoryLoading(false)
          historyRequestRef.current = null
        }
      }
    },
    [mac, appendHistory],
  )

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
    historyMeta,
    historyLoading,
    historyError,
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
