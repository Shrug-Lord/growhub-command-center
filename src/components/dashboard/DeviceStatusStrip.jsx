import React from 'react'
import { AlertTriangle, CheckCircle2, CloudOff, Loader2, Radio } from 'lucide-react'

const STATE_LABELS = {
  presence_state: 'presence',
  outlet_state: 'outlet assignments',
  schedule_state: 'schedule state',
}

function Signal({ icon: Icon, label, tone, spin = false }) {
  const tones = {
    green: 'text-green-300 border-green-900 bg-green-950/60',
    amber: 'text-amber-200 border-amber-900 bg-amber-950/60',
    red: 'text-red-200 border-red-900 bg-red-950/60',
    gray: 'text-gray-300 border-gray-700 bg-gray-900',
  }
  return (
    <span
      className={`inline-flex h-8 items-center gap-1.5 border px-2.5 text-xs font-medium ${tones[tone]}`}
    >
      <Icon className={`h-3.5 w-3.5 ${spin ? 'animate-spin' : ''}`} />
      {label}
    </span>
  )
}

export default function DeviceStatusStrip({ presence, mirror, compatibility, firmwareVersion }) {
  const missing = mirror?.missing_states ?? []
  return (
    <div className="flex flex-col gap-3 border-y border-gray-800 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-2">
        {presence?.status === 'online' && <Signal icon={Radio} label="Online" tone="green" />}
        {presence?.status === 'offline' && <Signal icon={CloudOff} label="Offline" tone="gray" />}
        {presence?.status === 'unknown' && (
          <Signal icon={Loader2} label="Syncing presence" tone="amber" spin />
        )}
        {mirror?.status === 'ready' && (
          <Signal icon={CheckCircle2} label="Device state ready" tone="green" />
        )}
        {mirror?.status === 'syncing' && (
          <Signal
            icon={Loader2}
            label={
              missing.length > 0
                ? `Syncing ${missing.map((state) => STATE_LABELS[state] ?? state).join(', ')}`
                : 'Syncing device state'
            }
            tone="amber"
            spin
          />
        )}
        {mirror?.status === 'incompatible' && (
          <Signal icon={AlertTriangle} label="Firmware contract needs attention" tone="red" />
        )}
      </div>
      <span className="text-xs text-gray-500">Firmware {firmwareVersion || 'not reported'}</span>
      {compatibility?.blockers?.length > 0 && (
        <span className="sr-only">
          {compatibility.blockers.map((blocker) => blocker.code).join(', ')}
        </span>
      )}
    </div>
  )
}
