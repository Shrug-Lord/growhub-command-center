import React from 'react'
import { Thermometer, Droplets, Sun, Activity } from 'lucide-react'
import SensorCard from './SensorCard.jsx'
import { useTempUnit, toDisplayTemp } from '../../contexts/TempUnitContext.jsx'

export default function SensorGrid({ snapshot }) {
  const { unit } = useTempUnit()
  const showCO2 = snapshot?.c2 !== undefined && snapshot?.c2 !== null

  const sensors = [
    {
      key: 't',
      label: 'Temperature',
      unit: unit === 'F' ? '°F' : '°C',
      value: toDisplayTemp(snapshot?.t ?? null, unit),
      icon: Thermometer,
      color: '#f87171',
    },
    {
      key: 'h',
      label: 'Humidity',
      unit: '%',
      value: snapshot?.h ?? null,
      icon: Droplets,
      color: '#60a5fa',
    },
    {
      key: 'l',
      label: 'Light level',
      unit: '',
      value: snapshot?.l ?? null,
      icon: Sun,
      color: '#fbbf24',
    },
  ]

  return (
    <div className={`grid grid-cols-1 ${showCO2 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-4`}>
      {sensors.map(({ key, label, unit: sUnit, value, icon, color }) => (
        <SensorCard key={key} label={label} value={value} unit={sUnit} icon={icon} color={color} />
      ))}
      {showCO2 && (
        <SensorCard label="CO2" value={snapshot.c2} unit="ppm" icon={Activity} color="#34d399" />
      )}
    </div>
  )
}
