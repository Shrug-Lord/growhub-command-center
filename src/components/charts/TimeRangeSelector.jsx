import React from 'react'

const ranges = [
  { id: '1h', label: '1h' },
  { id: '6h', label: '6h' },
  { id: '12h', label: '12h' },
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: 'all', label: 'All' },
]

export default function TimeRangeSelector({ value, onChange }) {
  return (
    <div className="flex gap-1">
      {ranges.map(({ id, label }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
            value === id
              ? 'bg-green-700 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
