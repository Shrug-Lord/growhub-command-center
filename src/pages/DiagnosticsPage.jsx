import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  RefreshCw,
  Server,
  Wifi,
} from 'lucide-react'
import {
  getDeviceDiagnostics,
  getDiagnosticsExport,
  getDiagnosticsSummary,
} from '../api/piClient.js'

function formatTime(value) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function JsonDetails({ label, value, open = false }) {
  return (
    <details open={open} className="border-t border-gray-800 py-3 first:border-t-0">
      <summary className="cursor-pointer select-none text-xs font-medium text-gray-300">
        {label}
      </summary>
      <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-black/40 p-3 text-xs leading-5 text-gray-300">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  )
}

function StatusValue({ good, children }) {
  const Icon = good ? CheckCircle2 : AlertTriangle
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm ${good ? 'text-emerald-300' : 'text-amber-300'}`}
    >
      <Icon className="h-4 w-4" />
      {children}
    </span>
  )
}

export default function DiagnosticsPage({ onBack }) {
  const [summary, setSummary] = useState(null)
  const [deviceId, setDeviceId] = useState('')
  const [device, setDevice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState(null)

  const loadSummary = useCallback(async () => {
    setError(null)
    try {
      const next = await getDiagnosticsSummary()
      setSummary(next)
      setDeviceId((current) => current || next.devices?.[0]?.id || '')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadDevice = useCallback(async () => {
    if (!deviceId) {
      setDevice(null)
      return
    }
    try {
      setDevice(await getDeviceDiagnostics({ deviceId }))
    } catch (requestError) {
      setError(requestError.message)
    }
  }, [deviceId])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])
  useEffect(() => {
    void loadDevice()
  }, [loadDevice])

  const refresh = useCallback(async () => {
    setLoading(true)
    await Promise.all([loadSummary(), loadDevice()])
    setLoading(false)
  }, [loadDevice, loadSummary])

  const broker = summary?.global?.server_health?.broker
  const pending = summary?.global?.pending_actions?.total ?? 0
  const stateRows = device?.retained ?? []
  const actions = device?.recent_history?.actions ?? []
  const firmwareErrors = device?.recent_history?.firmware_errors ?? []
  const incidents = device?.retained_state_incidents
  const deviceEvents = device?.recent_history?.device_events ?? []
  const differences = device?.diff?.differences ?? []
  const authEvents = summary?.global?.auth?.auth_security_events ?? []
  const selectedName = useMemo(
    () => summary?.devices?.find((entry) => entry.id === deviceId)?.name ?? deviceId,
    [deviceId, summary],
  )

  async function downloadBundle() {
    setExporting(true)
    setError(null)
    try {
      const bundle = await getDiagnosticsExport()
      const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `growhub-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setExporting(false)
    }
  }

  if (loading && !summary) {
    return <div className="p-6 text-sm text-gray-400">Loading diagnostics...</div>
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            className="mt-0.5 rounded-md p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white"
            aria-label="Back to settings"
            title="Back to settings"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-white">
              <Activity className="h-5 w-5 text-gray-400" />
              Diagnostics
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Read-only current server and firmware evidence.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded-md border border-gray-700 p-2 text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            aria-label="Refresh diagnostics"
            title="Refresh diagnostics"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => void downloadBundle()}
            disabled={exporting}
            className="inline-flex items-center gap-2 rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-950 hover:bg-white disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {exporting ? 'Preparing...' : 'Export JSON'}
          </button>
        </div>
      </header>

      <p className="rounded-md border border-amber-900/70 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
        The redacted export excludes credentials, sessions, CSRF values, and raw auth identities. It
        includes local device MAC addresses and MQTT topic names.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Server status">
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <Server className="mb-3 h-4 w-4 text-gray-500" />
          <p className="text-xs text-gray-500">Server</p>
          <StatusValue good={summary?.global?.runtime?.phase === 'ready'}>
            {summary?.global?.runtime?.phase ?? 'unknown'}
          </StatusValue>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <Wifi className="mb-3 h-4 w-4 text-gray-500" />
          <p className="text-xs text-gray-500">MQTT broker</p>
          <StatusValue
            good={broker?.status === 'connected' && broker?.subscriptions_ready === true}
          >
            {broker?.status ?? 'unknown'}
          </StatusValue>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <p className="text-xs text-gray-500">Schema</p>
          <p className="mt-1 text-sm text-white">
            Version {summary?.global?.schema?.version ?? 'unknown'}
          </p>
          <p className="mt-2 text-xs text-gray-500">
            Node {summary?.global?.runtime?.node_version}
          </p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <p className="text-xs text-gray-500">Pending actions</p>
          <p className="mt-1 text-2xl font-semibold text-white">{pending}</p>
          <p className="mt-1 text-xs text-gray-500">
            Across {summary?.devices?.length ?? 0} devices
          </p>
        </div>
      </section>

      <section className="space-y-4 border-t border-gray-800 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Device evidence</h2>
            <p className="text-xs text-gray-500">
              Current snapshots only. No historical raw MQTT stream is stored.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-400">
            Device
            <select
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value)}
              className="rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
            >
              {(summary?.devices ?? []).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} ({entry.id})
                </option>
              ))}
            </select>
          </label>
        </div>

        {!deviceId && <p className="text-sm text-gray-500">No CE devices have been discovered.</p>}
        {deviceId && device && (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-400">
              <span className="text-gray-200">{selectedName}</span>
              <span>{device.device.id}</span>
              <span>Firmware {device.device.firmware_version ?? 'unknown'}</span>
              <span>Last seen {formatTime(device.device.last_seen_at)}</span>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              {stateRows.map((state) => (
                <article
                  key={state.key}
                  className="rounded-lg border border-gray-800 bg-gray-900 px-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <h3 className="text-sm font-medium text-white">{state.key}</h3>
                      <p className="font-mono text-xs text-gray-500">{state.topic}</p>
                    </div>
                    <div className="text-right text-xs text-gray-500">
                      <p>Revision {state.revision}</p>
                      <p>{formatTime(state.received_at)}</p>
                    </div>
                  </div>
                  <JsonDetails label="Normalized payload" value={state.normalized} />
                  <JsonDetails label="Raw payload" value={state.raw} />
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {device && (
        <section className="grid gap-6 border-t border-gray-800 pt-5 lg:grid-cols-2">
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Expected schedule and diff</h2>
            <div className="rounded-lg border border-gray-800 bg-gray-900 px-4">
              <JsonDetails label="Expected schedule" value={device.expected_schedule} open />
              <JsonDetails
                label={`Payload differences (${differences.length})`}
                value={device.diff}
              />
            </div>
          </div>
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Current errors and incidents</h2>
            <div className="rounded-lg border border-gray-800 bg-gray-900 px-4">
              <JsonDetails
                label={`Firmware errors (${firmwareErrors.length})`}
                value={firmwareErrors}
                open={firmwareErrors.length > 0}
              />
              <JsonDetails
                label={`Active retained-state incidents (${incidents?.active?.length ?? 0})`}
                value={incidents?.active ?? []}
              />
              <JsonDetails
                label={`Resolved retained-state incidents (${incidents?.resolved?.length ?? 0})`}
                value={incidents?.resolved ?? []}
              />
            </div>
          </div>
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Recent device actions</h2>
            <div className="max-h-96 overflow-auto rounded-lg border border-gray-800 bg-gray-900">
              {actions.length === 0 && (
                <p className="p-4 text-xs text-gray-500">No device actions recorded.</p>
              )}
              {actions.map((action) => (
                <details key={action.id} className="border-b border-gray-800 p-3 last:border-b-0">
                  <summary className="cursor-pointer text-xs text-gray-300">
                    <span className="font-medium text-white">{action.type}</span>{' '}
                    <span className="text-gray-500">
                      {action.status} · {formatTime(action.created_at)}
                    </span>
                  </summary>
                  <pre className="mt-2 overflow-auto rounded-md bg-black/40 p-3 text-xs text-gray-300">
                    {JSON.stringify(action, null, 2)}
                  </pre>
                </details>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Device and auth events</h2>
            <div className="rounded-lg border border-gray-800 bg-gray-900 px-4">
              <JsonDetails
                label={`Device events (${deviceEvents.length})`}
                value={deviceEvents}
                open={deviceEvents.length > 0}
              />
              <JsonDetails
                label={`Auth/security events (${authEvents.length})`}
                value={authEvents}
              />
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
