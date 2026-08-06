import React, { useCallback, useEffect, useState } from 'react'
import { Download, ExternalLink, X } from 'lucide-react'
import { dismissUpdate, getUpdateStatus, installUpdate } from '../../api/piClient.js'
import { useRecoveryTask } from '../../contexts/ServerAvailabilityContext.jsx'

export default function UpdateAvailableBanner({ onOpenSettings }) {
  const [updates, setUpdates] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      setUpdates(await getUpdateStatus())
    } catch (_) {
      // Release checks are advisory and should not obscure normal device controls.
    }
  }, [])

  useRecoveryTask('release-update-banner', refresh, 500)

  useEffect(() => {
    void refresh()
    function updateStatus(event) {
      setUpdates(event.detail)
    }
    window.addEventListener('command-center-update-status', updateStatus)
    return () => window.removeEventListener('command-center-update-status', updateStatus)
  }, [refresh])

  if (!updates?.prompt_available || !updates.latest_release) return null

  async function ignore() {
    setBusy('ignore')
    setError(null)
    try {
      setUpdates(await dismissUpdate({ tag: updates.latest_release.tag }))
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(null)
    }
  }

  async function install() {
    if (!updates.agent?.installed) {
      onOpenSettings()
      return
    }
    setBusy('install')
    setError(null)
    try {
      setUpdates(await installUpdate({ tag: updates.latest_release.tag }))
    } catch (requestError) {
      setError(requestError.message)
      setBusy(null)
    }
  }

  return (
    <aside
      className="border-b border-emerald-800 bg-emerald-950/90 px-3 py-2.5 text-emerald-50 sm:px-6"
      aria-label="Command Center update available"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            Command Center {updates.latest_release.version} is available
          </p>
          <p className="text-xs text-emerald-200/80">
            Installed version: {updates.current_version}.{' '}
            <a
              href={updates.latest_release.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline hover:text-white"
            >
              Release notes <ExternalLink className="h-3 w-3" />
            </a>
          </p>
          {error && (
            <p className="mt-1 text-xs text-red-200" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void install()}
            disabled={busy !== null}
            className="inline-flex h-8 items-center gap-1.5 rounded bg-emerald-700 px-3 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-60"
          >
            <Download className="h-3.5 w-3.5" />
            {updates.agent?.installed
              ? busy === 'install'
                ? 'Starting…'
                : 'Update now'
              : 'Set up updates'}
          </button>
          <button
            type="button"
            onClick={() => void ignore()}
            disabled={busy !== null}
            className="inline-flex h-8 items-center gap-1 rounded px-2 text-xs text-emerald-100 hover:bg-emerald-900 disabled:opacity-60"
          >
            <X className="h-3.5 w-3.5" /> Ignore this release
          </button>
        </div>
      </div>
    </aside>
  )
}
