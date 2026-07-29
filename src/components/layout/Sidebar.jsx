import React from 'react'
import { LayoutDashboard, BarChart2, CalendarClock, Bell, Settings } from 'lucide-react'

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'data', label: 'Data', icon: BarChart2 },
  { id: 'schedules', label: 'Schedules', icon: CalendarClock },
  { id: 'alarms', label: 'Alarms', icon: Bell },
  { id: 'settings', label: 'Settings', icon: Settings },
]

export default function Sidebar({ activePage, onNavigate, alarmCount = 0, disabled = false }) {
  return (
    <aside className="flex h-full w-14 shrink-0 flex-col border-r border-gray-800 bg-gray-900 sm:w-56">
      <div className="flex h-14 items-center justify-center border-b border-gray-800 px-2 sm:justify-start sm:px-4">
        <span className="text-sm font-semibold uppercase text-green-400">
          <span className="sm:hidden">GH</span>
          <span className="hidden sm:inline">Growhub</span>
        </span>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-1">
        {navItems.map(({ id, label, icon: Icon }) => {
          const isActive = activePage === id
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              disabled={disabled}
              aria-disabled={disabled}
              title={label}
              className={`w-full flex items-center justify-center gap-0 px-2 py-2.5 rounded-lg text-sm font-medium transition-colors sm:justify-start sm:gap-3 sm:px-3 ${
                isActive
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="hidden flex-1 text-left sm:block">{label}</span>
              {id === 'alarms' && alarmCount > 0 && (
                <span className="hidden bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center sm:inline-block">
                  {alarmCount}
                </span>
              )}
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
