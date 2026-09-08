import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  getJournal,
  getGrow,
  startGrow,
  endGrow,
  createEvent,
  editEvent,
  deleteEvent,
  assignGrowEntries,
} from '../../api/piClient.js'
import { useDevices } from '../../contexts/DevicesContext.jsx'
import { useRecoveryTask } from '../../contexts/ServerAvailabilityContext.jsx'
import CollapsibleSection from '../dashboard/CollapsibleSection.jsx'
import { EntryForm, GrowForm, journalButton } from './JournalForms.jsx'
import {
  dateLabel,
  ENTRY_LABELS,
  formatDuration,
  localDateTime,
  journalTimestamp,
} from '../../utils/growJournal.js'

export default function EventLog({ deviceId }) {
  const { pollRevision, refreshDevices } = useDevices()
  const [overview, setOverview] = useState({ grows: [], unassigned: [] })
  const [selected, setSelected] = useState(null)
  const [grow, setGrow] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(null)
  const [filter, setFilter] = useState('all')
  const [selectedEntries, setSelectedEntries] = useState([])
  const [assignTarget, setAssignTarget] = useState('')
  const endDefaultRef = useRef(Date.now())
  const [endedAt, setEndedAt] = useState(localDateTime(endDefaultRef.current))
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [unit, setUnit] = useState(() => {
    try {
      return localStorage.getItem('grow_duration_unit') === 'weeks' ? 'weeks' : 'days'
    } catch {
      return 'days'
    }
  })
  const requestRef = useRef(null)
  const sequenceRef = useRef(0)
  const selectedRef = useRef(null)
  const load = useCallback(
    async (selection) => {
      requestRef.current?.abort()
      const controller = new AbortController()
      requestRef.current = controller
      const sequence = ++sequenceRef.current
      try {
        const next = await getJournal({ deviceId, signal: controller.signal })
        let choice = selection ?? selectedRef.current
        if (
          choice === null ||
          (choice !== 'unassigned' && !next.grows.some((g) => String(g.id) === String(choice)))
        ) {
          choice =
            next.grows.find((g) => g.ended_at === null)?.id ?? next.grows[0]?.id ?? 'unassigned'
        }
        const detail =
          choice === 'unassigned' ? null : await getGrow({ id: choice, signal: controller.signal })
        if (sequence !== sequenceRef.current) return
        selectedRef.current = String(choice)
        setSelected(String(choice))
        setGrow(detail)
        setOverview(next)
        setLoadError(null)
      } catch (err) {
        if (err.code !== 'request_cancelled' && sequence === sequenceRef.current)
          setLoadError(err.message)
      } finally {
        if (sequence === sequenceRef.current) {
          setLoading(false)
          requestRef.current = null
        }
      }
    },
    [deviceId],
  )
  useRecoveryTask('grow-journal-' + deviceId, load)
  useEffect(() => {
    void load()
  }, [load, pollRevision])
  useEffect(
    () => () => {
      sequenceRef.current++
      requestRef.current?.abort()
    },
    [deviceId],
  )
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  function changeUnit(value) {
    setUnit(value)
    try {
      localStorage.setItem('grow_duration_unit', value)
    } catch {
      /* Keep the in-memory preference. */
    }
  }
  async function changed(selection) {
    setForm(null)
    setSelectedEntries([])
    await load(selection)
    await refreshDevices()
  }
  async function action(task) {
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const active = overview.grows.find((g) => g.ended_at === null)
  const entries = grow?.entries ?? overview.unassigned
  const visibleEntries = [...entries]
    .filter((entry) => filter === 'all' || entry.type === filter)
    .sort((a, b) => b.occurred_at - a.occurred_at || b.id - a.id)
  const phases = grow?.phases ?? []
  const lastPhase = phases.at(-1)
  const until = grow?.ended_at ?? now
  const knownPhases = [
    ...new Set(
      [...phases, ...overview.unassigned.filter((entry) => entry.phase)].map(
        (entry) => entry.phase,
      ),
    ),
  ]
  return (
    <CollapsibleSection title="Grow journal" storageKey={deviceId + ':journal'}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 basis-full text-sm text-gray-300 sm:basis-auto">
          View grow
          <select
            value={selected ?? 'unassigned'}
            onChange={(e) => {
              setForm(null)
              setSelectedEntries([])
              selectedRef.current = e.target.value
              setSelected(e.target.value)
              setGrow(null)
              setLoading(true)
              void load(e.target.value)
            }}
            className="mt-1 w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-white"
          >
            {overview.grows.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.ended_at === null ? ' · Active' : ' · Ended'}
              </option>
            ))}
            <option value="unassigned">Unassigned entries ({overview.unassigned.length})</option>
          </select>
        </label>
        <label className="text-sm text-gray-300">
          Duration unit
          <select
            value={unit}
            onChange={(e) => changeUnit(e.target.value)}
            className="ml-2 rounded border border-gray-700 bg-gray-800 px-3 py-2 text-white"
          >
            <option value="days">Days</option>
            <option value="weeks">Weeks</option>
          </select>
        </label>
        {!active && form?.kind !== 'start' && (
          <button
            disabled={loading}
            className={journalButton}
            onClick={() => setForm({ kind: 'start' })}
          >
            Start grow
          </button>
        )}
        {grow?.ended_at === null && (
          <button
            disabled={loading}
            className={journalButton}
            onClick={() => {
              endDefaultRef.current = Date.now()
              setEndedAt(localDateTime(endDefaultRef.current))
              setForm({ kind: 'end' })
            }}
          >
            End grow
          </button>
        )}
      </div>
      {loading && <p className="text-sm text-gray-400">Loading grow journal…</p>}
      {loadError && (
        <p role="alert" className="text-sm text-red-300">
          {loadError}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {grow && (
        <div className="rounded-lg border border-green-900 bg-green-950/20 p-3">
          <p className="font-medium text-green-200">
            {grow.name} · {grow.ended_at === null ? 'Active' : 'Ended'}
          </p>
          <p className="mt-1 text-sm text-gray-200">
            {lastPhase
              ? (grow.ended_at === null ? 'Current phase: ' : 'Final phase: ') +
                lastPhase.phase +
                ' · ' +
                formatDuration(until - lastPhase.started_at, unit)
              : 'No phase recorded'}
            {' · '}Grow age: {formatDuration(until - grow.started_at, unit)}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Started{' '}
            <time dateTime={new Date(grow.started_at).toISOString()}>
              {dateLabel(grow.started_at)}
            </time>
            {grow.ended_at !== null && (
              <>
                {' '}
                · Ended{' '}
                <time dateTime={new Date(grow.ended_at).toISOString()}>
                  {dateLabel(grow.ended_at)}
                </time>
              </>
            )}
          </p>
          {phases.length > 0 && (
            <ol aria-label="Phase timeline" className="mt-3 flex flex-wrap gap-2">
              {phases.map((phase) => (
                <li
                  key={phase.id}
                  className="rounded border border-gray-700 bg-gray-900 p-2 text-sm"
                >
                  <span className="font-medium text-purple-200">{phase.phase}</span>
                  <span className="ml-2 text-gray-200">
                    {formatDuration((phase.ended_at ?? until) - phase.started_at, unit)}
                  </span>
                  <span className="mt-1 block text-xs text-gray-400">
                    {dateLabel(phase.started_at)} →{' '}
                    {phase.ended_at === null ? 'Now' : dateLabel(phase.ended_at)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {form?.kind === 'start' && (
        <GrowForm
          knownPhases={knownPhases}
          onCancel={() => setForm(null)}
          onSave={async (input) => {
            const created = await startGrow({ deviceId, grow: input })
            await changed(created.id)
          }}
        />
      )}
      {form?.kind === 'end' && (
        <form
          className="space-y-3 rounded border border-gray-700 p-3"
          onSubmit={(e) => {
            e.preventDefault()
            void action(async () => {
              await endGrow({
                id: grow.id,
                endedAt: journalTimestamp(endedAt, endDefaultRef.current),
              })
              await changed(grow.id)
            })
          }}
        >
          <label className="block text-sm text-gray-300">
            Grow end date and time
            <input
              required
              type="datetime-local"
              step="1"
              value={endedAt}
              onChange={(e) => setEndedAt(e.target.value)}
              className="ml-2 rounded border border-gray-700 bg-gray-800 p-2 text-white"
            />
          </label>
          <p className="text-xs text-gray-400">
            This finishes the journal timeline. The device continues its existing automation.
          </p>
          <button disabled={loading || busy} className={journalButton}>
            Confirm end grow
          </button>{' '}
          <button type="button" className={journalButton} onClick={() => setForm(null)}>
            Cancel
          </button>
        </form>
      )}
      <div className="flex flex-wrap gap-2" aria-label="Quick journal entry">
        {Object.entries(ENTRY_LABELS).map(([type, label]) => (
          <button
            key={type}
            disabled={loading}
            className={journalButton}
            onClick={() =>
              setForm({
                kind: 'entry',
                type,
                phase: lastPhase?.phase,
                occurred_at: grow?.ended_at ?? Date.now(),
              })
            }
          >
            {type === 'phase_change' ? 'Log phase change' : '+ ' + label}
          </button>
        ))}
      </div>
      {form?.kind === 'entry' && (
        <EntryForm
          key={form.id ?? form.type}
          initial={form}
          knownPhases={knownPhases}
          onCancel={() => setForm(null)}
          onSave={async (input) => {
            if (form.id) await editEvent({ id: form.id, event: input })
            else await createEvent({ event: { ...input, deviceId, growId: grow?.id ?? null } })
            await changed()
          }}
        />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-gray-300">
          Filter entries
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="ml-2 rounded border border-gray-700 bg-gray-800 px-3 py-2 text-white"
          >
            <option value="all">All entries</option>
            {Object.entries(ENTRY_LABELS).map(([type, label]) => (
              <option key={type} value={type}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {!grow && overview.grows.length > 0 && (
          <>
            <label className="text-sm text-gray-300">
              Assign selected to
              <select
                value={assignTarget}
                onChange={(e) => setAssignTarget(e.target.value)}
                className="ml-2 rounded border border-gray-700 bg-gray-800 px-3 py-2 text-white"
              >
                <option value="">Choose grow</option>
                {overview.grows.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={loading || busy || !assignTarget || !selectedEntries.length}
              className={journalButton}
              onClick={() =>
                void action(async () => {
                  await assignGrowEntries({ id: assignTarget, entryIds: selectedEntries })
                  await changed(assignTarget)
                })
              }
            >
              Assign {selectedEntries.length || ''} selected
            </button>
          </>
        )}
      </div>
      {!grow && (
        <p className="text-xs text-gray-400">
          These entries are preserved outside named grows. Select entries to assign them to a grow
          whose dates include them.
        </p>
      )}
      {!loading && visibleEntries.length === 0 && (
        <p className="text-sm text-gray-400">No matching journal entries.</p>
      )}
      <ol
        className="max-h-96 divide-y divide-gray-800 overflow-y-auto"
        aria-label="Journal entries"
      >
        {visibleEntries.map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-start gap-3 py-3 text-sm">
            {!grow && (
              <input
                type="checkbox"
                aria-label={'Select ' + entry.label}
                checked={selectedEntries.includes(entry.id)}
                onChange={(e) => {
                  setSelectedEntries((ids) =>
                    e.target.checked ? [...ids, entry.id] : ids.filter((id) => id !== entry.id),
                  )
                }}
                className="mt-1"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-gray-200">
                <span className="mr-2 text-green-300">
                  {ENTRY_LABELS[entry.type] ?? entry.type}
                </span>
                {entry.label}
              </p>
              <time
                className="text-xs text-gray-400"
                dateTime={new Date(entry.occurred_at).toISOString()}
              >
                {dateLabel(entry.occurred_at)}
              </time>
              {entry.notes && (
                <p className="mt-1 whitespace-pre-wrap break-words text-gray-300">{entry.notes}</p>
              )}
            </div>
            <button
              disabled={loading}
              className={journalButton}
              onClick={() => setForm({ ...entry, kind: 'entry' })}
              aria-label={'Edit ' + entry.label}
            >
              Edit
            </button>
            <button
              disabled={loading || busy}
              className={journalButton}
              onClick={() =>
                void action(async () => {
                  await deleteEvent({ id: entry.id })
                  await changed()
                })
              }
              aria-label={'Delete ' + entry.label}
            >
              Delete
            </button>
          </li>
        ))}
      </ol>
    </CollapsibleSection>
  )
}
