import React, { useState, useMemo } from 'react'
import { Download } from 'lucide-react'

const sensorUnits = {
  TEMP: '°F',
  HUMIDITY: '%',
  LIGHT: '',
  VPD: 'kPa',
  DP: '°F',
  CO2: 'ppm',
}

export default function DataTable({ data, selectedSensors, timeRange }) {
  const [tableSearch, setTableSearch] = useState('')
  const [tableSortColumn, setTableSortColumn] = useState('timestamp')
  const [tableSortDirection, setTableSortDirection] = useState('desc')
  const [tablePageSize, setTablePageSize] = useState(50)

  const filteredData = useMemo(() => {
    if (!data.length) return []
    if (!timeRange || timeRange === 'all') return data

    const latestTs = data[data.length - 1]?.timestamp?.getTime()
    if (!latestTs) return data

    const offsets = { '1h': 1, '6h': 6, '12h': 12, '24h': 24, '7d': 168 }
    const hours = offsets[timeRange]
    if (!hours) return data

    const startDate = new Date(latestTs - hours * 60 * 60 * 1000)
    const endDate = new Date(latestTs)
    return data.filter((item) => item.timestamp >= startDate && item.timestamp <= endDate)
  }, [data, timeRange])

  const processedTableData = useMemo(() => {
    let processed = [...filteredData]

    if (tableSearch) {
      const search = tableSearch.toLowerCase()
      processed = processed.filter((row) => {
        return (
          row.fullDateTime?.toLowerCase().includes(search) ||
          Object.keys(selectedSensors)
            .filter((sensor) => selectedSensors[sensor])
            .some((sensor) => row[sensor]?.toString().includes(search))
        )
      })
    }

    processed.sort((a, b) => {
      const aVal = tableSortColumn === 'timestamp' ? a.timestamp : a[tableSortColumn]
      const bVal = tableSortColumn === 'timestamp' ? b.timestamp : b[tableSortColumn]
      if (aVal < bVal) return tableSortDirection === 'asc' ? -1 : 1
      if (aVal > bVal) return tableSortDirection === 'asc' ? 1 : -1
      return 0
    })

    return processed
  }, [filteredData, tableSearch, tableSortColumn, tableSortDirection, selectedSensors])

  function handleSort(column) {
    if (tableSortColumn === column) {
      setTableSortDirection(tableSortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setTableSortColumn(column)
      setTableSortDirection('desc')
    }
  }

  function exportToCSV() {
    const activeSensors = Object.keys(selectedSensors).filter((s) => selectedSensors[s])
    const headers = ['Date & Time', ...activeSensors]
    const rows = processedTableData.map((row) => [
      row.fullDateTime,
      ...activeSensors.map((s) => row[s]?.toFixed(2) ?? ''),
    ])
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `growhub-data.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const activeSensors = Object.keys(selectedSensors).filter((s) => selectedSensors[s])
  const displayData =
    tablePageSize === -1 ? processedTableData : processedTableData.slice(0, tablePageSize)

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-white font-medium text-sm">Raw Data</h2>
        <div className="flex items-center gap-3">
          <input
            type="text"
            aria-label="Search data"
            placeholder="Search..."
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-green-500 w-40"
          />
          <select
            aria-label="Rows per page"
            value={tablePageSize}
            onChange={(e) => setTablePageSize(Number(e.target.value))}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none"
          >
            <option value={25}>25 rows</option>
            <option value={50}>50 rows</option>
            <option value={100}>100 rows</option>
            <option value={250}>250 rows</option>
            <option value={500}>500 rows</option>
            <option value={-1}>All ({filteredData.length})</option>
          </select>
          <button
            onClick={exportToCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-400 hover:text-white text-sm transition-colors"
          >
            <Download className="h-4 w-4" />
            CSV
          </button>
        </div>
      </div>
      <div className="text-xs text-gray-500">
        Showing {displayData.length} of {processedTableData.length} records
      </div>
      <div className="overflow-x-auto" style={{ maxHeight: '400px', overflowY: 'auto' }}>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-800 sticky top-0">
            <tr>
              <th
                className="px-4 py-2 text-left font-medium text-gray-300 cursor-pointer hover:text-white"
                onClick={() => handleSort('timestamp')}
              >
                <div className="flex items-center gap-1">
                  Date & Time
                  {tableSortColumn === 'timestamp' && (
                    <span className="text-xs text-gray-400">
                      {tableSortDirection === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </div>
              </th>
              {activeSensors.map((sensor) => (
                <th
                  key={sensor}
                  className="px-4 py-2 text-left font-medium text-gray-300 cursor-pointer hover:text-white"
                  onClick={() => handleSort(sensor)}
                >
                  <div className="flex items-center gap-1">
                    {sensorUnits[sensor] ? `${sensor} (${sensorUnits[sensor]})` : sensor}
                    {tableSortColumn === sensor && (
                      <span className="text-xs text-gray-400">
                        {tableSortDirection === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {displayData.map((row, idx) => (
              <tr key={idx} className="hover:bg-gray-800/50">
                <td className="px-4 py-2 text-gray-300 font-mono text-xs whitespace-nowrap">
                  {row.fullDateTime}
                </td>
                {activeSensors.map((sensor) => (
                  <td key={sensor} className="px-4 py-2 text-gray-400 text-xs">
                    {row[sensor]?.toFixed(2) ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
