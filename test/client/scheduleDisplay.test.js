import assert from 'node:assert/strict'
import test from 'node:test'

import {
  scheduleConditionSummary,
  scheduleConditionsSummary,
} from '../../src/utils/scheduleDisplay.js'

test('schedule condition summaries honor the selected temperature unit', () => {
  const condition = { type: 'temp_high_band_c', low_c: 24, high_c: 27 }

  assert.equal(scheduleConditionSummary(condition, 'C'), 'Above 27 C, off at 24 C')
  assert.equal(scheduleConditionSummary(condition, 'F'), 'Above 80.6 F, off at 75.2 F')
})

test('mixed fan conditions retain their order while converting temperature', () => {
  const conditions = [
    { type: 'time_window', start: '06:00', end: '22:00' },
    { type: 'temp_high_band_c', low_c: 24, high_c: 27 },
    { type: 'rh_high_band', low: 65, high: 75 },
  ]

  assert.equal(
    scheduleConditionsSummary(conditions, 'F'),
    '06:00-22:00 or Above 80.6 F, off at 75.2 F or Above 75% RH, off at 65%',
  )
})
