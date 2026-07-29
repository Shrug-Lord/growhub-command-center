import assert from 'node:assert/strict'
import test from 'node:test'
import { reportedOrExisting } from '../../src/utils/deviceState.js'

test('reported null clears nullable device state instead of retaining stale data', () => {
  const staleDrift = { id: 'drift-1' }

  assert.equal(reportedOrExisting({ drift: null }, { drift: staleDrift }, 'drift'), null)
})

test('missing reported state retains the prior value during partial updates', () => {
  const existing = { drift: { id: 'drift-1' } }

  assert.equal(reportedOrExisting({}, existing, 'drift'), existing.drift)
})

test('reported values replace prior state and fallback is used only when absent', () => {
  const current = { id: 'drift-2' }

  assert.equal(reportedOrExisting({ drift: current }, { drift: null }, 'drift'), current)
  assert.equal(reportedOrExisting(null, null, 'drift', 'fallback'), 'fallback')
})
