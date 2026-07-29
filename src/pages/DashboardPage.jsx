import React, { useState, useEffect } from 'react'
import { useDevices } from '../contexts/DevicesContext.jsx'
import DeviceSelector from '../components/dashboard/DeviceSelector.jsx'
import DeviceDashboard from '../components/dashboard/DeviceDashboard.jsx'
import DeviceOnboarding from '../components/dashboard/DeviceOnboarding.jsx'

export default function DashboardPage() {
  const { deviceList } = useDevices()
  const [selectedMac, setSelectedMac] = useState(null)

  // Default to first device once list is available; follow additions
  useEffect(() => {
    if (
      deviceList.length > 0 &&
      (!selectedMac || !deviceList.some((device) => device._id === selectedMac))
    ) {
      setSelectedMac(deviceList[0]._id)
    }
  }, [deviceList, selectedMac])

  if (deviceList.length === 0) {
    return <DeviceOnboarding />
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4 sm:p-6">
      <DeviceSelector devices={deviceList} selectedMac={selectedMac} onSelect={setSelectedMac} />
      {selectedMac && <DeviceDashboard key={selectedMac} mac={selectedMac} />}
    </div>
  )
}
