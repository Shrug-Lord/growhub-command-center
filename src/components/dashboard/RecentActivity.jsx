import React, { useCallback, useEffect, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, Clock3, Loader2, XCircle } from 'lucide-react'
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
    return item.device_event.type === 'schedule_drift_detected'
      ? 'Firmware schedule drift detected'
      : 'Schedule drift reconciled'
  }
  return ACTION_LABELS[item.action.type] ?? item.action.type.replaceAll('_', ' ')
}

export default function RecentActivity({ deviceId }) {
  const [items, setItems] = useState([])
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const result = await getDeviceActivity({ deviceId, limit: 12 })
      setItems(result.activity)
      setError(null)
    } catch (requestError) {
      setError(requestError.message)
    }
  }, [deviceId])

  useRecoveryTask(`activity-${deviceId}`, load, 120)
  useEffect(() => {
    const poll = () => {
      if (document.visibilityState === 'visible') void load()
    }
    poll()
    const handle = window.setInterval(poll, 15_000)
    document.addEventListener('visibilitychange', poll)
    return () => {
      window.clearInterval(handle)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [load])

  return (
    <section className="border-y border-gray-800 py-5" aria-labelledby="recent-activity-title">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-gray-500" />
        <h2 id="recent-activity-title" className="text-sm font-semibold text-white">
          Recent activity
        </h2>
      </div>
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
    </section>
  )
}
