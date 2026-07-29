import React, { useMemo, useState } from 'react'
import { ChevronLeft, Plus, Save, Trash2 } from 'lucide-react'
import { fromDisplayTemp, toDisplayTemp, useTempUnit } from '../../contexts/TempUnitContext.jsx'

const ASSIGNMENTS = [
  'Light',
  'Fan',
  'Humidifier',
  'Dehumidifier',
  'Water Pump',
  'Heater',
  'AC Controller',
]

function defaultConditions(assignment) {
  const conditions = {
    Light: [{ type: 'time_window', start: '06:00', end: '22:00' }],
    Fan: [{ type: 'time_window', start: '06:00', end: '22:00' }],
    Humidifier: [{ type: 'rh_low_band', low: 50, high: 60 }],
    Dehumidifier: [{ type: 'rh_high_band', low: 55, high: 65 }],
    'Water Pump': [{ type: 'interval', run_mins: 15, every_hrs: 4 }],
    Heater: [{ type: 'temp_low_band_c', low_c: 18, high_c: 20 }],
    'AC Controller': [{ type: 'temp_high_band_c', low_c: 24, high_c: 27 }],
  }
  return conditions[assignment]
}

function fieldClass() {
  return 'h-10 w-full border border-gray-700 bg-gray-950 px-2 text-sm text-white focus:border-green-500 focus:outline-none'
}

function TimeWindow({ condition, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label>
        <span className="mb-1 block text-xs text-gray-500">Starts</span>
        <input
          type="time"
          value={condition.start}
          onChange={(event) => onChange({ ...condition, start: event.target.value })}
          className={fieldClass()}
        />
      </label>
      <label>
        <span className="mb-1 block text-xs text-gray-500">Ends</span>
        <input
          type="time"
          value={condition.end}
          onChange={(event) => onChange({ ...condition, end: event.target.value })}
          className={fieldClass()}
        />
      </label>
    </div>
  )
}

function Band({ condition, onChange, temperature = false }) {
  const { unit } = useTempUnit()
  const lowKey = temperature ? 'low_c' : 'low'
  const highKey = temperature ? 'high_c' : 'high'
  const display = (value) => (temperature ? toDisplayTemp(value, unit) : value)
  const stored = (value) => (temperature ? fromDisplayTemp(Number(value), unit) : Number(value))
  return (
    <div className="grid grid-cols-2 gap-2">
      <label>
        <span className="mb-1 block text-xs text-gray-500">
          Low {temperature ? `(${unit})` : '(% RH)'}
        </span>
        <input
          type="number"
          step={temperature ? '0.5' : '1'}
          value={display(condition[lowKey])}
          onChange={(event) => onChange({ ...condition, [lowKey]: stored(event.target.value) })}
          className={fieldClass()}
        />
      </label>
      <label>
        <span className="mb-1 block text-xs text-gray-500">
          High {temperature ? `(${unit})` : '(% RH)'}
        </span>
        <input
          type="number"
          step={temperature ? '0.5' : '1'}
          value={display(condition[highKey])}
          onChange={(event) => onChange({ ...condition, [highKey]: stored(event.target.value) })}
          className={fieldClass()}
        />
      </label>
    </div>
  )
}

function PumpInterval({ condition, onChange }) {
  const hasWindow = Boolean(condition.window)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="mb-1 block text-xs text-gray-500">Run minutes</span>
          <input
            type="number"
            min="1"
            max="240"
            value={condition.run_mins}
            onChange={(event) => onChange({ ...condition, run_mins: Number(event.target.value) })}
            className={fieldClass()}
          />
        </label>
        <label>
          <span className="mb-1 block text-xs text-gray-500">Every hours</span>
          <input
            type="number"
            min="1"
            max="168"
            value={condition.every_hrs}
            onChange={(event) => onChange({ ...condition, every_hrs: Number(event.target.value) })}
            className={fieldClass()}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-xs text-gray-300">
        <input
          type="checkbox"
          checked={hasWindow}
          onChange={(event) =>
            onChange({
              ...condition,
              ...(event.target.checked ? { window: { start: '08:00', end: '20:00' } } : {}),
              ...(!event.target.checked ? { window: undefined } : {}),
            })
          }
          className="accent-green-500"
        />
        Limit runs to allowed hours
      </label>
      {hasWindow && (
        <TimeWindow
          condition={condition.window}
          onChange={(window) => onChange({ ...condition, window })}
        />
      )}
    </div>
  )
}

function FanConditions({ conditions, onChange }) {
  const always = conditions.some((condition) => condition.type === 'always_on')
  const byType = new Map(conditions.map((condition) => [condition.type, condition]))
  function setAlways(value) {
    onChange(value ? [{ type: 'always_on' }] : defaultConditions('Fan'))
  }
  function toggle(type, enabled) {
    const defaults = {
      time_window: { type, start: '06:00', end: '22:00' },
      temp_high_band_c: { type, low_c: 24, high_c: 27 },
      rh_high_band: { type, low: 55, high: 65 },
    }
    const next = enabled
      ? [...conditions, defaults[type]]
      : conditions.filter((condition) => condition.type !== type)
    onChange(next)
  }
  function update(type, value) {
    onChange(conditions.map((condition) => (condition.type === type ? value : condition)))
  }
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs text-gray-300">
        <input
          type="checkbox"
          checked={always}
          onChange={(event) => setAlways(event.target.checked)}
          className="accent-green-500"
        />
        Always on in AUTO
      </label>
      {!always &&
        ['time_window', 'temp_high_band_c', 'rh_high_band'].map((type) => (
          <div key={type} className="border-l border-gray-700 pl-3">
            <label className="flex items-center gap-2 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={byType.has(type)}
                onChange={(event) => toggle(type, event.target.checked)}
                className="accent-green-500"
              />
              {type === 'time_window'
                ? 'Daily time window'
                : type === 'temp_high_band_c'
                  ? 'High temperature'
                  : 'High humidity'}
            </label>
            {byType.has(type) && (
              <div className="mt-2">
                {type === 'time_window' ? (
                  <TimeWindow
                    condition={byType.get(type)}
                    onChange={(value) => update(type, value)}
                  />
                ) : (
                  <Band
                    condition={byType.get(type)}
                    onChange={(value) => update(type, value)}
                    temperature={type === 'temp_high_band_c'}
                  />
                )}
              </div>
            )}
          </div>
        ))}
    </div>
  )
}

function RoleConditions({ role, onChange }) {
  const condition = role.conditions[0]
  if (role.assignment === 'Fan')
    return <FanConditions conditions={role.conditions} onChange={onChange} />
  if (role.assignment === 'Light') {
    const always = condition.type === 'always_on'
    return (
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-xs text-gray-300">
          <input
            type="checkbox"
            checked={always}
            onChange={(event) =>
              onChange(event.target.checked ? [{ type: 'always_on' }] : defaultConditions('Light'))
            }
            className="accent-green-500"
          />
          Always on in AUTO
        </label>
        {!always && <TimeWindow condition={condition} onChange={(value) => onChange([value])} />}
      </div>
    )
  }
  if (role.assignment === 'Water Pump') {
    return <PumpInterval condition={condition} onChange={(value) => onChange([value])} />
  }
  return (
    <Band
      condition={condition}
      onChange={(value) => onChange([value])}
      temperature={role.assignment === 'Heater' || role.assignment === 'AC Controller'}
    />
  )
}

function RoleEditor({ role, index, onChange, onRemove }) {
  function assignmentChanged(assignment) {
    onChange({
      ...role,
      assignment,
      label: role.label || assignment,
      conditions: defaultConditions(assignment),
    })
  }
  return (
    <article className="border border-gray-800 bg-gray-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
          <label>
            <span className="mb-1 block text-xs text-gray-500">Role {index + 1} assignment</span>
            <select
              value={role.assignment}
              onChange={(event) => assignmentChanged(event.target.value)}
              className={fieldClass()}
            >
              {ASSIGNMENTS.map((assignment) => (
                <option key={assignment} value={assignment}>
                  {assignment}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs text-gray-500">Portable role label</span>
            <input
              value={role.label}
              maxLength={32}
              onChange={(event) => onChange({ ...role, label: event.target.value })}
              className={fieldClass()}
              placeholder="e.g. Exhaust Fan"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="grid h-9 w-9 shrink-0 place-items-center text-gray-500 hover:text-red-300"
          title="Remove role"
          aria-label={`Remove role ${index + 1}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-4 border-t border-gray-800 pt-4">
        <RoleConditions role={role} onChange={(conditions) => onChange({ ...role, conditions })} />
      </div>
    </article>
  )
}

export default function ScheduleEditor({ template, onSave, onCancel, saving, error }) {
  const [name, setName] = useState(template?.name ?? '')
  const [description, setDescription] = useState(template?.description ?? '')
  const [roles, setRoles] = useState(() =>
    template?.roles?.length
      ? template.roles
      : [
          {
            assignment: 'Light',
            label: 'Canopy Light',
            conditions: defaultConditions('Light'),
          },
        ],
  )
  const valid = useMemo(
    () =>
      name.trim() === name &&
      name.length > 0 &&
      roles.length > 0 &&
      roles.every(
        (role) =>
          role.label.trim() === role.label && role.label.length > 0 && role.conditions.length > 0,
      ),
    [name, roles],
  )

  function updateRole(index, role) {
    setRoles((current) => current.map((entry, candidate) => (candidate === index ? role : entry)))
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 border-b border-gray-800 pb-4">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-9 items-center gap-1.5 text-sm text-gray-400 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <div>
          <h1 className="text-base font-semibold text-white">
            {template ? `Edit ${template.name}` : 'New schedule template'}
          </h1>
          {template && (
            <p className="mt-0.5 text-xs text-gray-500">
              Saving creates revision {template.revision + 1}. Running devices stay on their
              confirmed revision.
            </p>
          )}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-300" role="alert">
          {error}
        </p>
      )}

      <section
        className="grid gap-3 border-y border-gray-800 py-4 sm:grid-cols-2"
        aria-label="Template details"
      >
        <label>
          <span className="mb-1 block text-xs text-gray-500">Template name</span>
          <input
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            className={fieldClass()}
            placeholder="Flower"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs text-gray-500">Description</span>
          <input
            value={description}
            maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
            className={fieldClass()}
            placeholder="Optional"
          />
        </label>
      </section>

      <section aria-labelledby="roles-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 id="roles-title" className="text-sm font-semibold text-white">
              Schedule roles
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Roles map by assignment to each device's firmware-owned physical outlets.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setRoles((current) => [
                ...current,
                {
                  assignment: 'Fan',
                  label: 'Fan',
                  conditions: defaultConditions('Fan'),
                },
              ])
            }
            disabled={roles.length >= 4}
            className="inline-flex h-9 items-center gap-1.5 border border-gray-700 px-3 text-xs text-gray-200 hover:bg-gray-800 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> Add role
          </button>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {roles.map((role, index) => (
            <RoleEditor
              key={role.id ?? `new-${index}`}
              role={role}
              index={index}
              onChange={(value) => updateRole(index, value)}
              onRemove={() =>
                setRoles((current) => current.filter((_, candidate) => candidate !== index))
              }
            />
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={() => onSave({ name, description, roles })}
        disabled={saving || !valid}
        className="inline-flex h-10 items-center gap-2 bg-green-700 px-4 text-sm font-medium text-white hover:bg-green-600 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500"
      >
        <Save className="h-4 w-4" /> {saving ? 'Saving...' : 'Save template'}
      </button>
    </div>
  )
}
