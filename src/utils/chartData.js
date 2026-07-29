export function downsampleTimeSeries(rows, maxPoints = 1_000) {
  if (!Array.isArray(rows) || rows.length <= maxPoints) return rows
  if (maxPoints < 2) return rows.slice(0, Math.max(0, maxPoints))

  return Array.from({ length: maxPoints }, (_, index) => {
    const sourceIndex = Math.round((index * (rows.length - 1)) / (maxPoints - 1))
    return rows[sourceIndex]
  })
}
