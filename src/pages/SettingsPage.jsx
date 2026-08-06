import React, { useCallback, useEffect, useState } from 'react'
import {
  getSettings,
  getUpdateStatus,
  installUpdate,
  setAutomaticUpdates,
  updateSettings,
} from '../api/piClient.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useTempUnit, toDisplayTemp, fromDisplayTemp } from '../contexts/TempUnitContext.jsx'
import {
  Activity,
  ChevronRight,
  Download,
  KeyRound,
  RefreshCw,
  Save,
  Settings,
  Thermometer,
  User,
} from 'lucide-react'
import { useRecoveryTask } from '../contexts/ServerAvailabilityContext.jsx'

export default function SettingsPage({ onOpenDiagnostics }) {
  const { auth, changePassword, changeUsername } = useAuth()
  const { unit, changeUnit } = useTempUnit()
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [username, setUsername] = useState(auth?.username ?? 'admin')
  const [usernamePassword, setUsernamePassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [credentialError, setCredentialError] = useState(null)
  const [credentialSaving, setCredentialSaving] = useState(null)
  const [updates, setUpdates] = useState(null)
  const [updateBusy, setUpdateBusy] = useState(null)
  const [updateError, setUpdateError] = useState(null)

  const loadSettings = useCallback(async () => {
    setError(null)
    try {
      setSettings(await getSettings())
      try {
        setUpdates(await getUpdateStatus())
      } catch (_) {
        setUpdates(null)
      }
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useRecoveryTask('settings-page', loadSettings, 100)

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  function set(key, value) {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  function setTempField(key, displayValue) {
    const stored = fromDisplayTemp(Number(displayValue), unit)
    set(key, stored)
    setSaved(false)
  }

  function getTempDisplay(key) {
    const raw = Number(settings[key])
    if (isNaN(raw)) return ''
    return toDisplayTemp(raw, unit) ?? ''
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await updateSettings({ settings })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleUsernameChange(event) {
    event.preventDefault()
    setCredentialError(null)
    setCredentialSaving('username')
    try {
      await changeUsername({ username, currentPassword: usernamePassword })
    } catch (requestError) {
      setCredentialError(requestError.message)
    } finally {
      setCredentialSaving(null)
    }
  }

  async function handlePasswordChange(event) {
    event.preventDefault()
    setCredentialError(null)
    setCredentialSaving('password')
    try {
      await changePassword({
        currentPassword,
        password: newPassword,
        passwordConfirmation: newPasswordConfirmation,
      })
    } catch (requestError) {
      setCredentialError(requestError.message)
    } finally {
      setCredentialSaving(null)
    }
  }

  async function checkForUpdates() {
    setUpdateBusy('check')
    setUpdateError(null)
    try {
      setUpdates(await getUpdateStatus({ check: true }))
    } catch (requestError) {
      setUpdateError(requestError.message)
    } finally {
      setUpdateBusy(null)
    }
  }

  async function changeAutomaticUpdates(enabled) {
    setUpdateBusy('settings')
    setUpdateError(null)
    try {
      setUpdates(await setAutomaticUpdates({ enabled }))
    } catch (requestError) {
      setUpdateError(requestError.message)
    } finally {
      setUpdateBusy(null)
    }
  }

  async function startUpdate() {
    setUpdateBusy('install')
    setUpdateError(null)
    try {
      setUpdates(await installUpdate({ tag: updates.latest_release.tag }))
    } catch (requestError) {
      setUpdateError(requestError.message)
    } finally {
      setUpdateBusy(null)
    }
  }

  if (loading)
    return (
      <div className="p-6 flex justify-center pt-16">
        <div className="h-6 w-6 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" />
      </div>
    )

  return (
    <div className="max-w-2xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-2">
        <Settings className="h-5 w-5 text-gray-400" />
        <h1 className="text-white font-semibold">Settings</h1>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 space-y-5">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-gray-400" />
          <h2 className="text-white text-sm font-medium">Administrator</h2>
        </div>
        {credentialError && <p className="text-red-400 text-sm">{credentialError}</p>}

        <form onSubmit={handleUsernameChange} className="space-y-3 border-b border-gray-800 pb-5">
          <h3 className="text-sm font-medium text-gray-300">Change username</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="admin-username" className="block text-xs text-gray-400 mb-1">
                Username
              </label>
              <input
                id="admin-username"
                type="text"
                autoComplete="username"
                required
                minLength={3}
                maxLength={32}
                pattern={'[A-Za-z0-9._\\-]+'}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500"
              />
            </div>
            <div>
              <label
                htmlFor="username-current-password"
                className="block text-xs text-gray-400 mb-1"
              >
                Current password
              </label>
              <input
                id="username-current-password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
                value={usernamePassword}
                onChange={(event) => setUsernamePassword(event.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={credentialSaving !== null}
            className="inline-flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-60 rounded-md text-white text-sm font-medium"
          >
            <User className="h-4 w-4" />
            {credentialSaving === 'username' ? 'Changing...' : 'Change username'}
          </button>
        </form>

        <form onSubmit={handlePasswordChange} className="space-y-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-gray-500" />
            <h3 className="text-sm font-medium text-gray-300">Change password</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="password-current" className="block text-xs text-gray-400 mb-1">
                Current password
              </label>
              <input
                id="password-current"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500"
              />
            </div>
            <div />
            <div>
              <label htmlFor="password-new" className="block text-xs text-gray-400 mb-1">
                New password
              </label>
              <input
                id="password-new"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500"
              />
            </div>
            <div>
              <label htmlFor="password-confirmation" className="block text-xs text-gray-400 mb-1">
                Confirm new password
              </label>
              <input
                id="password-confirmation"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                value={newPasswordConfirmation}
                onChange={(event) => setNewPasswordConfirmation(event.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={credentialSaving !== null}
            className="inline-flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-60 rounded-md text-white text-sm font-medium"
          >
            <KeyRound className="h-4 w-4" />
            {credentialSaving === 'password' ? 'Changing...' : 'Change password'}
          </button>
        </form>
      </section>

      {/* Temperature Unit */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Thermometer className="h-4 w-4 text-gray-400" />
          <h2 className="text-white text-sm font-medium">Temperature Unit</h2>
        </div>
        <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-0.5 w-fit">
          {['C', 'F'].map((u) => (
            <button
              key={u}
              onClick={() => changeUnit(u)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                unit === u ? 'bg-green-700 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              °{u}
            </button>
          ))}
        </div>
        <p className="text-gray-500 text-xs">
          Applies to all temperature readings and schedule trigger thresholds.
        </p>
      </section>

      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Download className="h-4 w-4 text-gray-400" />
          <h2 className="text-white text-sm font-medium">Command Center updates</h2>
        </div>
        <div className="text-xs text-gray-400 space-y-1">
          <p>Installed version: {updates?.current_version ?? 'unknown'}</p>
          {!updates ? (
            <p>Update status is unavailable.</p>
          ) : updates.update_available ? (
            <p className="text-emerald-300">
              Version {updates.latest_release.version} is available.
            </p>
          ) : (
            <p>No newer tagged release is available.</p>
          )}
          {updates?.checked_at && (
            <p className="text-gray-500">
              Last checked {new Date(updates.checked_at).toLocaleString()}.
            </p>
          )}
        </div>

        {updates &&
          !updates.agent?.installed &&
          (updates.update_available || updates.auto_install) && (
            <div className="border-l-2 border-amber-500 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
              <p className="font-medium">One-time Pi setup required</p>
              <p className="mt-1 text-amber-200/80">From the Command Center checkout, run:</p>
              <code className="mt-1 block overflow-x-auto whitespace-nowrap rounded bg-gray-950 px-2 py-1.5 text-gray-200">
                sudo &quot;$(command -v node)&quot; scripts/install-update-agent.js
              </code>
            </div>
          )}

        {updates?.install && (
          <p className="text-xs text-gray-400" role="status">
            Update {updates.install.tag}: {updates.install.state}.
            {updates.install.message ? ` ${updates.install.message}` : ''}
          </p>
        )}
        {updates?.check_error && (
          <p className="text-xs text-amber-300">Last release check: {updates.check_error}</p>
        )}
        {updateError && (
          <p className="text-xs text-red-300" role="alert">
            {updateError}
          </p>
        )}

        <label className="flex items-start gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={updates?.auto_install ?? false}
            disabled={!updates || updateBusy !== null}
            onChange={(event) => void changeAutomaticUpdates(event.target.checked)}
            className="mt-0.5 accent-green-600"
          />
          <span>
            Install verified tagged releases automatically
            <span className="mt-0.5 block text-xs text-gray-500">
              Creates a backup before updating and never installs ordinary main-branch commits.
            </span>
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void checkForUpdates()}
            disabled={updateBusy !== null}
            className="inline-flex items-center gap-2 rounded-md bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${updateBusy === 'check' ? 'animate-spin' : ''}`} />
            Check now
          </button>
          {updates?.update_available && (
            <button
              type="button"
              onClick={() => void startUpdate()}
              disabled={
                !updates.agent?.installed ||
                updateBusy !== null ||
                ['requested', 'installing'].includes(updates.install?.state)
              }
              className="inline-flex items-center gap-2 rounded-md bg-green-700 px-3 py-2 text-sm font-medium text-white hover:bg-green-600 disabled:bg-gray-800 disabled:text-gray-500"
            >
              <Download className="h-4 w-4" />
              {updateBusy === 'install' ? 'Starting…' : `Install ${updates.latest_release.version}`}
            </button>
          )}
        </div>
      </section>

      {/* Data Retention */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 space-y-4">
        <h2 className="text-white text-sm font-medium">Data Retention</h2>
        <p className="text-gray-500 text-xs">
          Sensor measurements older than this are deleted automatically. Changes take effect on the
          next hourly cleanup.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-gray-400 text-sm w-36 shrink-0">Retention period</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              max="3650"
              value={settings.retention_days ?? 365}
              onChange={(e) => set('retention_days', e.target.value)}
              className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-green-500"
            />
            <span className="text-gray-500 text-sm">days</span>
          </div>
        </div>
      </section>

      {/* Alarm Thresholds */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-4 space-y-4">
        <h2 className="text-white text-sm font-medium">Alarm Thresholds</h2>
        <p className="text-gray-500 text-xs">
          Alarms are generated when sensor values exceed these limits. Only one active alarm per
          type per device at a time.
        </p>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-gray-400 text-sm w-36 shrink-0">
              Temp High ({unit === 'F' ? '°F' : '°C'})
            </label>
            <input
              type="number"
              value={getTempDisplay('alarm_temp_high')}
              onChange={(e) => setTempField('alarm_temp_high', e.target.value)}
              className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-green-500"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-gray-400 text-sm w-36 shrink-0">
              Temp Low ({unit === 'F' ? '°F' : '°C'})
            </label>
            <input
              type="number"
              value={getTempDisplay('alarm_temp_low')}
              onChange={(e) => setTempField('alarm_temp_low', e.target.value)}
              className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-green-500"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-gray-400 text-sm w-36 shrink-0">Humidity High (%)</label>
            <input
              type="number"
              min={50}
              max={100}
              value={settings.alarm_humidity_high ?? ''}
              onChange={(e) => set('alarm_humidity_high', e.target.value)}
              className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-green-500"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-gray-400 text-sm w-36 shrink-0">Humidity Low (%)</label>
            <input
              type="number"
              min={0}
              max={60}
              value={settings.alarm_humidity_low ?? ''}
              onChange={(e) => set('alarm_humidity_low', e.target.value)}
              className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-green-500"
            />
          </div>
        </div>
      </section>

      <section className="border-t border-gray-800 pt-4">
        <button
          type="button"
          onClick={onOpenDiagnostics}
          className="flex w-full items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 p-4 text-left hover:border-gray-700 hover:bg-gray-900/80"
        >
          <Activity className="h-5 w-5 shrink-0 text-gray-400" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-white">Diagnostics</span>
            <span className="block text-xs text-gray-500">
              Inspect broker, retained state, device actions, and errors.
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" />
        </button>
      </section>

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-600 disabled:bg-green-900 rounded-lg text-white text-sm font-medium transition-colors"
      >
        <Save className="h-4 w-4" />
        {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Settings'}
      </button>
    </div>
  )
}
