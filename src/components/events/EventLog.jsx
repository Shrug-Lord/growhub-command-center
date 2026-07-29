import React, { useCallback, useEffect, useState } from 'react'
import { Plus, X, Leaf } from 'lucide-react'
import { getEvents, createEvent, deleteEvent } from '../../api/piClient.js'
import { useRecoveryTask } from '../../contexts/ServerAvailabilityContext.jsx'

const SYSTEM_TYPES = new Set([
  'schedule_loaded',
  'schedule_removed',
  'device_online',
  'device_offline',
])

const TYPE_LABELS = {
  schedule_loaded: 'Schedule On',
  schedule_removed: 'Schedule Off',
  device_online: 'Online',
  device_offline: 'Offline',
  phase_change: 'Phase Change',
  nutrient_add: 'Nutrients',
  ph_adjustment: 'pH Adjust',
  training: 'Training',
  observation: 'Note',
}

const TYPE_COLORS = {
  schedule_loaded: 'bg-green-900/40 text-green-400 border-green-800/40',
  schedule_removed: 'bg-gray-800 text-gray-400 border-gray-700',
  device_online: 'bg-teal-900/40 text-teal-400 border-teal-800/40',
  device_offline: 'bg-red-900/40 text-red-400 border-red-800/40',
  phase_change: 'bg-purple-900/40 text-purple-400 border-purple-800/40',
  nutrient_add: 'bg-blue-900/40 text-blue-400 border-blue-800/40',
  ph_adjustment: 'bg-cyan-900/40 text-cyan-400 border-cyan-800/40',
  training: 'bg-orange-900/40 text-orange-400 border-orange-800/40',
  observation: 'bg-gray-800 text-gray-300 border-gray-700',
}

const PHASES = ['seedling', 'veg', 'flower', 'flush', 'harvest']

const MANUAL_TYPES = ['phase_change', 'observation', 'nutrient_add', 'ph_adjustment', 'training']

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const BLANK_FORM = { type: 'observation', phase: 'veg', label: '', notes: '', occurredAt: '' }

export default function EventLog({ deviceId }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const loadEvents = useCallback(async () => {
    try {
      const data = await getEvents({ deviceId })
      setEvents(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [deviceId])

  useRecoveryTask(`events-${deviceId}`, loadEvents, 120)

  useEffect(() => {
    void loadEvents()
  }, [loadEvents])

  async function handleAdd() {
    if (!form.type) return
    setSaving(true)
    setError(null)
    try {
      const label =
        form.label.trim() ||
        (form.type === 'phase_change'
          ? `Entered ${form.phase} stage`
          : (TYPE_LABELS[form.type] ?? form.type))
      await createEvent({
        event: {
          deviceId,
          type: form.type,
          phase: form.type === 'phase_change' ? form.phase : null,
          label,
          notes: form.notes.trim() || null,
          occurredAt: form.occurredAt ? new Date(form.occurredAt).getTime() : Date.now(),
        },
      })
      setForm(BLANK_FORM)
      setAdding(false)
      loadEvents()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    try {
      await deleteEvent({ id })
      setEvents((prev) => prev.filter((e) => e._id !== id))
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Leaf className="h-4 w-4 text-green-500" />
          <h2 className="text-white font-medium text-sm">Grow Journal</h2>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-400 hover:text-white text-xs transition-colors"
        >
          {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {adding ? 'Cancel' : 'Add Event'}
        </button>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      {/* Add form */}
      {adding && (
        <div className="bg-gray-800 rounded-lg p-3 space-y-2 border border-gray-700">
          <div className="flex gap-2 flex-wrap">
            <select
              aria-label="Event type"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-gray-300 text-xs focus:outline-none focus:border-green-500"
            >
              {MANUAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            {form.type === 'phase_change' && (
              <select
                aria-label="Growth phase"
                value={form.phase}
                onChange={(e) => setForm((f) => ({ ...f, phase: e.target.value }))}
                className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-gray-300 text-xs focus:outline-none focus:border-green-500 capitalize"
              >
                {PHASES.map((p) => (
                  <option key={p} value={p} className="capitalize">
                    {p}
                  </option>
                ))}
              </select>
            )}
          </div>
          <input
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            placeholder="Label (optional — auto-generated if blank)"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-white text-xs focus:outline-none focus:border-green-500"
          />
          <input
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Notes (optional)"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-white text-xs focus:outline-none focus:border-green-500"
          />
          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              value={form.occurredAt}
              onChange={(e) => setForm((f) => ({ ...f, occurredAt: e.target.value }))}
              className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-gray-300 text-xs focus:outline-none focus:border-green-500"
            />
            <button
              onClick={handleAdd}
              disabled={saving}
              className="px-3 py-1 bg-green-700 hover:bg-green-600 disabled:bg-green-900 rounded-lg text-white text-xs font-medium transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Event list */}
      {loading && (
        <div className="flex justify-center py-4">
          <div className="h-5 w-5 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" />
        </div>
      )}

      {!loading && events.length === 0 && (
        <p className="text-gray-600 text-xs text-center py-4">
          No events yet. Events are logged automatically when schedules load/stop.
        </p>
      )}

      {!loading && events.length > 0 && (
        <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {events.map((ev) => (
            <div
              key={ev._id}
              className="flex items-start gap-2 text-xs py-1.5 border-b border-gray-800 last:border-0"
            >
              <span className="text-gray-600 shrink-0 tabular-nums">
                {formatDate(ev.occurredAt)}
              </span>
              <span
                className={`shrink-0 px-1.5 py-0.5 rounded border text-xs ${TYPE_COLORS[ev.type] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}
              >
                {TYPE_LABELS[ev.type] ?? ev.type}
              </span>
              <span className="text-gray-300 flex-1 min-w-0">
                {ev.label}
                {ev.notes && <span className="text-gray-500 block truncate">{ev.notes}</span>}
              </span>
              {!SYSTEM_TYPES.has(ev.type) && (
                <button
                  onClick={() => handleDelete(ev._id)}
                  className="shrink-0 text-gray-600 hover:text-red-400 transition-colors"
                  title="Delete event"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
