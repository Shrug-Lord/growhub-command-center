'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { openDatabase } = require('../src/db');
const { createGrowJournal } = require('../src/growJournal');

const DEVICE = 'AABBCCDDEEFF';
const DAY = 86_400_000;
function harness(t) {
  const database = openDatabase(':memory:');
  database.stmts.ensureDevice.run({ id: DEVICE, observed_at: 0 });
  database.stmts.ensureDevice.run({ id: '112233445566', observed_at: 0 });
  let now = 30 * DAY;
  const journal = createGrowJournal({ database, clock: () => now });
  t.after(() => database.close());
  return {
    database,
    journal,
    advance(days) {
      now += days * DAY;
    },
  };
}

test('named grows preserve separate repeated phases and end explicitly', (t) => {
  const { journal, advance } = harness(t);
  const grow = journal.start(DEVICE, { name: 'Autumn', phase: 'Veg', started_at: DAY });
  assert.throws(() => journal.start(DEVICE, { name: 'Another', phase: 'Veg' }), {
    code: 'grow_already_active',
  });
  const add = (phase, day) =>
    journal.createEntry({
      deviceId: DEVICE,
      growId: grow.id,
      type: 'phase_change',
      phase,
      label: phase,
      occurredAt: day * DAY,
    });
  add('Flower', 10);
  add('Veg', 20);
  add('Harvest', 25);
  assert.equal(journal.detail(grow.id).ended_at, null);
  assert.deepEqual(
    journal.detail(grow.id).phases.map((p) => p.duration_ms / DAY),
    [9, 10, 5, 5],
  );
  journal.end(grow.id, { ended_at: 28 * DAY });
  advance(5);
  assert.equal(journal.detail(grow.id).duration_ms, 27 * DAY);
  assert.equal(journal.detail(grow.id).phases.at(-1).duration_ms, 3 * DAY);
  const second = journal.start(DEVICE, { name: 'Next crop', phase: 'Germination' });
  assert.notEqual(second.id, grow.id);
  assert.equal(journal.overview(DEVICE).grows.length, 2);
});

test('corrections reorder the entire timeline, including ended grows', (t) => {
  const { journal } = harness(t);
  const grow = journal.start(DEVICE, { name: 'Crop', phase: 'Seedling', started_at: DAY });
  const flower = journal.createEntry({
    deviceId: DEVICE,
    growId: grow.id,
    type: 'phase_change',
    phase: 'Flower',
    label: 'Flower',
    occurredAt: 10 * DAY,
  });
  journal.end(grow.id, { ended_at: 20 * DAY });
  journal.editEntry(flower.id, { phase: 'Drying', occurredAt: 8 * DAY, notes: 'Corrected date' });
  const updated = journal.detail(grow.id);
  assert.equal(updated.ended_at, 20 * DAY);
  assert.deepEqual(
    updated.phases.map((p) => p.duration_ms / DAY),
    [7, 12],
  );
  assert.equal(updated.phases[1].phase, 'Drying');
  assert.throws(() => journal.editEntry(flower.id, { occurredAt: 21 * DAY }), /within the grow/);
  assert.throws(() => journal.editEntry(flower.id, { occurredAt: 0 }), /within the grow/);
});

test('assignment preserves content and dates and rejects invalid batches atomically', (t) => {
  const { journal } = harness(t);
  const grow = journal.start(DEVICE, { name: 'Crop', phase: 'Seedling', started_at: DAY });
  const entry = journal.createEntry({
    deviceId: DEVICE,
    type: 'phase_change',
    phase: 'Veg',
    label: 'Original label',
    notes: 'Original notes',
    occurredAt: 5 * DAY,
  });
  const other = journal.createEntry({
    deviceId: '112233445566',
    type: 'observation',
    label: 'Different device',
  });
  assert.throws(
    () => journal.assign(grow.id, { entry_ids: [entry.id, other.id] }),
    /this device only/,
  );
  assert.equal(journal.overview(DEVICE).unassigned.length, 1);
  const result = journal.assign(grow.id, { entry_ids: [entry.id] });
  assert.equal(result.phases.length, 2);
  const assigned = result.entries.find((e) => e.id === entry.id);
  assert.deepEqual({ ...assigned, grow_id: null }, entry);
  assert.equal(journal.overview(DEVICE).unassigned.length, 0);
  assert.throws(() => journal.assign(grow.id, { entry_ids: [entry.id] }), /unassigned/);
});

test('journal validates phase names, timestamps, types, and protects operational records', (t) => {
  const { journal, database } = harness(t);
  assert.throws(() => journal.start(DEVICE, { name: 'Crop', phase: ' ' }), /Phase/);
  assert.throws(
    () => journal.start(DEVICE, { name: 'Crop', phase: 'Veg', started_at: 31 * DAY }),
    /no later than now/,
  );
  assert.equal(journal.overview(DEVICE).grows.length, 0);
  assert.throws(
    () => journal.createEntry({ deviceId: DEVICE, type: 'device_online', label: 'Fake online' }),
    /supported/,
  );
  const legacy = database.stmts.insertEvent.run({
    device_id: DEVICE,
    schedule_id: null,
    type: 'device_online',
    phase: null,
    label: 'Online',
    notes: null,
    occurred_at: 0,
    created_at: 0,
  });
  assert.equal(journal.overview(DEVICE).unassigned.length, 0);
  assert.throws(() => journal.deleteEntry(Number(legacy.lastInsertRowid)), {
    code: 'event_protected',
  });
});
