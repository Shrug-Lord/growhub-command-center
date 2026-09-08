import React from 'react'
import { useTempUnit } from '../../contexts/TempUnitContext.jsx'
import { toDisplayTemp } from '../../utils/temperature.js'

export default function HistoryExtrema({ extrema }) {
  const { unit } = useTempUnit()
  if (!extrema) return null
  const metrics = [
    {
      label: 'Temperature',
      values: extrema.temperature_c,
      suffix: '°' + unit,
      convert: (v) => toDisplayTemp(v, unit),
    },
    { label: 'Humidity', values: extrema.humidity_rh, suffix: '%', convert: (v) => v },
  ]
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-label="Selected period ranges">
      {metrics.map(({ label, values, suffix, convert }) => {
        const low = values?.min == null ? null : convert(values.min)
        const high = values?.max == null ? null : convert(values.max)
        return (
          <div key={label} className="rounded-lg border border-gray-700 bg-gray-950/40 p-3">
            <p className="text-xs text-gray-400">{label} · selected period</p>
            {low === null || high === null ? (
              <p className="mt-1 text-sm text-gray-400">No valid readings</p>
            ) : (
              <>
                <p className="mt-1 text-lg font-semibold tabular-nums text-white">
                  {low.toFixed(1)}–{high.toFixed(1)} {suffix}
                </p>
                <p className="text-xs text-gray-400">
                  Low → High · {(high - low).toFixed(1)} {suffix} span
                </p>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
