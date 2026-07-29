import React from 'react'

export default function RelayToggle({
  label,
  secondaryLabel,
  icon: Icon,
  active,
  pending,
  disabled,
  disabledReason,
  onToggle,
}) {
  const isPending = pending !== null && pending !== undefined
  const displayActive = isPending ? pending : active

  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      title={disabledReason ?? undefined}
      className={`flex h-28 w-full min-w-0 flex-col items-center justify-center gap-1.5 border p-2 transition-all ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:border-gray-600'
      } ${
        displayActive
          ? 'bg-green-500/10 border-green-600 text-green-400'
          : 'bg-gray-800 border-gray-700 text-gray-400'
      } ${isPending ? 'animate-pulse' : ''}`}
    >
      {Icon && <Icon className="h-5 w-5" />}
      <span className="w-full truncate text-xs font-medium">{label}</span>
      <span className="w-full truncate text-[11px] text-gray-500">{secondaryLabel}</span>
      <div className={`h-2 w-2 rounded-full ${displayActive ? 'bg-green-400' : 'bg-gray-600'}`} />
    </button>
  )
}
