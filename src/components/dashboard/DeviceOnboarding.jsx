import React, { useMemo, useState } from 'react'
import { Check, Copy, Radio, Router } from 'lucide-react'
import { useDevices } from '../../contexts/DevicesContext.jsx'

function CopyValue({ value, label }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_500)
  }

  const Icon = copied ? Check : Copy
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-gray-800 py-3 last:border-b-0">
      <span className="w-20 shrink-0 text-xs font-medium uppercase text-gray-500">{label}</span>
      <code className="min-w-0 flex-1 truncate text-sm text-gray-100">{value}</code>
      <button
        type="button"
        onClick={() => {
          void copy()
        }}
        className="grid h-8 w-8 shrink-0 place-items-center text-gray-400 hover:text-white"
        title={`Copy ${label.toLowerCase()}`}
        aria-label={`Copy ${label.toLowerCase()}`}
      >
        <Icon className="h-4 w-4" />
      </button>
    </div>
  )
}

export default function DeviceOnboarding() {
  const { serverHealth } = useDevices()
  const browserHost = window.location.hostname || 'growhub.local'
  const isLoopback = browserHost === 'localhost' || browserHost === '127.0.0.1'
  const brokerHost = useMemo(
    () => (isLoopback ? 'growhub.local' : browserHost),
    [browserHost, isLoopback],
  )
  const brokerOnline = serverHealth.broker?.status === 'connected'

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-12 sm:py-16">
      <div className="flex items-start gap-3 border-b border-gray-800 pb-6">
        <div className="grid h-10 w-10 shrink-0 place-items-center bg-green-950 text-green-400">
          <Router className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-white">Connect a Growhub</h1>
          <p className="mt-1 text-sm text-gray-400">
            Enter this MQTT broker in the CE firmware network settings.
          </p>
        </div>
      </div>

      <div className="py-3">
        <CopyValue label="Host" value={brokerHost} />
        <CopyValue label="Port" value="1883" />
      </div>

      {isLoopback && (
        <p className="border-l-2 border-amber-500 pl-3 text-sm text-amber-200">
          If growhub.local is unavailable, use this computer's LAN IP address. Do not enter
          localhost on the firmware.
        </p>
      )}

      <div className="mt-8 flex items-center gap-2 text-sm text-gray-400" role="status">
        <Radio className={`h-4 w-4 ${brokerOnline ? 'text-green-400' : 'text-amber-400'}`} />
        <span>
          {brokerOnline ? 'Waiting for a CE firmware device' : 'Waiting for the MQTT broker'}
        </span>
      </div>
    </div>
  )
}
