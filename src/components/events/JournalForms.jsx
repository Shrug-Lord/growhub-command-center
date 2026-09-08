import React, { useState } from 'react'
import { ENTRY_LABELS, PHASES, localDateTime, journalTimestamp } from '../../utils/growJournal.js'

const fieldClass =
  'mt-1 w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white'
export const journalButton =
  'rounded border border-gray-600 px-3 py-2 text-sm text-gray-200 hover:border-green-500 hover:text-white disabled:opacity-50'

function PhaseField({ phase, onChange, knownPhases = [] }) {
  const choices = [...new Set([...PHASES, ...knownPhases])]
  const [custom, setCustom] = useState(!choices.includes(phase))
  return (
    <div>
      <label className="block text-sm text-gray-300">
        Phase
        <select
          className={fieldClass}
          value={custom ? '__custom' : phase}
          onChange={(e) => {
            setCustom(e.target.value === '__custom')
            onChange(e.target.value === '__custom' ? '' : e.target.value)
          }}
        >
          {choices.map((name) => (
            <option key={name}>{name}</option>
          ))}
          <option value="__custom">Add custom phase</option>
        </select>
      </label>
      {custom && (
        <label className="mt-2 block text-sm text-gray-300">
          Custom phase name
          <input
            autoFocus
            required
            maxLength={60}
            className={fieldClass}
            value={phase}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      )}
    </div>
  )
}

export function GrowForm({ onSave, onCancel, initialTime, knownPhases }) {
  const [name, setName] = useState('')
  const [phase, setPhase] = useState('Seedling')
  const [startedAt, setStartedAt] = useState(localDateTime(initialTime))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  return (
    <form
      className="space-y-3 rounded-lg border border-gray-700 p-4"
      onSubmit={async (e) => {
        e.preventDefault()
        setSaving(true)
        setError(null)
        try {
          await onSave({ name, phase, started_at: new Date(startedAt).getTime() })
        } catch (err) {
          setError(err.message)
        } finally {
          setSaving(false)
        }
      }}
    >
      <label className="block text-sm text-gray-300">
        Grow name
        <input
          autoFocus
          required
          maxLength={120}
          className={fieldClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <PhaseField phase={phase} onChange={setPhase} knownPhases={knownPhases} />
      <label className="block text-sm text-gray-300">
        Grow start date and time
        <input
          type="datetime-local"
          step="1"
          required
          className={fieldClass}
          value={startedAt}
          onChange={(e) => setStartedAt(e.target.value)}
        />
      </label>
      <p className="text-xs text-gray-400">
        Use the actual grow start and its initial phase. Add subsequent phase changes to the
        timeline.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button disabled={saving} className={journalButton}>
          {saving ? 'Saving…' : 'Start grow'}
        </button>
        <button type="button" disabled={saving} className={journalButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export function EntryForm({ initial = {}, knownPhases, onSave, onCancel }) {
  const [type, setType] = useState(initial.type ?? 'observation')
  const [phase, setPhase] = useState(initial.phase ?? 'Veg')
  const [label, setLabel] = useState(initial.label ?? '')
  const [notes, setNotes] = useState(initial.notes ?? '')
  const [occurredAt, setOccurredAt] = useState(localDateTime(initial.occurred_at))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  return (
    <form
      className="space-y-3 rounded-lg border border-gray-700 p-4"
      onSubmit={async (e) => {
        e.preventDefault()
        setSaving(true)
        setError(null)
        try {
          await onSave({
            type,
            phase: type === 'phase_change' ? phase : null,
            label:
              label.trim() || (type === 'phase_change' ? 'Entered ' + phase : ENTRY_LABELS[type]),
            notes: notes.trim() || null,
            occurredAt: journalTimestamp(occurredAt, initial.occurred_at),
          })
        } catch (err) {
          setError(err.message)
        } finally {
          setSaving(false)
        }
      }}
    >
      <label className="block text-sm text-gray-300">
        Entry type
        <select
          disabled={Boolean(initial.id) || initial.lockType}
          value={type}
          onChange={(e) => setType(e.target.value)}
          className={fieldClass}
        >
          {Object.entries(ENTRY_LABELS).map(([key, value]) => (
            <option key={key} value={key}>
              {value}
            </option>
          ))}
        </select>
      </label>
      {type === 'phase_change' && (
        <PhaseField
          phase={phase}
          onChange={(next) => {
            if (label === 'Entered ' + phase) setLabel('Entered ' + next)
            setPhase(next)
          }}
          knownPhases={knownPhases}
        />
      )}
      <label className="block text-sm text-gray-300">
        Label
        <input
          maxLength={200}
          className={fieldClass}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Optional description"
        />
      </label>
      <label className="block text-sm text-gray-300">
        Notes
        <textarea
          maxLength={10000}
          rows={3}
          className={fieldClass}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <label className="block text-sm text-gray-300">
        Entry date and time
        <input
          type="datetime-local"
          step="1"
          required
          className={fieldClass}
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button disabled={saving} className={journalButton}>
          {saving ? 'Saving…' : 'Save entry'}
        </button>
        <button type="button" disabled={saving} className={journalButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
