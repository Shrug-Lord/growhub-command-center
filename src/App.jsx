import React, { lazy, Suspense, useState } from 'react'
import { AuthProvider } from './contexts/AuthContext'
import { DevicesProvider } from './contexts/DevicesContext'
import { ServerAvailabilityProvider } from './contexts/ServerAvailabilityContext'
import { TempUnitProvider } from './contexts/TempUnitContext'
import AuthGate from './components/auth/AuthGate'
import AppShell from './components/layout/AppShell'

const AlarmsPage = lazy(() => import('./pages/AlarmsPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const DataPage = lazy(() => import('./pages/DataPage'))
const DiagnosticsPage = lazy(() => import('./pages/DiagnosticsPage'))
const SchedulesPage = lazy(() => import('./pages/SchedulesPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

function AppInner() {
  const [page, setPage] = useState('dashboard')
  const pages = {
    dashboard: <DashboardPage />,
    data: <DataPage />,
    alarms: <AlarmsPage />,
    schedules: <SchedulesPage />,
    settings: <SettingsPage onOpenDiagnostics={() => setPage('diagnostics')} />,
    diagnostics: <DiagnosticsPage onBack={() => setPage('settings')} />,
  }
  return (
    <AuthGate>
      <AppShell activePage={page} onNavigate={setPage}>
        <Suspense
          fallback={
            <div className="grid min-h-64 place-items-center text-sm text-gray-400" role="status">
              Loading view...
            </div>
          }
        >
          {pages[page]}
        </Suspense>
      </AppShell>
    </AuthGate>
  )
}

export default function App() {
  return (
    <ServerAvailabilityProvider>
      <AuthProvider>
        <DevicesProvider>
          <TempUnitProvider>
            <AppInner />
          </TempUnitProvider>
        </DevicesProvider>
      </AuthProvider>
    </ServerAvailabilityProvider>
  )
}
