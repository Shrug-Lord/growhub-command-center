import React, { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Tag } from 'lucide-react'
import { createDeviceAction, updateDeviceOutlets } from '../../api/piClient.js'

export default function ScheduleDeploymentStatus({
  mac,
  expectedSchedule,
  labelDrift = [],
  outlets = [],
  outletFingerprint,
  onChanged,
}) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  async function acknowledge(entry) {
    setBusy(`ack-${entry.role_id}`)
    setError(null)
    try {
      await createDeviceAction({
        deviceId: mac,
        type: 'acknowledge_label_drift',
        input: {
          template_id: entry.template_id,
          role_id: entry.role_id,
          outlet_id: entry.outlet_id,
          outlet_fingerprint: outletFingerprint,
        },
      })
      await onChanged?.()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(null)
    }
  }

  async function repair(entry) {
    setBusy(`repair-${entry.role_id}`)
    setError(null)
    try {
      await updateDeviceOutlets({
        deviceId: mac,
        baseFingerprint: outletFingerprint,
        labelOnly: true,
        outlets: outlets.map((outlet) =>
          outlet.id === entry.outlet_id ? { ...outlet, label: entry.expected_label } : outlet,
        ),
      })
      await onChanged?.()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="border-y border-gray-800 py-5" aria-labelledby="deployment-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="deployment-title" className="text-sm font-semibold text-white">
            Active schedule expectation
          </h2>
          {expectedSchedule ? (
            <p className="mt-1 text-xs text-gray-500">
              {expectedSchedule.template_name}, revision {expectedSchedule.loaded_revision}, was
              confirmed by firmware.
            </p>
          ) : (
            <p className="mt-1 text-xs text-gray-500">
              This firmware schedule is not linked to a Command Center template.
            </p>
          )}
        </div>
        {expectedSchedule ? (
          <span className="inline-flex items-center gap-1.5 border border-green-900 bg-green-950/50 px-2 py-1 text-xs text-green-300">
            <CheckCircle2 className="h-3.5 w-3.5" /> Linked
          </span>
        ) : (
          <span className="border border-gray-800 px-2 py-1 text-xs text-gray-400">
            Firmware-owned
          </span>
        )}
      </div>

      {expectedSchedule?.update_available && (
        <div className="mt-3 flex items-center gap-2 border-l-2 border-sky-500 bg-sky-950/30 px-3 py-2 text-sm text-sky-100">
          <RefreshCw className="h-4 w-4 shrink-0" />
          Template revision {expectedSchedule.latest_revision} is available. The device remains on
          confirmed revision {expectedSchedule.loaded_revision} until explicitly loaded.
        </div>
      )}

      {labelDrift.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium uppercase text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" /> Outlet label changes
          </div>
          {labelDrift.map((entry) => (
            <div
              key={`${entry.role_id}-${entry.outlet_id}`}
              className="flex flex-col gap-3 border border-amber-900/60 bg-amber-950/20 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 text-sm text-gray-300">
                <Tag className="mr-2 inline h-4 w-4 text-gray-500" />
                Outlet {entry.outlet_id} is now{' '}
                <strong className="text-white">{entry.firmware_label}</strong>; this deployment
                expected <strong className="text-white">{entry.expected_label}</strong>.
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void repair(entry)
                  }}
                  disabled={busy !== null}
                  className="inline-flex h-8 items-center gap-1.5 border border-gray-700 px-2.5 text-xs text-gray-200 hover:bg-gray-800 disabled:opacity-50"
                >
                  {busy === `repair-${entry.role_id}` && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  Restore expected label
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void acknowledge(entry)
                  }}
                  disabled={busy !== null}
                  className="h-8 px-2.5 text-xs text-gray-400 hover:text-white disabled:opacity-50"
                >
                  Accept firmware label
                </button>
              </div>
            </div>
          ))}
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
