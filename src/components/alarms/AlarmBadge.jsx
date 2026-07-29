import React from 'react'

export default function AlarmBadge({ count }) {
  if (!count) return null
  return (
    <span className="inline-flex items-center justify-center bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 px-1.5">
      {count > 99 ? '99+' : count}
    </span>
  )
}
