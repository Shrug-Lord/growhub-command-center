import React from 'react'

const statusConfig = {
  connected: { label: 'Broker online', dot: 'bg-green-400', text: 'text-green-400' },
  unknown: {
    label: 'Checking broker',
    dot: 'bg-yellow-400 animate-pulse',
    text: 'text-yellow-400',
  },
  disconnected: { label: 'Broker offline', dot: 'bg-red-400', text: 'text-red-400' },
}

export default function ConnectionBadge({ status }) {
  const cfg = statusConfig[status] ?? statusConfig.unknown
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-800 rounded-full border border-gray-700">
      <div className={`h-2 w-2 rounded-full ${cfg.dot}`} />
      <span className={`hidden text-xs font-medium sm:inline ${cfg.text}`}>{cfg.label}</span>
    </div>
  )
}
