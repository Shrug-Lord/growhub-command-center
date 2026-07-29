import React, { useMemo, useState } from 'react'
import { AlertTriangle, Check, Loader2, RotateCcw, Save, Wand2 } from 'lucide-react'
import { createDeviceAction, updateDeviceOutlets } from '../../api/piClient.js'

const ASSIGNMENTS = [
  'None',
  'Light',
  'Fan',
  'Humidifier',
  'Dehumidifier',
  'Water Pump',
  'Heater',
  'AC Controller',
]

function normalized(profile) {
  return [...(profile ?? [])]
    .sort((a, b) => a.id - b.id)
    .map((outlet) => ({
      id: outlet.id,
      assignment: outlet.assignment ?? outlet.type ?? 'None',
      label: outlet.label ?? `Outlet ${outlet.id}`,
    }))
}

export default function OutletSetup({
  mac,
  profile,
  setup,
  mode,
  availability,
  pendingActions = [],
  onChanged,
}) {
  const source = useMemo(() => normalized(profile), [profile])
  const [draft, setDraft] = useState(source)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [complete, setComplete] = useState(null)
  const pending = pendingActions.find(
    (action) =>
      action.status === 'pending' &&
      ['update_outlet_config', 'repair_outlet_label'].includes(action.type),
  )
  const changed = JSON.stringify(draft) !== JSON.stringify(source)
  const assignmentChanged = draft.some(
    (outlet) =>
      source.find((candidate) => candidate.id === outlet.id)?.assignment !== outlet.assignment,
  )
  const valid =
    draft.length === 4 &&
    draft.every(
      (outlet) =>
        outlet.label.trim() === outlet.label &&
        outlet.label.length > 0 &&
        outlet.label.length <= 32,
    )
  const disabledReason = availability?.enabled === false ? availability.disabled_reason : null

  function update(id, field, value) {
    setDraft((current) =>
      current.map((outlet) => (outlet.id === id ? { ...outlet, [field]: value } : outlet)),
    )
    setComplete(null)
  }

  function applySuggestions() {
    const suggestions = new Map(
      (setup?.label_conflicts ?? [])
        .flatMap((conflict) => conflict.suggestions)
        .map((suggestion) => [suggestion.id, suggestion.label]),
    )
    setDraft((current) =>
      current.map((outlet) =>
        suggestions.has(outlet.id) ? { ...outlet, label: suggestions.get(outlet.id) } : outlet,
      ),
    )
  }

  async function apply() {
    if (!changed || !valid || pending) return
    if (assignmentChanged && mode === 'auto') {
      const proceed = window.confirm(
        'Changing an assignment while AUTO is active may clear that outlet schedule and immediately change relay output. Apply this full outlet configuration?',
      )
      if (!proceed) return
    }
    setSaving(true)
    setError(null)
    try {
      const labelOnly = !assignmentChanged
      const action = await updateDeviceOutlets({
        deviceId: mac,
        outlets: draft,
        baseFingerprint: setup?.outlet_fingerprint,
        labelOnly,
      })
      setComplete(action.status === 'completed' ? 'Saved' : 'Waiting for firmware')
      await onChanged?.()
    } catch (requestError) {
      if (
        requestError.code === 'action_blocked' &&
        requestError.details?.blocked_action?.reason_code === 'device_state_changed'
      ) {
        setError(
          'Firmware outlet state changed while this draft was open. Reload the current state before applying.',
        )
      } else {
        setError(requestError.message)
      }
    } finally {
      setSaving(false)
    }
  }

  async function confirmSetup() {
    setSaving(true)
    setError(null)
    try {
      await createDeviceAction({
        deviceId: mac,
        type: 'confirm_device_setup',
        input: { outlet_fingerprint: setup.outlet_fingerprint },
      })
      setComplete('Setup confirmed')
      await onChanged?.()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="border-y border-gray-800 py-5" aria-labelledby="outlet-setup-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="outlet-setup-title" className="text-sm font-semibold text-white">
            Device setup
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Firmware owns these physical assignments and labels. Applying replaces all four outlets.
          </p>
        </div>
        <span
          className={`border px-2 py-1 text-xs ${
            setup?.current
              ? 'border-green-900 bg-green-950/50 text-green-300'
              : 'border-amber-900 bg-amber-950/50 text-amber-200'
          }`}
        >
          {setup?.current ? 'Setup confirmed' : 'Setup needs review'}
        </span>
      </div>

      {(setup?.label_conflicts?.length ?? 0) > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-l-2 border-amber-500 bg-amber-950/30 px-3 py-2.5 text-sm text-amber-100">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Assigned outlets need unique labels before setup can be confirmed.
          </span>
          <button
            type="button"
            onClick={applySuggestions}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-200 hover:text-white"
          >
            <Wand2 className="h-3.5 w-3.5" /> Use suggestions
          </button>
        </div>
      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {draft.map((outlet) => (
          <div
            key={outlet.id}
            className="grid gap-2 border border-gray-800 bg-gray-900 p-3 sm:grid-cols-[5rem_1fr_1fr] sm:items-end"
          >
            <span className="pb-2 text-sm font-medium text-gray-300">Outlet {outlet.id}</span>
            <label>
              <span className="mb-1 block text-xs text-gray-500">Assignment</span>
              <select
                value={outlet.assignment}
                onChange={(event) => update(outlet.id, 'assignment', event.target.value)}
                className="h-10 w-full border border-gray-700 bg-gray-950 px-2 text-sm text-white focus:border-green-500 focus:outline-none"
              >
                {ASSIGNMENTS.map((assignment) => (
                  <option key={assignment} value={assignment}>
                    {assignment}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs text-gray-500">Label</span>
              <input
                value={outlet.label}
                maxLength={32}
                onChange={(event) => update(outlet.id, 'label', event.target.value)}
                className="h-10 w-full border border-gray-700 bg-gray-950 px-2 text-sm text-white focus:border-green-500 focus:outline-none"
              />
            </label>
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}
      {disabledReason && !pending && (
        <p className="mt-3 text-xs text-amber-200">
          Unavailable: {disabledReason.replaceAll('_', ' ')}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            void apply()
          }}
          disabled={
            !changed || !valid || saving || Boolean(pending) || availability?.enabled === false
          }
          className="inline-flex h-10 items-center gap-2 bg-green-700 px-3 text-sm font-medium text-white hover:bg-green-600 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500"
        >
          {saving || pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {pending ? 'Waiting for firmware' : 'Apply outlet setup'}
        </button>
        {changed && (
          <button
            type="button"
            onClick={() => setDraft(source)}
            disabled={saving || Boolean(pending)}
            className="inline-flex h-10 items-center gap-2 px-3 text-sm text-gray-300 hover:text-white disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" /> Discard draft
          </button>
        )}
        {!changed && !setup?.current && (
          <button
            type="button"
            onClick={() => {
              void confirmSetup()
            }}
            disabled={!setup?.can_confirm || saving || Boolean(pending)}
            className="inline-flex h-10 items-center gap-2 bg-green-700 px-3 text-sm font-medium text-white hover:bg-green-600 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500"
          >
            <Check className="h-4 w-4" /> Confirm current setup
          </button>
        )}
        {complete && (
          <span className="text-xs text-green-300" role="status">
            {complete}
          </span>
        )}
      </div>
    </section>
  )
}
