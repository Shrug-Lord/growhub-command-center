import React, { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useDevices } from '../../contexts/DevicesContext.jsx'
import { useDeviceData } from '../../hooks/useDeviceData.js'
import HistoryChart from '../charts/HistoryChart.jsx'
import EventLog from '../events/EventLog.jsx'
import DataTable from '../table/DataTable.jsx'
import DeviceStatusStrip from './DeviceStatusStrip.jsx'
import DriftBanner from './DriftBanner.jsx'
import OutletSetup from './OutletSetup.jsx'
import RecentActivity from './RecentActivity.jsx'
import RelayPanel from './RelayPanel.jsx'
import ScheduleDeploymentStatus from './ScheduleDeploymentStatus.jsx'
import SensorGrid from './SensorGrid.jsx'

const HISTORY_HOURS = { '1h': 1, '6h': 6, '12h': 12, '24h': 24, '7d': 168, all: 24 * 180 }

export default function DeviceDashboard({ mac }) {
  const {
    liveSnapshot,
    history,
    relayState,
    pendingRelayState,
    outletProfile,
    presence,
    mirror,
    compatibility,
    scheduleState,
    pendingActions,
    warnings,
    setup,
    expectedSchedule,
    drift,
    driftActions,
    labelDrift,
    actionAvailability,
    fetchHistory,
    sendMode,
    sendRelayToggle,
    sendAction,
  } = useDeviceData(mac)
  const { deviceList, refreshDevices } = useDevices()
  const [selectedSensors, setSelectedSensors] = useState({
    TEMP: true,
    HUMIDITY: true,
    LIGHT: true,
    VPD: false,
    DP: false,
    CO2: false,
  })
  const [timeRange, setTimeRange] = useState('24h')
  const device = deviceList.find((candidate) => candidate._id === mac)
  const mode = scheduleState?.mode ?? 'auto'

  useEffect(() => {
    void fetchHistory(HISTORY_HOURS[timeRange])
  }, [fetchHistory, timeRange])

  return (
    <div className="space-y-5">
      <DeviceStatusStrip
        presence={presence}
        mirror={mirror}
        compatibility={compatibility}
        firmwareVersion={device?.firmwareVersion}
      />

      {warnings.length > 0 && (
        <section
          className="border-l-2 border-amber-500 bg-amber-950/30 px-3 py-2.5"
          aria-label="Device warnings"
        >
          {warnings.map((warning) => (
            <p
              key={`${warning.source}-${warning.code}`}
              className="flex items-start gap-2 text-sm text-amber-100"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              {warning.message ?? 'Device state not received.'}
            </p>
          ))}
        </section>
      )}

      <DriftBanner mac={mac} drift={drift} actions={driftActions} onChanged={refreshDevices} />

      <SensorGrid snapshot={liveSnapshot} />

      <ScheduleDeploymentStatus
        mac={mac}
        expectedSchedule={expectedSchedule}
        labelDrift={labelDrift}
        outlets={outletProfile}
        outletFingerprint={setup?.outlet_fingerprint}
        onChanged={refreshDevices}
      />

      <RelayPanel
        relayState={relayState}
        pendingRelayState={pendingRelayState}
        mode={mode}
        onToggle={sendRelayToggle}
        onModeChange={sendMode}
        onAction={sendAction}
        outletProfile={outletProfile}
        expectedSchedule={expectedSchedule}
        scheduleState={scheduleState}
        warnings={warnings.filter((warning) => warning.source === 'firmware')}
        pendingActions={pendingActions}
        actionAvailability={actionAvailability}
      />

      <OutletSetup
        key={setup?.outlet_fingerprint ?? 'outlets-syncing'}
        mac={mac}
        profile={outletProfile}
        setup={setup}
        mode={mode}
        availability={actionAvailability.update_outlet_config}
        pendingActions={pendingActions}
        onChanged={refreshDevices}
      />

      <RecentActivity deviceId={mac} />

      {history.length > 0 ? (
        <>
          <HistoryChart
            data={history}
            selectedSensors={selectedSensors}
            timeRange={timeRange}
            onTimeRangeChange={setTimeRange}
            onSensorToggle={(sensor) =>
              setSelectedSensors((previous) => ({
                ...previous,
                [sensor]: !previous[sensor],
              }))
            }
          />
          <DataTable data={history} selectedSensors={selectedSensors} timeRange={timeRange} />
        </>
      ) : (
        <div className="border-y border-gray-800 py-8 text-center">
          <p className="text-sm text-gray-500">No history data received yet.</p>
        </div>
      )}
      <EventLog deviceId={mac} />
    </div>
  )
}
