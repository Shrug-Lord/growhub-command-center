import React, { useState } from 'react'
import {
  AlertOctagon,
  Clock3,
  Droplets,
  Flame,
  Lightbulb,
  Loader2,
  Plug,
  RotateCcw,
  Thermometer,
  Wind,
} from 'lucide-react'
import RelayToggle from './RelayToggle.jsx'

const TYPE_ICONS = {
  Light: Lightbulb,
  Fan: Wind,
  Humidifier: Droplets,
  Dehumidifier: Droplets,
  'Water Pump': Droplets,
  Heater: Flame,
  'AC Controller': Thermometer,
  None: Plug,
}

function reasonText(reason) {
  const copy = {
    broker_unavailable: 'MQTT broker unavailable',
    device_offline: 'Device is offline',
    retained_state_syncing: 'Waiting for retained device state',
    pending_action_conflict: 'Another device action is pending',
    manual_mode_required: 'Switch the device to MANUAL first',
    auto_mode_required: 'Return the device to AUTO first',
    pump_schedule_required: 'No active interval schedule for this pump',
  }
  return copy[reason] ?? reason?.replaceAll('_', ' ') ?? null
}

export default function RelayPanel({
  relayState,
  pendingRelayState,
  mode,
  onToggle,
  onModeChange,
  onAction,
  outletProfile = [],
  expectedSchedule,
  scheduleState,
  warnings = [],
  pendingActions = [],
  actionAvailability = {},
}) {
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(null)
  const pendingByType = new Map(pendingActions.map((action) => [action.type, action]))
  const manualAvailability = actionAvailability.set_manual_outlet_state ?? {}

  async function run(key, callback) {
    setSubmitting(key)
    setError(null)
    try {
      await callback()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(null)
    }
  }

  function requestMode(target) {
    if (target === mode) return
    if (target === 'auto' && warnings.length > 0) {
      const warningText = warnings.map((warning) => warning.message ?? warning.code).join('\n')
      if (
        !window.confirm(
          `Returning to AUTO evaluates the firmware schedule immediately.\n\n${warningText}\n\nReturn anyway?`,
        )
      )
        return
    }
    void run(`mode-${target}`, () => onModeChange(target))
  }

  function emergency() {
    if (
      !window.confirm(
        'Switch this device to MANUAL and turn every outlet off? The saved firmware schedule is preserved.',
      )
    )
      return
    void run('emergency', () => onAction('emergency_all_off', {}))
  }

  const scheduleName =
    expectedSchedule?.template_name ?? (scheduleState?.active ? 'Firmware schedule' : null)
  const intervalOutletIds = new Set(
    (scheduleState?.schedule?.outlets ?? [])
      .filter((entry) => entry.conditions?.some((condition) => condition.type === 'interval'))
      .map((entry) => entry.id),
  )

  return (
    <section className="border-y border-gray-800 py-5" aria-labelledby="device-control-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="device-control-title" className="text-sm font-semibold text-white">
            Device control
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            {mode === 'auto'
              ? scheduleName
                ? `AUTO is running ${scheduleName}.`
                : 'AUTO is active with no linked template.'
              : 'MANUAL pauses schedule evaluation and enables direct outlet control.'}
          </p>
        </div>
        <div
          className="flex items-center gap-1 border border-gray-800 bg-gray-900 p-1"
          role="group"
          aria-label="Relay mode"
        >
          {['auto', 'manual'].map((target) => {
            const type = target === 'auto' ? 'return_to_auto' : 'switch_to_manual'
            const availability = actionAvailability[type] ?? {}
            const pending = pendingByType.has(type)
            return (
              <button
                key={target}
                type="button"
                onClick={() => requestMode(target)}
                disabled={availability.enabled === false || pending || submitting !== null}
                title={reasonText(availability.disabled_reason) ?? undefined}
                className={`h-9 min-w-20 px-3 text-xs font-medium uppercase transition-colors ${
                  mode === target
                    ? 'bg-green-700 text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {pending || submitting === `mode-${target}` ? (
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                ) : (
                  target
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[...outletProfile]
          .sort((a, b) => a.id - b.id)
          .map((outlet) => {
            const key = `o${outlet.id}`
            const assignment = outlet.assignment ?? outlet.type ?? 'None'
            const pending = pendingRelayState?.[key]
            let disabledReason = null
            if (assignment === 'None') disabledReason = 'Assign this outlet before controlling it'
            else if (manualAvailability.enabled === false)
              disabledReason = reasonText(manualAvailability.disabled_reason)
            return (
              <div key={key} className="min-w-0">
                <RelayToggle
                  label={outlet.label}
                  secondaryLabel={`Outlet ${outlet.id} - ${assignment}`}
                  icon={TYPE_ICONS[assignment] ?? Plug}
                  active={relayState?.[key] ?? false}
                  pending={pending}
                  disabled={Boolean(disabledReason) || submitting !== null}
                  disabledReason={disabledReason}
                  onToggle={() => {
                    const current = relayState?.[key] ?? false
                    void run(`outlet-${outlet.id}`, () => onToggle(outlet.id, !current))
                  }}
                />
                {assignment === 'Water Pump' &&
                  mode === 'auto' &&
                  intervalOutletIds.has(outlet.id) && (
                    <button
                      type="button"
                      onClick={() => {
                        void run(`pump-${outlet.id}`, () =>
                          onAction('run_water_pump_now', { outlet_id: outlet.id }),
                        )
                      }}
                      disabled={
                        actionAvailability.run_water_pump_now?.enabled === false ||
                        submitting !== null
                      }
                      title={
                        reasonText(actionAvailability.run_water_pump_now?.disabled_reason) ??
                        undefined
                      }
                      className="mt-1.5 inline-flex h-8 w-full items-center justify-center gap-1.5 border border-gray-800 text-xs text-gray-300 hover:border-gray-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {submitting === `pump-${outlet.id}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Droplets className="h-3.5 w-3.5" />
                      )}
                      Run now
                    </button>
                  )}
              </div>
            )
          })}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-800 pt-4">
        {warnings.some((warning) => warning.code === 'time_sync_required') && (
          <button
            type="button"
            onClick={() => {
              void run('sync-time', () => onAction('sync_time', {}))
            }}
            disabled={actionAvailability.sync_time?.enabled === false || submitting !== null}
            title={reasonText(actionAvailability.sync_time?.disabled_reason) ?? undefined}
            className="inline-flex h-9 items-center gap-2 border border-amber-800 px-3 text-xs font-medium text-amber-200 hover:bg-amber-950 disabled:opacity-50"
          >
            {submitting === 'sync-time' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Clock3 className="h-4 w-4" />
            )}
            Sync device time
          </button>
        )}
        <button
          type="button"
          onClick={emergency}
          disabled={actionAvailability.emergency_all_off?.enabled === false || submitting !== null}
          title={reasonText(actionAvailability.emergency_all_off?.disabled_reason) ?? undefined}
          className="inline-flex h-9 items-center gap-2 border border-red-900 px-3 text-xs font-medium text-red-300 hover:bg-red-950 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting === 'emergency' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <AlertOctagon className="h-4 w-4" />
          )}
          Emergency all off
        </button>
        {mode === 'manual' && (
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
            <RotateCcw className="h-3.5 w-3.5" /> Return to AUTO to resume firmware automation.
          </span>
        )}
      </div>
      {error && (
        <p className="mt-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
