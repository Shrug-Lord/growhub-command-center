import React, { useState, useEffect } from 'react'
import { useDevices } from '../contexts/DevicesContext.jsx'
import DeviceSelector from '../components/dashboard/DeviceSelector.jsx'
import DataTable from '../components/table/DataTable.jsx'
import { useDeviceData } from '../hooks/useDeviceData.js'

function DeviceDataView({ mac }) {
  const { history, historyMeta } = useDeviceData(mac)
  const [selectedSensors] = useState({
    TEMP: true,
    HUMIDITY: true,
    LIGHT: true,
    VPD: false,
    DP: false,
    CO2: false,
  })

  if (!history.length) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center">
        <p className="text-gray-500 text-sm">
          No data loaded. Open Dashboard first to fetch history.
        </p>
      </div>
    )
  }

  return (
    <DataTable
      data={history}
      meta={historyMeta}
      selectedSensors={selectedSensors}
      timeRange="all"
    />
  )
}

export default function DataPage() {
  const { deviceList } = useDevices()
  const [selectedMac, setSelectedMac] = useState(null)

  useEffect(() => {
    if (!selectedMac && deviceList.length > 0) setSelectedMac(deviceList[0]._id)
  }, [deviceList, selectedMac])

  if (deviceList.length === 0) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <p className="text-gray-500 text-sm">No devices connected yet.</p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <DeviceSelector devices={deviceList} selectedMac={selectedMac} onSelect={setSelectedMac} />
      {selectedMac && <DeviceDataView key={selectedMac} mac={selectedMac} />}
    </div>
  )
}
