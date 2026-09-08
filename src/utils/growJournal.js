export const PHASES = ['Seedling', 'Veg', 'Flower', 'Flush', 'Harvest']
export const ENTRY_LABELS = {
  phase_change: 'Phase change',
  observation: 'Note',
  nutrient_add: 'Nutrients',
  ph_adjustment: 'pH adjustment',
  training: 'Training',
}

export function formatDuration(milliseconds, unit = 'days') {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—'
  const days = Math.floor(milliseconds / 86_400_000)
  if (days === 0) return 'Less than 1 day'
  if (unit !== 'weeks') return days + (days === 1 ? ' day' : ' days')
  const weeks = Math.floor(days / 7)
  const remainder = days % 7
  return [
    weeks ? weeks + (weeks === 1 ? ' week' : ' weeks') : '',
    remainder ? remainder + (remainder === 1 ? ' day' : ' days') : '',
  ]
    .filter(Boolean)
    .join(' ')
}

export function localDateTime(value = Date.now()) {
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19)
}

export function journalTimestamp(localValue, original) {
  if (original != null && localValue === localDateTime(original)) return original
  return new Date(localValue).getTime()
}

export function dateLabel(value) {
  return new Date(value).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
