import { toDisplayTemp } from './temperature.js'

export function scheduleConditionSummary(condition, unit = 'C') {
  if (condition.type === 'always_on') return 'Always on'
  if (condition.type === 'time_window') return `${condition.start}-${condition.end}`
  if (condition.type === 'rh_low_band')
    return `Below ${condition.low}% RH, off at ${condition.high}%`
  if (condition.type === 'rh_high_band')
    return `Above ${condition.high}% RH, off at ${condition.low}%`
  if (condition.type === 'temp_low_band_c')
    return `Below ${toDisplayTemp(condition.low_c, unit)} ${unit}, off at ${toDisplayTemp(condition.high_c, unit)} ${unit}`
  if (condition.type === 'temp_high_band_c')
    return `Above ${toDisplayTemp(condition.high_c, unit)} ${unit}, off at ${toDisplayTemp(condition.low_c, unit)} ${unit}`
  const window = condition.window ? ` during ${condition.window.start}-${condition.window.end}` : ''
  return `${condition.run_mins} min every ${condition.every_hrs} hr${window}`
}

export function scheduleConditionsSummary(conditions, unit = 'C') {
  return conditions.map((condition) => scheduleConditionSummary(condition, unit)).join(' or ')
}
