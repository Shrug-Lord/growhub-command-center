import CollapsibleSection from './CollapsibleSection.jsx'
import { useDevices } from '../../contexts/DevicesContext.jsx'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, Loader2, XCircle } from 'lucide-react'
import { getDeviceActivity } from '../../api/piClient.js'
import { useRecoveryTask } from '../../contexts/ServerAvailabilityContext.jsx'

const ACTION_LABELS = {
  load_schedule: 'Loaded schedule',
  reload_expected_schedule: 'Reloaded expected schedule',
  update_outlet_config: 'Updated outlet setup',
  repair_outlet_label: 'Restored outlet label',
  confirm_device_setup: 'Confirmed device setup',
  acknowledge_label_drift: 'Accepted firmware label',
  sync_time: 'Synced device time',
  switch_to_manual: 'Switched to MANUAL',
  return_to_auto: 'Returned to AUTO',
  set_manual_outlet_state: 'Changed outlet state',
  emergency_all_off: 'Emergency all off',
  run_water_pump_now: 'Ran water pump',
  save_as_new_template: 'Saved firmware schedule as template',
  acknowledge_drift: 'Acknowledged schedule drift',
}

function iconFor(item) {
  if (item.kind === 'device_event') return AlertTriangle
  if (item.action.status === 'completed') return CheckCircle2
  if (item.action.status === 'pending') return Loader2
  if (item.action.status === 'timed_out') return Clock3
  return XCircle
}

function labelFor(item) {
  if (item.kind === 'device_event') {
    const event = item.device_event
    const labels = {
      device_online: 'Device came online',
      device_offline: 'Device went offline',
      management_address_changed: 'Management address changed',
      schedule_loaded: 'Schedule loaded',
      schedule_removed: 'Schedule removed',
      schedule_drift_detected: 'Firmware schedule drift detected',
      schedule_drift_reconciled: 'Schedule drift reconciled',
    }
    return labels[event.type] ?? event.context?.label ?? event.type.replaceAll('_', ' ')
  }
  if (['load_schedule', 'reload_expected_schedule'].includes(item.action.type)) {
    const action = item.action
    const name = action.context?.template_name ?? 'schedule'
    return action.status === 'completed'
      ? 'Loaded ' + name
      : action.status === 'pending'
        ? 'Loading ' + name
        : 'Schedule load ' + action.status.replaceAll('_', ' ') + ': ' + name
  }
  return ACTION_LABELS[item.action.type] ?? item.action.type.replaceAll('_', ' ')
}

export default function RecentActivity({ deviceId }) {
  const { pollRevision } = useDevices()
  const sequence = useRef(0)
  const [items, setItems] = useState([])
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    const current = ++sequence.current
    try {
      const result = await getDeviceActivity({ deviceId, limit: 12 })
      if (sequence.current !== current) return
      setItems(result.activity)
      setError(null)
    } catch (requestError) {
      if (sequence.current === current) setError(requestError.message)
    }
  }, [deviceId])

  useRecoveryTask(`activity-${deviceId}`, load, 120)
  useEffect(() => {
    void load()
  }, [load, pollRevision])
  useEffect(
    () => () => {
      sequence.current++
    },
    [deviceId],
  )

  return (
    <CollapsibleSection title="Recent activity" storageKey={deviceId + ':activity'}>
      {items.length === 0 && !error && (
        <p className="mt-3 text-sm text-gray-500">No device actions recorded yet.</p>
      )}
      <ol className="mt-3 divide-y divide-gray-800">
        {items.map((item) => {
          const Icon = iconFor(item)
          const action = item.action
          const key = action?.id ?? item.device_event.id
          return (
            <li key={key} className="flex items-start gap-3 py-2.5">
              <Icon
                className={`mt-0.5 h-4 w-4 shrink-0 ${
                  action?.status === 'completed' ? 'text-green-400' : 'text-amber-400'
                } ${action?.status === 'pending' ? 'animate-spin' : ''}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-200">{labelFor(item)}</p>
                {item.device_event?.type === 'management_address_changed' && (
                  <p className="text-xs text-gray-400">
                    {item.device_event.context.previous_ip} → {item.device_event.context.ip}
                  </p>
                )}
                {action && (
                  <p className="text-xs text-gray-400">{action.status.replaceAll('_', ' ')}</p>
                )}
                {action?.reason_code && (
                  <p className="text-xs text-gray-500">{action.reason_code.replaceAll('_', ' ')}</p>
                )}
              </div>
              <time className="shrink-0 text-xs text-gray-600" dateTime={item.occurred_at}>
                {new Date(item.occurred_at).toLocaleString([], {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </time>
            </li>
          )
        })}
      </ol>
      {error && (
        <p className="mt-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}
    </CollapsibleSection>
  )
}
