import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Edit2,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react'
import { useDevices } from '../../contexts/DevicesContext.jsx'
import { useRecoveryTask } from '../../contexts/ServerAvailabilityContext.jsx'
import {
  createDeviceAction,
  createScheduleTemplate,
  deleteScheduleTemplate,
  getScheduleTemplate,
  getScheduleTemplateRevisions,
  getScheduleTemplates,
  preflightSchedule,
  waitForDeviceAction,
  updateScheduleTemplate,
} from '../../api/piClient.js'
import ScheduleEditor from './ScheduleEditor.jsx'

const ASSIGNMENT_TONES = {
  Light: 'border-yellow-800 bg-yellow-950/30 text-yellow-200',
  Fan: 'border-sky-800 bg-sky-950/30 text-sky-200',
  Humidifier: 'border-cyan-800 bg-cyan-950/30 text-cyan-200',
  Dehumidifier: 'border-teal-800 bg-teal-950/30 text-teal-200',
  'Water Pump': 'border-blue-800 bg-blue-950/30 text-blue-200',
  Heater: 'border-red-900 bg-red-950/30 text-red-200',
  'AC Controller': 'border-violet-900 bg-violet-950/30 text-violet-200',
}

function blockerText(blocker) {
  const copy = {
    broker_unavailable: 'The MQTT broker is unavailable.',
    device_offline: 'The device is offline.',
    retained_state_syncing: 'Command Center is waiting for retained firmware state.',
    device_setup_review_required:
      'Confirm the current firmware outlet setup on the device page first.',
    missing_assignment: `The device has no ${blocker.assignment} outlet.`,
    ambiguous_assignment: `Choose which ${blocker.assignment} outlet should fill this role.`,
    incompatible_assignment: `Outlet ${blocker.outlet_id} is not assigned ${blocker.expected_assignment}.`,
    duplicate_role_mapping: `Outlet ${blocker.outlet_id} cannot fill more than one role.`,
  }
  return copy[blocker.code] ?? blocker.code.replaceAll('_', ' ')
}

function warningText(warning) {
  if (warning.message) return warning.message
  switch (warning.code) {
    case 'label_drift':
      return `${warning.expected_label} maps to firmware label ${warning.firmware_label}.`
    case 'extra_assigned_outlets': {
      const outlets = Array.isArray(warning.outlets) ? warning.outlets : []
      return `${outlets.length} assigned outlet${outlets.length === 1 ? '' : 's'} are not included in this template.`
    }
    case 'active_entries_will_be_removed': {
      const outletIds = Array.isArray(warning.outlet_ids) ? warning.outlet_ids : []
      return `Loading replaces active schedule entries on outlet${outletIds.length === 1 ? '' : 's'} ${outletIds.join(', ')}.`
    }
    case 'schedule_drift_will_be_replaced':
      return 'The current firmware-owned drifted schedule will be replaced.'
    default:
      return warning.code?.replaceAll('_', ' ') ?? 'Unknown schedule warning'
  }
}

function LoadReview({ template, devices, onBack, onLoaded }) {
  const [deviceId, setDeviceId] = useState(devices[0]?._id ?? '')
  const [mappings, setMappings] = useState({})
  const [preflight, setPreflight] = useState(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [needsRecheck, setNeedsRecheck] = useState(false)
  const [confirmedWarnings, setConfirmedWarnings] = useState(false)
  const [error, setError] = useState(null)
  const device = devices.find((candidate) => candidate._id === deviceId)

  const review = useCallback(
    async (nextMappings = mappings) => {
      if (!deviceId) return
      setLoading(true)
      setError(null)
      try {
        const result = await preflightSchedule({
          deviceId,
          templateId: template.id,
          mappings: nextMappings,
        })
        setPreflight(result)
        setMappings(result.mapping_object)
        setNeedsRecheck(false)
        setConfirmedWarnings(false)
      } catch (requestError) {
        setError(requestError.message)
      } finally {
        setLoading(false)
      }
    },
    [deviceId, mappings, template.id],
  )

  useEffect(() => {
    setMappings({})
    setPreflight(null)
    setNeedsRecheck(false)
    void review({})
    // review intentionally resets whenever the selected device changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, template.id])

  function setMapping(roleId, outletId) {
    setMappings((current) => ({ ...current, [roleId]: Number(outletId) }))
    setNeedsRecheck(true)
    setConfirmedWarnings(false)
  }

  async function load() {
    if (!preflight?.can_load || needsRecheck) return
    setSubmitting(true)
    setError(null)
    try {
      const action = await createDeviceAction({
        deviceId,
        type: 'load_schedule',
        input: {
          template_id: template.id,
          mappings,
          ...(preflight.warnings.length > 0
            ? { acknowledged_warning_signature: preflight.warning_signature }
            : {}),
        },
      })
      const confirmed =
        action.status === 'pending' ? await waitForDeviceAction({ deviceId, action }) : action
      if (confirmed.status === 'completed') {
        onLoaded(confirmed)
      } else if (confirmed.status === 'pending') {
        setError(
          'The schedule was sent, but confirmation is still pending. Check Recent activity before retrying.',
        )
      } else {
        setError(
          confirmed.reason_code
            ? `Firmware did not confirm the schedule: ${confirmed.reason_code.replaceAll('_', ' ')}.`
            : 'Firmware did not confirm the schedule.',
        )
      }
    } catch (requestError) {
      setError(requestError.message)
      if (requestError.code === 'action_blocked') await review(mappings)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 border-b border-gray-800 pb-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-9 items-center gap-1.5 text-sm text-gray-400 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <div>
          <h1 className="text-base font-semibold text-white">Load {template.name}</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            Preflight uses retained firmware assignments and does not change the device.
          </p>
        </div>
      </div>

      <label className="block max-w-md">
        <span className="mb-1 block text-xs text-gray-500">Target device</span>
        <select
          value={deviceId}
          onChange={(event) => setDeviceId(event.target.value)}
          className="h-10 w-full border border-gray-700 bg-gray-950 px-2 text-sm text-white focus:border-green-500 focus:outline-none"
        >
          {devices.map((candidate) => (
            <option key={candidate._id} value={candidate._id}>
              {candidate.name}
            </option>
          ))}
        </select>
      </label>

      {loading && (
        <p className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking firmware state...
        </p>
      )}

      {preflight && (
        <section aria-labelledby="mapping-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 id="mapping-title" className="text-sm font-semibold text-white">
                Role mapping
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                Labels help disambiguate duplicate assignments; firmware validation uses assignment.
              </p>
            </div>
            {needsRecheck && (
              <button
                type="button"
                onClick={() => {
                  void review(mappings)
                }}
                className="inline-flex h-9 items-center gap-1.5 border border-gray-700 px-3 text-xs text-gray-200 hover:bg-gray-800"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Recheck
              </button>
            )}
          </div>
          <div className="divide-y divide-gray-800 border-y border-gray-800">
            {template.roles.map((role) => {
              const compatible = (device?.outlets ?? []).filter(
                (outlet) => outlet.assignment === role.assignment,
              )
              const mapped = preflight.mappings.find((entry) => entry.role_id === role.id)
              return (
                <div
                  key={role.id}
                  className="grid gap-3 py-3 sm:grid-cols-[1fr_1fr] sm:items-center"
                >
                  <div>
                    <p className="text-sm font-medium text-white">{role.label}</p>
                    <p className="text-xs text-gray-500">{role.assignment}</p>
                  </div>
                  <select
                    aria-label={`Outlet for ${role.label}`}
                    value={mappings[role.id] ?? ''}
                    onChange={(event) => setMapping(role.id, event.target.value)}
                    className="h-10 w-full border border-gray-700 bg-gray-950 px-2 text-sm text-white focus:border-green-500 focus:outline-none"
                  >
                    <option value="">Choose an outlet</option>
                    {compatible.map((outlet) => (
                      <option key={outlet.id} value={outlet.id}>
                        Outlet {outlet.id}: {outlet.label}
                      </option>
                    ))}
                  </select>
                  {mapped?.source && (
                    <span className="sr-only">Mapping source {mapped.source}</span>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {preflight?.blockers.length > 0 && (
        <section
          className="border-l-2 border-red-700 bg-red-950/30 px-3 py-3"
          aria-labelledby="blockers-title"
        >
          <h2 id="blockers-title" className="text-sm font-semibold text-red-200">
            Cannot load yet
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-red-100/80">
            {preflight.blockers.map((blocker, index) => (
              <li key={`${blocker.code}-${index}`}>{blockerText(blocker)}</li>
            ))}
          </ul>
        </section>
      )}

      {preflight?.warnings.length > 0 && (
        <section
          className="border-l-2 border-amber-500 bg-amber-950/30 px-3 py-3"
          aria-labelledby="warnings-title"
        >
          <h2 id="warnings-title" className="text-sm font-semibold text-amber-100">
            Review before loading
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-100/80">
            {preflight.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`}>{warningText(warning)}</li>
            ))}
          </ul>
          <label className="mt-3 flex items-start gap-2 text-sm text-amber-100">
            <input
              type="checkbox"
              checked={confirmedWarnings}
              onChange={(event) => setConfirmedWarnings(event.target.checked)}
              className="mt-1 accent-amber-500"
            />
            Load this full replacement schedule despite these warnings.
          </label>
        </section>
      )}

      {preflight?.preview.length > 0 && (
        <section aria-labelledby="preview-title">
          <h2 id="preview-title" className="text-sm font-semibold text-white">
            Compiled preview
          </h2>
          <div className="mt-2 divide-y divide-gray-800 border-y border-gray-800">
            {preflight.preview.map((entry) => (
              <div
                key={entry.role_id}
                className="flex flex-col gap-1 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="text-gray-200">
                  {entry.role_label} to Outlet {entry.outlet_id}: {entry.outlet_label}
                </span>
                <span className="text-xs text-gray-500">{entry.summary}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {error && (
        <p className="text-sm text-red-300" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => {
          void load()
        }}
        disabled={
          !preflight?.can_load ||
          needsRecheck ||
          submitting ||
          (preflight.warnings.length > 0 && !confirmedWarnings)
        }
        className="inline-flex h-10 items-center gap-2 bg-green-700 px-4 text-sm font-medium text-white hover:bg-green-600 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {preflight?.warnings.length > 0 ? 'Load anyway' : 'Load schedule'}
      </button>
    </div>
  )
}

function TemplateDetails({ templateId }) {
  const [template, setTemplate] = useState(null)
  const [revisions, setRevisions] = useState([])
  useEffect(() => {
    void Promise.all([
      getScheduleTemplate({ id: templateId }),
      getScheduleTemplateRevisions({ id: templateId }),
    ]).then(([detail, history]) => {
      setTemplate(detail)
      setRevisions(history)
    })
  }, [templateId])
  if (!template) return <p className="py-3 text-xs text-gray-500">Loading revision history...</p>
  return (
    <div className="mt-3 grid gap-4 border-t border-gray-800 pt-3 lg:grid-cols-2">
      <div>
        <p className="text-xs font-medium uppercase text-gray-500">Revision history</p>
        <ul className="mt-2 space-y-1 text-sm text-gray-300">
          {revisions.map((revision) => (
            <li key={revision.id}>
              Revision {revision.revision} - {new Date(revision.created_at).toLocaleString()}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-xs font-medium uppercase text-gray-500">Device deployments</p>
        {template.deployments.devices.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">Not loaded to a device yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-gray-300">
            {template.deployments.devices.map((device) => (
              <li key={device.device_id}>
                {device.device_name}: revision {device.loaded_revision}
                {device.drifted
                  ? ' - drifted'
                  : device.update_available
                    ? ' - update available'
                    : ' - current'}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default function SchedulePanel() {
  const { deviceList, refreshDevices } = useDevices()
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)
  const [loadingTemplate, setLoadingTemplate] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)

  const loadTemplates = useCallback(async () => {
    try {
      setTemplates(await getScheduleTemplates())
      setError(null)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useRecoveryTask('schedule-templates', loadTemplates, 100)
  useEffect(() => {
    void loadTemplates()
  }, [loadTemplates])

  async function save(template) {
    setSaving(true)
    setError(null)
    try {
      if (editing === 'new') await createScheduleTemplate({ template })
      else await updateScheduleTemplate({ id: editing.id, template })
      setEditing(null)
      await loadTemplates()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove(template) {
    if (
      !window.confirm(
        `Delete ${template.name}? Devices keep their firmware-owned active schedules, but the reusable template will be removed.`,
      )
    )
      return
    try {
      await deleteScheduleTemplate({ id: template.id })
      await loadTemplates()
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  if (editing !== null) {
    return (
      <ScheduleEditor
        template={editing === 'new' ? null : editing}
        onSave={save}
        onCancel={() => setEditing(null)}
        saving={saving}
        error={error}
      />
    )
  }

  if (loadingTemplate) {
    return (
      <LoadReview
        template={loadingTemplate}
        devices={deviceList}
        onBack={() => setLoadingTemplate(null)}
        onLoaded={async () => {
          setNotice('Schedule confirmed.')
          setLoadingTemplate(null)
          await Promise.all([loadTemplates(), refreshDevices()])
        }}
      />
    )
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-800 pb-4">
        <div>
          <h1 className="text-lg font-semibold text-white">Schedule templates</h1>
          <p className="mt-1 text-sm text-gray-500">
            Reusable roles compile to each device's firmware-owned physical outlets.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="inline-flex h-10 items-center gap-2 bg-green-700 px-3 text-sm font-medium text-white hover:bg-green-600"
        >
          <Plus className="h-4 w-4" /> New template
        </button>
      </header>

      {notice && (
        <p
          className="border-l-2 border-green-500 bg-green-950/30 px-3 py-2 text-sm text-green-200"
          role="status"
        >
          {notice}
        </p>
      )}
      {error && (
        <p className="text-sm text-red-300" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading templates...
        </p>
      )}
      {!loading && templates.length === 0 && (
        <div className="border-y border-gray-800 py-12 text-center">
          <p className="text-sm text-gray-400">No schedule templates yet.</p>
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-2">
        {templates.map((template) => (
          <article key={template.id} className="border border-gray-800 bg-gray-900 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-white">{template.name}</h2>
                <p className="mt-1 text-xs text-gray-500">
                  Revision {template.revision} - {template.deployments.device_count} device
                  deployment{template.deployments.device_count === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => setEditing(template)}
                  className="grid h-8 w-8 place-items-center text-gray-400 hover:text-white"
                  title="Edit template"
                  aria-label={`Edit ${template.name}`}
                >
                  <Edit2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void remove(template)
                  }}
                  className="grid h-8 w-8 place-items-center text-gray-500 hover:text-red-300"
                  title="Delete template"
                  aria-label={`Delete ${template.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            {template.description && (
              <p className="mt-2 text-sm text-gray-400">{template.description}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {template.roles.map((role) => (
                <span
                  key={role.id}
                  className={`border px-2 py-1 text-xs ${ASSIGNMENT_TONES[role.assignment] ?? 'border-gray-700 text-gray-300'}`}
                >
                  {role.label}
                </span>
              ))}
            </div>
            {(template.deployments.update_available_count > 0 ||
              template.deployments.drifted_count > 0) && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" />
                {template.deployments.update_available_count > 0 &&
                  `${template.deployments.update_available_count} update available`}
                {template.deployments.update_available_count > 0 &&
                  template.deployments.drifted_count > 0 &&
                  ', '}
                {template.deployments.drifted_count > 0 &&
                  `${template.deployments.drifted_count} drifted`}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-800 pt-3">
              <button
                type="button"
                onClick={() => setLoadingTemplate(template)}
                disabled={deviceList.length === 0}
                className="inline-flex h-9 items-center gap-1.5 bg-green-700 px-3 text-xs font-medium text-white hover:bg-green-600 disabled:bg-gray-800 disabled:text-gray-500"
              >
                <Upload className="h-4 w-4" /> Load to device
              </button>
              <button
                type="button"
                onClick={() =>
                  setExpanded((current) => (current === template.id ? null : template.id))
                }
                className="inline-flex h-9 items-center gap-1.5 px-3 text-xs text-gray-400 hover:text-white"
              >
                <History className="h-4 w-4" /> Revisions and devices
                {expanded === template.id ? (
                  <ChevronLeft className="h-3.5 w-3.5 -rotate-90" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            {expanded === template.id && <TemplateDetails templateId={template.id} />}
          </article>
        ))}
      </div>
    </div>
  )
}
