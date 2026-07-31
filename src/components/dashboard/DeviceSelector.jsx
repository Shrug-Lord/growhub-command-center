import React from 'react'

export default function DeviceSelector({ devices, selectedMac, onSelect }) {
  function status(device) {
    if (device.presence?.status === 'offline') return { label: 'Offline', tone: 'bg-gray-500' }
    if (device.mirror?.status === 'syncing')
      return { label: 'Syncing retained state', tone: 'bg-amber-400' }
    if (device.compatibility?.status === 'blocked')
      return { label: 'Firmware needs attention', tone: 'bg-red-400' }
    if (device.setup?.current === false)
      return { label: 'Setup needs review', tone: 'bg-amber-400' }
    if (device.drift || device.warnings?.length > 0)
      return { label: 'Needs attention', tone: 'bg-amber-400' }
    return { label: 'Ready', tone: 'bg-green-300' }
  }
  return (
    <div className="flex gap-2 flex-wrap">
      {devices.map((device) => {
        const currentStatus = status(device)
        return (
          <button
            key={device._id}
            onClick={() => onSelect(device._id)}
            aria-label={`${device.name}, ${currentStatus.label}`}
            className={`flex min-h-12 items-center gap-2 px-3 py-2 text-left text-sm font-medium transition-colors ${
              selectedMac === device._id
                ? 'bg-green-700 text-white'
                : 'bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700 border border-gray-700'
            }`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${currentStatus.tone}`} />
            <span className="min-w-0">
              <span className="block max-w-48 truncate">{device.name}</span>
              <span
                className={`block text-xs ${selectedMac === device._id ? 'text-green-100' : 'text-gray-500'}`}
              >
                {currentStatus.label}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
