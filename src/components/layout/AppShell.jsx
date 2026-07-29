import React from 'react'
import { LogOut } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useDevices } from '../../contexts/DevicesContext.jsx'
import { useServerAvailability } from '../../contexts/ServerAvailabilityContext.jsx'
import Sidebar from './Sidebar.jsx'
import BrokerUnavailableBanner from './BrokerUnavailableBanner.jsx'
import ConnectionBadge from './ConnectionBadge.jsx'
import ServerAvailabilityBanner from './ServerAvailabilityBanner.jsx'

export default function AppShell({ activePage, onNavigate, children }) {
  const { logout, auth } = useAuth()
  const { serverHealth } = useDevices()
  const { isReadOnly } = useServerAvailability()
  const brokerStatus = serverHealth.broker?.status ?? 'unknown'

  return (
    <div className="flex h-screen bg-gray-950 overflow-hidden">
      <Sidebar activePage={activePage} onNavigate={onNavigate} disabled={isReadOnly} />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-gray-900 border-b border-gray-800 flex items-center justify-between gap-2 px-3 sm:px-6 shrink-0">
          <span className="whitespace-nowrap text-sm font-semibold text-white sm:text-base">
            <span className="sm:hidden">Command Center</span>
            <span className="hidden sm:inline">Growhub Command Center</span>
          </span>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <ConnectionBadge status={brokerStatus} />
            {auth?.username && (
              <span className="text-gray-400 text-sm hidden sm:block">{auth.username}</span>
            )}
            <button
              onClick={() => {
                void logout().catch(() => {})
              }}
              className="flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors text-sm"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:block">Logout</span>
            </button>
          </div>
        </header>
        <ServerAvailabilityBanner />
        <BrokerUnavailableBanner
          status={brokerStatus}
          onOpenDiagnostics={() => onNavigate('diagnostics')}
        />
        <main
          className={`flex-1 overflow-y-auto ${isReadOnly ? 'pointer-events-none select-none' : ''}`}
          aria-disabled={isReadOnly}
          {...(isReadOnly ? { inert: '' } : {})}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
