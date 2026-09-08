import assert from 'node:assert/strict'
import test from 'node:test'
import { formatDuration, localDateTime, journalTimestamp } from '../../src/utils/growJournal.js'

test('duration units preserve completed days and never round into the next phase day', () => {
  const day = 86_400_000
  assert.equal(formatDuration(17 * day, 'days'), '17 days')
  assert.equal(formatDuration(17 * day, 'weeks'), '2 weeks 3 days')
  assert.equal(formatDuration(7 * day, 'weeks'), '1 week')
  assert.equal(formatDuration(day - 1, 'weeks'), 'Less than 1 day')
  assert.equal(formatDuration(day, 'days'), '1 day')
  assert.equal(formatDuration(-1, 'days'), '—')
  assert.equal(formatDuration(17.99 * day, 'weeks'), '2 weeks 3 days')
})

test('datetime-local keeps the original local date and hour', () => {
  const instant = new Date(2026, 8, 6, 14, 23)
  assert.equal(localDateTime(instant.getTime()), '2026-09-06T14:23:00')
})

test('untouched journal times preserve milliseconds so immediate End grow cannot precede its latest entry', () => {
  const entryTime = new Date(2026, 8, 7, 9, 26, 56, 800).getTime()
  const endTime = entryTime + 50
  const displayedEnd = localDateTime(endTime)
  assert.equal(journalTimestamp(displayedEnd, endTime), endTime)
  assert.ok(journalTimestamp(displayedEnd, endTime) >= entryTime)
  const corrected = localDateTime(endTime + 60_000)
  assert.equal(journalTimestamp(corrected, endTime), new Date(corrected).getTime())
})
