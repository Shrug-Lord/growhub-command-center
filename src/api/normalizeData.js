function formatDateKey(dateObj) {
  const y = dateObj.getFullYear()
  const m = String(dateObj.getMonth() + 1).padStart(2, '0')
  const d = String(dateObj.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function rowsToData(rows) {
  const parsedData = rows
    .map((row) => {
      let timeStr = row.TIME || row.time || row.timestamp
      let localDate = null
      let baseMs = null

      if (timeStr !== undefined && timeStr !== null) {
        if (!Number.isNaN(Number(timeStr)) && `${timeStr}`.trim() !== '') {
          const ms = Number(timeStr) > 1e12 ? Number(timeStr) : Number(timeStr) * 1000
          const asDate = new Date(ms)
          if (!Number.isNaN(asDate.getTime())) {
            baseMs = asDate.getTime()
            localDate = asDate
          }
        }
        if (!localDate) {
          const isoDate = new Date(timeStr)
          if (!Number.isNaN(isoDate.getTime())) {
            baseMs = isoDate.getTime()
            localDate = isoDate
          }
        }
      }

      if (!localDate && timeStr) {
        const cleaned = timeStr.replace(' GMT+0000 (Coordinated Universal Time)', '')
        const dateMatch = cleaned.match(/(\w+) (\w+) (\d+) (\d+) (\d+):(\d+):(\d+)/)
        if (dateMatch) {
          const [, , month, day, year, hour, minute, second] = dateMatch
          const months = {
            Jan: 0,
            Feb: 1,
            Mar: 2,
            Apr: 3,
            May: 4,
            Jun: 5,
            Jul: 6,
            Aug: 7,
            Sep: 8,
            Oct: 9,
            Nov: 10,
            Dec: 11,
          }
          localDate = new Date(year, months[month], day, hour, minute, second)
          baseMs = localDate.getTime()
        }
      }

      if (baseMs === null) return null
      const adjustedDate = new Date(baseMs)
      const dateKey = formatDateKey(adjustedDate)
      const cleanNumber = (val) =>
        val === '' || val === undefined || val === null ? 0 : Number(val)

      return {
        timestamp: adjustedDate,
        time: adjustedDate.toLocaleTimeString('en-US', { hour12: false }),
        date: adjustedDate.toLocaleDateString('en-US'),
        dateTime: adjustedDate.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
        fullDateTime: adjustedDate.toLocaleString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
        dateKey,
        TEMP: cleanNumber(String(row.TEMP ?? '').replace('ºF', '')),
        HUMIDITY: cleanNumber(String(row.HUMIDITY ?? '').replace('%', '')),
        LIGHT: cleanNumber(String(row.LIGHT ?? '').replace('%', '')),
        VPD: cleanNumber(String(row.VPD ?? '').replace('kPa', '')),
        DP: cleanNumber(String(row.DP ?? '').replace('ºF', '')),
        CO2: cleanNumber(String(row.CO2 ?? '').replace('ppm', '')),
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp)

  const dates = new Set(parsedData.map((item) => item.dateKey))
  const lastDateKey = parsedData.length > 0 ? parsedData[parsedData.length - 1].dateKey : null

  return { parsedData, dates, lastDateKey }
}

export function tryIngestLogsFromApi(payload) {
  let parsed = payload
  if (typeof payload === 'string') {
    try {
      parsed = JSON.parse(payload)
    } catch (_error) {
      return false
    }
  }

  const candidates = [
    parsed,
    parsed?.data,
    parsed?.dataLogs,
    parsed?.logs,
    parsed?.data?.dataLogs,
    parsed?.data?.logs,
    parsed?.measurements,
    parsed?.data?.measurements,
  ]
  let rows = candidates.find((c) => Array.isArray(c) && c.length && typeof c[0] === 'object')

  if (!rows && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const seriesKeys = [
      'light',
      'rh',
      'humidity',
      'temp',
      'temperature',
      'vpd',
      'lvpd',
      'dewPoint',
      'co2',
      'c2',
    ]
    const hasSeriesArray = seriesKeys.some((k) => Array.isArray(parsed[k]))
    if (hasSeriesArray) {
      const longestKey = seriesKeys.find((k) => Array.isArray(parsed[k]) && parsed[k].length)
      const base = parsed[longestKey] || []
      rows = base.map((pair, idx) => {
        const ts = Array.isArray(pair) ? pair[0] : (pair?.time ?? pair?.[0])
        const getVal = (k) => {
          const arr = parsed[k]
          if (!Array.isArray(arr)) return undefined
          const entry = arr[idx]
          if (Array.isArray(entry)) return entry[1]
          if (entry && typeof entry === 'object') return entry.value ?? entry.v ?? entry[1]
          return entry
        }
        return {
          TIME: ts,
          LIGHT: getVal('light'),
          HUMIDITY: getVal('rh') ?? getVal('humidity'),
          TEMP: getVal('temp') ?? getVal('temperature'),
          VPD: getVal('vpd') ?? getVal('lvpd'),
          DP: getVal('dewPoint'),
          CO2: getVal('co2') ?? getVal('c2'),
        }
      })
    }
  }

  if (!rows) return false

  const normalized = rows.map((row) => {
    const timeVal =
      row.TIME ??
      row.time ??
      row.timestamp ??
      row.ts ??
      row.date ??
      row.takenAt ??
      row.createdAt ??
      row.updatedAt

    let timeStr = ''
    if (timeVal !== undefined && timeVal !== null) {
      if (typeof timeVal === 'number') {
        const ms = timeVal > 1e12 ? timeVal : timeVal * 1000
        const asDate = new Date(ms)
        if (!Number.isNaN(asDate.getTime())) timeStr = `${ms}`
      } else {
        const asDate = new Date(timeVal)
        if (!Number.isNaN(asDate.getTime())) timeStr = `${asDate.getTime()}`
      }
    }

    const humidity = row.HUMIDITY ?? row.humidity ?? row.rh ?? row.rhValue ?? row.humidityPct ?? ''
    const temp =
      row.TEMP ?? row.temp ?? row.temperature ?? row.temperatureF ?? row.tempF ?? row.temp_f ?? ''
    const light = row.LIGHT ?? row.light ?? row.lightPct ?? row.light_percent ?? ''
    const vpd = row.VPD ?? row.vpd ?? row.lvpd ?? ''
    const dp = row.DP ?? row.dewPoint ?? row.dewPointF ?? row.dp ?? ''
    const co2 = row.CO2 ?? row.co2 ?? row.c2 ?? row.ppm ?? ''

    return {
      TIME: timeStr || row.TIME || '',
      HUMIDITY: humidity,
      TEMP: temp,
      LIGHT: light,
      VPD: vpd,
      DP: dp,
      CO2: co2,
    }
  })

  const hasTime = normalized.some((r) => r.TIME)
  if (!hasTime) return false

  return rowsToData(normalized)
}
