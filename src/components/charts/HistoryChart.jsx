import React, { useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import TimeRangeSelector from './TimeRangeSelector.jsx'
import { useTempUnit } from '../../contexts/TempUnitContext.jsx'
import { downsampleTimeSeries } from '../../utils/chartData.js'

const sensorColors = {
  TEMP: '#f87171',
  HUMIDITY: '#60a5fa',
  LIGHT: '#fbbf24',
  VPD: '#34d399',
  DP: '#a78bfa',
  CO2: '#6b7280',
}

export default function HistoryChart({
  data,
  meta,
  loading,
  error,
  selectedSensors,
  timeRange,
  onTimeRangeChange,
  onSensorToggle,
  onRetry,
}) {
  const { unit } = useTempUnit()

  const filteredData = useMemo(() => {
    if (!data.length) return []
    if (timeRange === 'all') return data

    const latestTs = data[data.length - 1]?.timestamp?.getTime()
    if (!latestTs) return data

    const offsets = { '1h': 1, '6h': 6, '12h': 12, '24h': 24, '7d': 168 }
    const hours = offsets[timeRange]
    if (!hours) return data

    const startDate = new Date(latestTs - hours * 60 * 60 * 1000)
    const endDate = new Date(latestTs)
    return data.filter((item) => item.timestamp >= startDate && item.timestamp <= endDate)
  }, [data, timeRange])

  const sampledData = useMemo(() => downsampleTimeSeries(filteredData), [filteredData])

  const chartData = useMemo(() => {
    if (unit === 'C') return sampledData
    return sampledData.map((row) => ({
      ...row,
      TEMP: row.TEMP != null ? +((row.TEMP * 9) / 5 + 32).toFixed(1) : row.TEMP,
      DP: row.DP != null ? +((row.DP * 9) / 5 + 32).toFixed(1) : row.DP,
    }))
  }, [sampledData, unit])

  const sensorUnits = {
    TEMP: unit === 'F' ? '°F' : '°C',
    HUMIDITY: '%',
    LIGHT: '',
    VPD: 'kPa',
    DP: unit === 'F' ? '°F' : '°C',
    CO2: 'ppm',
  }

  const activeSensors = Object.keys(selectedSensors).filter((k) => selectedSensors[k])
  const returnedCount = meta?.returned_count ?? filteredData.length
  const sourceCount = meta?.source_count ?? returnedCount
  const pointSummary = meta?.aggregated
    ? `${returnedCount.toLocaleString()} averaged points from ${sourceCount.toLocaleString()} readings`
    : `${returnedCount.toLocaleString()} readings`

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <h2 className="text-white font-medium text-sm mr-2">Sensor History</h2>
          <span className="text-gray-500 text-xs" aria-live="polite">
            {loading ? 'Updating…' : pointSummary}
          </span>
        </div>
        <TimeRangeSelector value={timeRange} onChange={onTimeRangeChange} />
      </div>
      <div className="flex flex-wrap gap-3">
        {Object.keys(selectedSensors).map((sensor) => (
          <label key={sensor} className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedSensors[sensor]}
              onChange={() => onSensorToggle(sensor)}
              className="rounded"
            />
            <span className="text-xs font-medium" style={{ color: sensorColors[sensor] }}>
              {sensor}
            </span>
          </label>
        ))}
      </div>
      {error && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-red-500 bg-red-950/30 px-3 py-2 text-sm text-red-200"
          role="alert"
        >
          <span>
            History could not be loaded. The device and the rest of Command Center are unaffected.
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded border border-red-700 px-2.5 py-1 text-xs font-medium hover:bg-red-900/50"
          >
            Retry history
          </button>
        </div>
      )}
      <div className="h-72">
        {chartData.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            {loading ? 'Loading sensor history…' : 'No history data received yet.'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis
                dataKey="dateTime"
                tick={{ fontSize: 11, fill: '#6b7280' }}
                interval="preserveStartEnd"
                angle={-45}
                textAnchor="end"
                height={60}
              />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
              <Tooltip
                isAnimationActive={false}
                contentStyle={{
                  backgroundColor: '#111827',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#9ca3af' }}
                itemStyle={{ color: '#e5e7eb' }}
                labelFormatter={(value) => `${value}`}
                formatter={(value, name) => [
                  `${Number(value).toFixed(2)}${sensorUnits[name] ?? ''}`,
                  name,
                ]}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              {activeSensors.map((sensor) => (
                <Line
                  key={sensor}
                  type="monotone"
                  dataKey={sensor}
                  stroke={sensorColors[sensor]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
