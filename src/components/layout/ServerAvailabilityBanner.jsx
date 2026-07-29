import React, { useEffect, useState } from 'react'
import {
  Check,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Copy,
  RefreshCw,
  Terminal,
} from 'lucide-react'
import { SERVER_STATUS } from '../../api/serverAvailability.js'
import { useServerAvailability } from '../../contexts/ServerAvailabilityContext.jsx'

const DIAGNOSTIC_COMMANDS = [
  { label: 'Container status', command: 'docker compose -f deploy/compose.yml ps' },
  {
    label: 'Command Center logs',
    command: 'docker compose -f deploy/compose.yml logs --tail 100 server',
  },
  {
    label: 'MQTT broker logs',
    command: 'docker compose -f deploy/compose.yml logs --tail 100 mosquitto',
  },
]

const RECOVERY_COMMANDS = [
  { label: 'Start stopped services', command: 'docker compose -f deploy/compose.yml up -d' },
  {
    label: 'Restart Command Center server',
    command: 'docker compose -f deploy/compose.yml restart server',
  },
]

function CommandRow({ label, command, copied, onCopy }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[11rem_minmax(0,1fr)_2rem] sm:items-center">
      <span className="text-xs text-gray-400">{label}</span>
      <code className="min-w-0 overflow-x-auto whitespace-pre-wrap break-words bg-gray-950 px-2 py-1.5 text-xs text-gray-200 sm:whitespace-nowrap">
        {command}
      </code>
      <button
        type="button"
        onClick={() => onCopy(command)}
        className="h-8 w-8 inline-flex items-center justify-center text-gray-400 hover:text-white disabled:text-green-400"
        title={`Copy ${label.toLowerCase()} command`}
        aria-label={`Copy ${label.toLowerCase()} command`}
        disabled={copied}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  )
}

export default function ServerAvailabilityBanner() {
  const { status, checking, retryNow } = useServerAvailability()
  const [showTroubleshooting, setShowTroubleshooting] = useState(false)
  const [copiedCommand, setCopiedCommand] = useState(null)

  useEffect(() => {
    if (!copiedCommand) return undefined
    const handle = setTimeout(() => setCopiedCommand(null), 1_500)
    return () => clearTimeout(handle)
  }, [copiedCommand])

  if (status === SERVER_STATUS.AVAILABLE) return null

  const isUnavailable = status === SERVER_STATUS.UNAVAILABLE
  const title =
    status === SERVER_STATUS.RECOVERING
      ? 'Restoring Command Center'
      : isUnavailable
        ? 'Command Center unavailable'
        : 'Command Center restarting'
  const message =
    status === SERVER_STATUS.RECOVERING
      ? 'Refreshing your session and current data before controls are restored.'
      : isUnavailable
        ? 'The last loaded page is read-only until the server is ready.'
        : 'The last loaded page will remain read-only while the server restarts.'

  async function copyCommand(command) {
    try {
      await navigator.clipboard.writeText(command)
      setCopiedCommand(command)
    } catch {
      setCopiedCommand(null)
    }
  }

  return (
    <div
      className={`shrink-0 border-b ${
        isUnavailable ? 'border-red-900/70 bg-red-950' : 'border-amber-900/70 bg-amber-950'
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
        <div className="flex min-w-0 basis-full flex-1 items-center gap-2.5 sm:basis-auto">
          {isUnavailable ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          ) : (
            <RefreshCw
              className={`h-4 w-4 shrink-0 text-amber-400 ${checking ? 'animate-spin' : ''}`}
            />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">{title}</p>
            <p className="text-xs text-gray-300">{message}</p>
          </div>
        </div>
        {isUnavailable && (
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <button
              type="button"
              onClick={() => void retryNow()}
              disabled={checking}
              className="inline-flex h-8 items-center gap-1.5 bg-red-700 px-3 text-xs font-medium text-white hover:bg-red-600 disabled:cursor-wait disabled:bg-red-900"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
              Retry now
            </button>
            <button
              type="button"
              onClick={() => setShowTroubleshooting((value) => !value)}
              className="inline-flex h-8 items-center gap-1.5 border border-red-800 px-3 text-xs font-medium text-gray-200 hover:bg-red-900/60"
              aria-expanded={showTroubleshooting}
            >
              <Terminal className="h-3.5 w-3.5" />
              Troubleshooting
              {showTroubleshooting ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        )}
      </div>

      {isUnavailable && showTroubleshooting && (
        <div className="max-h-[calc(100vh-11rem)] overflow-y-auto border-t border-red-900/70 px-4 py-4 sm:max-h-none sm:overflow-visible sm:px-6">
          <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <div className="space-y-2 text-xs text-gray-300">
              <p className="font-medium text-white">Host and network checks</p>
              <p>
                Confirm this browser is connected to the same network as the Command Center host.
              </p>
              <p>
                Try the host IP address if <code>growhub.local</code> does not resolve.
              </p>
              <p>Run these commands from the Growhub Command Center project directory.</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-medium text-white">Inspect</p>
                {DIAGNOSTIC_COMMANDS.map((item) => (
                  <CommandRow
                    key={item.command}
                    {...item}
                    copied={copiedCommand === item.command}
                    onCopy={copyCommand}
                  />
                ))}
              </div>
              <div className="space-y-2 border-t border-red-900/60 pt-3">
                <p className="text-xs font-medium text-white">Recovery actions</p>
                {RECOVERY_COMMANDS.map((item) => (
                  <CommandRow
                    key={item.command}
                    {...item}
                    copied={copiedCommand === item.command}
                    onCopy={copyCommand}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
