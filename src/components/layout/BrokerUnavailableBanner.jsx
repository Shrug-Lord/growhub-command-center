import React from 'react'
import { WifiOff } from 'lucide-react'

export default function BrokerUnavailableBanner({ status, onOpenDiagnostics }) {
  if (status !== 'disconnected') return null
  return (
    <div
      className="flex items-center gap-2 border-b border-amber-800/60 bg-amber-950/70 px-3 py-2 text-sm text-amber-100 sm:px-6"
      role="status"
    >
      <WifiOff className="h-4 w-4 shrink-0 text-amber-400" />
      <span>
        <strong className="font-medium">MQTT broker unavailable.</strong> Device state is read-only
        until the connection recovers.
      </span>
      <button
        type="button"
        onClick={onOpenDiagnostics}
        className="ml-auto shrink-0 text-xs font-medium text-amber-200 underline decoration-amber-500 underline-offset-2 hover:text-white"
      >
        Diagnostics
      </button>
    </div>
  )
}
