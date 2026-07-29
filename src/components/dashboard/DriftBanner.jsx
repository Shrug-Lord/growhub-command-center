import React, { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Save, Upload, XCircle } from 'lucide-react'
import { createDeviceAction, getScheduleDrift } from '../../api/piClient.js'
import { detailsForDriftEpisode } from '../../utils/driftState.js'

const REASONS = {
  firmware_schedule_cleared: 'The active firmware schedule was cleared.',
  outlet_assignment_changed:
    'An outlet assignment changed and the firmware schedule no longer matches.',
  schedule_body_changed: 'The active schedule was edited at the firmware.',
  unknown_firmware_change: 'The active firmware schedule changed.',
}

const WARNING_MESSAGES = {
  schedule_drift_will_be_replaced: 'The current firmware schedule will be replaced.',
}

function disabledText(reason) {
  return reason?.replaceAll('_', ' ') ?? null
}

export default function DriftBanner({ mac, drift, actions = {}, onChanged }) {
  const [details, setDetails] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const activeDetails = detailsForDriftEpisode(details, drift?.id)

  if (!drift) return null

  async function loadDetails() {
    if (activeDetails) return activeDetails
    const value = await getScheduleDrift({ deviceId: mac })
    setDetails(value)
    return value
  }

  async function run(key, callback) {
    setBusy(key)
    setError(null)
    try {
      await callback()
      await onChanged?.()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(null)
    }
  }

  function toggleDetails() {
    if (expanded) {
      setExpanded(false)
      return
    }
    void run('details', async () => {
      await loadDetails()
      setExpanded(true)
    })
  }

  async function reloadExpected() {
    try {
      await createDeviceAction({ deviceId: mac, type: 'reload_expected_schedule', input: {} })
    } catch (requestError) {
      const blocked = requestError.details?.blocked_action
      if (blocked?.reason_code !== 'warnings_require_confirmation') throw requestError
      const context = blocked.context ?? {}
      const summary = (context.warnings ?? [])
        .map(
          (warning) =>
            warning.message ?? WARNING_MESSAGES[warning.code] ?? disabledText(warning.code),
        )
        .join('\n')
      if (
        !window.confirm(
          `Loading the expected schedule will replace the current firmware schedule.\n\n${summary}\n\nLoad anyway?`,
        )
      )
        return
      await createDeviceAction({
        deviceId: mac,
        type: 'reload_expected_schedule',
        input: { acknowledged_warning_signature: context.warning_signature },
      })
    }
  }

  async function saveAsTemplate() {
    const current = await loadDetails()
    const name = window.prompt('Name the new schedule template:', 'Firmware schedule')
    if (!name?.trim()) return
    await createDeviceAction({
      deviceId: mac,
      type: 'save_as_new_template',
      input: {
        name: name.trim(),
        description: 'Saved from firmware-owned schedule drift',
        schedule_fingerprint: current.firmware.fingerprint,
        outlet_fingerprint: current.outlet_fingerprint,
        drift_episode_id: drift.id,
      },
    })
  }

  async function acknowledge() {
    const current = await loadDetails()
    if (
      !window.confirm(
        'Acknowledge this drift and unlink the device from its expected template? The firmware schedule will remain unchanged.',
      )
    )
      return
    await createDeviceAction({
      deviceId: mac,
      type: 'acknowledge_drift',
      input: {
        schedule_fingerprint: current.firmware.fingerprint,
        drift_episode_id: drift.id,
      },
    })
  }

  return (
    <section
      className="border-l-2 border-amber-500 bg-amber-950/30 px-4 py-3"
      aria-labelledby="drift-title"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <h2 id="drift-title" className="text-sm font-semibold text-amber-100">
            Firmware schedule changed
          </h2>
          <p className="mt-1 text-sm text-amber-100/80">
            {REASONS[drift.reason] ?? REASONS.unknown_firmware_change} Firmware remains
            authoritative until you choose how to reconcile it.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={toggleDetails}
              disabled={actions.view_drift_details?.enabled === false || busy !== null}
              title={disabledText(actions.view_drift_details?.disabled_reason) ?? undefined}
              className="inline-flex h-9 items-center gap-1.5 border border-amber-800 px-3 text-xs font-medium text-amber-100 hover:bg-amber-950 disabled:opacity-50"
            >
              {busy === 'details' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              {expanded ? 'Hide details' : 'View details'}
            </button>
            <button
              type="button"
              onClick={() => {
                void run('reload', reloadExpected)
              }}
              disabled={actions.reload_expected_schedule?.enabled === false || busy !== null}
              title={disabledText(actions.reload_expected_schedule?.disabled_reason) ?? undefined}
              className="inline-flex h-9 items-center gap-1.5 bg-amber-500 px-3 text-xs font-semibold text-gray-950 hover:bg-amber-400 disabled:bg-gray-800 disabled:text-gray-500"
            >
              {busy === 'reload' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Reload expected
            </button>
            <button
              type="button"
              onClick={() => {
                void run('save', saveAsTemplate)
              }}
              disabled={actions.save_as_new_template?.enabled === false || busy !== null}
              title={disabledText(actions.save_as_new_template?.disabled_reason) ?? undefined}
              className="inline-flex h-9 items-center gap-1.5 px-3 text-xs text-amber-100 hover:bg-amber-950 disabled:opacity-50"
            >
              {busy === 'save' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save as new template
            </button>
            <button
              type="button"
              onClick={() => {
                void run('acknowledge', acknowledge)
              }}
              disabled={actions.acknowledge_drift?.enabled === false || busy !== null}
              title={disabledText(actions.acknowledge_drift?.disabled_reason) ?? undefined}
              className="inline-flex h-9 items-center gap-1.5 px-3 text-xs text-amber-100 hover:bg-amber-950 disabled:opacity-50"
            >
              {busy === 'acknowledge' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              Acknowledge drift
            </button>
          </div>
        </div>
      </div>

      {expanded && activeDetails && (
        <div className="mt-4 border-t border-amber-900/60 pt-3">
          <p className="text-xs text-amber-200">
            Expected {activeDetails.expected.template_name}, revision{' '}
            {activeDetails.expected.template_revision}
          </p>
          <div className="mt-2 space-y-2">
            {activeDetails.diff.changes.map((change) => (
              <div key={`${change.type}-${change.outlet_id}`} className="text-sm text-gray-200">
                <strong className="capitalize text-white">{change.type}:</strong> {change.label}
                {change.expected && (
                  <span className="text-gray-400"> expected {change.expected.join(', ')}</span>
                )}
                {change.current && (
                  <span className="text-gray-400"> now {change.current.join(', ')}</span>
                )}
              </div>
            ))}
            {activeDetails.diff.unchanged_count > 0 && (
              <p className="text-xs text-gray-500">
                {activeDetails.diff.unchanged_count} schedule entries unchanged.
              </p>
            )}
          </div>
        </div>
      )}
      {error && (
        <p className="mt-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
