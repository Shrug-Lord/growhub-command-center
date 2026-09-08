import React, { useEffect, useState } from 'react'
import { sendFirmwareUpdateAction } from '../../api/piClient.js'
export default function FirmwareUpdates({ deviceId, state, online, firmwareVersion, onChanged }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(null),
    [pending, setPending] = useState(null)
  useEffect(() => {
    setPending(null)
    setError(null)
  }, [deviceId])
  useEffect(() => {
    if (pending && state?.action_id === pending.id) setPending(null)
  }, [state?.action_id, pending])
  useEffect(() => {
    if (!pending) return
    const t = setTimeout(() => {
      setError('Controller acknowledgement was not observed. Check its status before retrying.')
      setPending(null)
    }, 30000)
    return () => clearTimeout(t)
  }, [pending])
  if (!state)
    return (
      <p className="text-xs text-gray-500">
        Firmware release checking requires updated CE firmware.
      </p>
    )
  const stale = state.current_version !== firmwareVersion
  const disabled =
    stale ||
    busy ||
    !!pending ||
    !online ||
    ['checking', 'downloading', 'restarting'].includes(state.stage)
  async function action(op, extra = {}) {
    if (
      op === 'install' &&
      !window.confirm(
        `Install firmware ${state.tag}? The controller will restart and briefly interrupt outlet control.`,
      )
    )
      return
    setBusy(true)
    setError(null)
    try {
      const result = await sendFirmwareUpdateAction(deviceId, {
        op,
        tag: state.tag,
        confirmed: op === 'install',
        ...extra,
      })
      setPending({ id: result.id })
      await onChanged()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      aria-label="Firmware updates"
      className="space-y-2 rounded border border-gray-800 bg-gray-900 p-3 text-xs text-gray-300"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-medium text-white">Firmware updates</h2>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={state.checks_enabled}
            disabled={disabled}
            onChange={(e) => action('settings', { enabled: e.target.checked })}
          />
          Check every six hours
        </label>
      </div>
      <p role="status">
        Installed {state.current_version}.{' '}
        {state.available
          ? `${state.prompt ? 'Update available' : 'Available in settings'}: ${state.tag}. `
          : ''}
        {pending ? 'Waiting for controller acknowledgement' : state.stage}
        {state.bytes > 0
          ? ` — ${Math.floor(state.bytes / 1024)} / ${Math.floor(state.size / 1024)} KB`
          : ''}
      </p>
      {stale && (
        <p>
          Waiting for update state from firmware {firmwareVersion}. The report below is from{' '}
          {state.current_version}.
        </p>
      )}
      {!online && <p>Controller unreachable. Its update outcome is not yet confirmed.</p>}
      {state.checked_at > 0 && (
        <p className="text-gray-500">
          Checked {new Date(state.checked_at * 1000).toLocaleString()}
        </p>
      )}
      {(error || state.error) && (
        <p role="alert" className="text-amber-200">
          {error || state.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="rounded bg-gray-800 px-3 py-2 disabled:opacity-50"
          disabled={disabled}
          onClick={() => action('check')}
        >
          Check now
        </button>
        {state.available && (
          <button
            className="rounded bg-green-800 px-3 py-2 disabled:opacity-50"
            disabled={disabled}
            onClick={() => action('install')}
          >
            Update
          </button>
        )}
        {state.prompt && (
          <>
            <button disabled={disabled} onClick={() => action('later')}>
              Later
            </button>
            <button disabled={disabled} onClick={() => action('skip')}>
              Skip this version
            </button>
          </>
        )}
        {state.release_url && (
          <a
            className="text-green-300 underline"
            href={state.release_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Release notes
          </a>
        )}
      </div>
    </section>
  )
}
