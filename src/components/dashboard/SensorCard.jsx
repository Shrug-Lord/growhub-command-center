import React from 'react'

export default function SensorCard({ label, value, unit, icon: Icon, color }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-gray-400 text-sm font-medium">{label}</span>
        {Icon && <Icon className="h-5 w-5" style={{ color }} />}
      </div>
      <div className="flex items-end gap-1">
        <span className="text-3xl font-bold text-white">
          {value !== null && value !== undefined ? Number(value).toFixed(1) : '—'}
        </span>
        <span className="text-gray-400 text-sm mb-1">{unit}</span>
      </div>
    </div>
  )
}
