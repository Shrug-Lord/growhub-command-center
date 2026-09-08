import React, { useState } from 'react'
import { useDevices } from '../../contexts/DevicesContext.jsx'
import { startGrow, createEvent, dismissGrowPrompt } from '../../api/piClient.js'
import { GrowForm, EntryForm, journalButton } from './JournalForms.jsx'
import { dateLabel, PHASES } from '../../utils/growJournal.js'

function Prompt({ device, prompt, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const active = device.activeGrow
  async function dismiss() {
    setBusy(true)
    setError(null)
    try {
      await dismissGrowPrompt({ deviceId: device._id, actionId: prompt.action_id })
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className="sticky top-0 z-20 mx-auto max-w-7xl border border-green-800 bg-gray-900 p-4 shadow-xl"
      aria-label="Schedule grow follow-up"
    >
      <p className="font-medium text-green-200">
        {prompt.template_name} loaded on {device.name}
      </p>
      <p className="mt-1 text-xs text-gray-400">Confirmed {dateLabel(prompt.confirmed_at)}</p>
      <p className="my-3 text-sm text-gray-200">
        {active
          ? 'Did this begin a new phase in ' + active.name + '?'
          : 'Start a grow journal for this device?'}
      </p>
      {!editing && (
        <div className="flex flex-wrap gap-2">
          <button className={journalButton} onClick={() => setEditing(true)}>
            {active ? 'Log phase change' : 'Start grow'}
          </button>
          <button disabled={busy} className={journalButton} onClick={() => void dismiss()}>
            {active ? 'Keep current phase' : 'Not now'}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {editing && (
        <div className="max-h-[65vh] overflow-y-auto">
          {active ? (
            <EntryForm
              initial={{
                type: 'phase_change',
                lockType: true,
                phase:
                  PHASES.find(
                    (phase) => phase.toLowerCase() === prompt.template_name.toLowerCase(),
                  ) ?? 'Veg',
                occurred_at: Math.max(prompt.confirmed_at, active.started_at),
              }}
              onCancel={() => setEditing(false)}
              onSave={async (event) => {
                await createEvent({
                  event: {
                    ...event,
                    deviceId: device._id,
                    growId: active.id,
                    actionId: prompt.action_id,
                  },
                })
                await onChanged()
              }}
            />
          ) : (
            <GrowForm
              initialTime={prompt.confirmed_at}
              onCancel={() => setEditing(false)}
              onSave={async (grow) => {
                await startGrow({
                  deviceId: device._id,
                  grow: { ...grow, action_id: prompt.action_id },
                })
                await onChanged()
              }}
            />
          )}
        </div>
      )}
    </section>
  )
}

export default function ScheduleGrowPrompt() {
  const { deviceList, refreshDevices } = useDevices()
  const pending = deviceList
    .flatMap((device) => (device.growPrompts ?? []).map((prompt) => ({ device, prompt })))
    .sort((a, b) => b.prompt.confirmed_at - a.prompt.confirmed_at)[0]
  return pending ? (
    <Prompt key={pending.prompt.action_id} {...pending} onChanged={refreshDevices} />
  ) : null
}
