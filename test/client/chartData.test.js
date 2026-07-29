import assert from 'node:assert/strict'
import test from 'node:test'
import { downsampleTimeSeries } from '../../src/utils/chartData.js'

test('chart downsampling preserves small datasets by reference', () => {
  const rows = [{ id: 1 }, { id: 2 }]

  assert.equal(downsampleTimeSeries(rows, 3), rows)
})

test('chart downsampling caps points and preserves both endpoints', () => {
  const rows = Array.from({ length: 10_000 }, (_, id) => ({ id }))
  const sampled = downsampleTimeSeries(rows, 1_000)

  assert.equal(sampled.length, 1_000)
  assert.equal(sampled[0], rows[0])
  assert.equal(sampled.at(-1), rows.at(-1))
  assert.equal(new Set(sampled).size, sampled.length)
})

test('chart downsampling handles zero and one-point limits', () => {
  const rows = [{ id: 1 }, { id: 2 }]

  assert.deepEqual(downsampleTimeSeries(rows, 0), [])
  assert.deepEqual(downsampleTimeSeries(rows, 1), [rows[0]])
})
