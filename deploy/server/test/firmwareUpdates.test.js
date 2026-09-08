'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeUpdate, prepareUpdateAction } = require('../src/firmwareUpdates');
const { parseFirmwareMessage } = require('../src/firmwareContract');
const { openDatabase } = require('../src/db');
const valid = {
  v: 1,
  checks_enabled: false,
  available: true,
  prompt: true,
  tag: 'v1.3.0C',
  target_tag: '',
  stage: 'idle',
  current_version: '1.2.0C',
  error: '',
  action_id: '',
  checked_at: 0,
  bytes: 0,
  size: 1100000,
};
test('optional update state is bounded and release links are derived from validated tags', () => {
  const state = normalizeUpdate({ ...valid, release_url: 'javascript:alert(1)' });
  assert.equal(
    state.release_url,
    'https://github.com/Shrug-Lord/growhub-ce-firmware/releases/tag/v1.3.0C',
  );
  for (const bad of [
    { ...valid, tag: 'v1.3.0C-beta' },
    { ...valid, size: -1 },
    { ...valid, checks_enabled: 'true' },
    { ...valid, stage: 'fake' },
  ])
    assert.throws(() => normalizeUpdate(bad));
  const parsed = parseFirmwareMessage(
    'growhub/AABBCCDDEEFF/update/state',
    Buffer.from(JSON.stringify(valid)),
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.kind, 'update');
});
test('firmware install requires an exact available version and explicit confirmation', () => {
  assert.throws(() => prepareUpdateAction({ op: 'install', tag: valid.tag }, valid), /Confirm/);
  assert.throws(
    () => prepareUpdateAction({ op: 'install', tag: 'v1.4.0C', confirmed: true }, valid),
    /Release changed/,
  );
  assert.throws(
    () => prepareUpdateAction({ op: 'check' }, { ...valid, stage: 'downloading' }),
    /busy/,
  );
  const a = prepareUpdateAction({ op: 'install', tag: valid.tag, confirmed: true }, valid);
  assert.equal(a.confirmed, true);
  assert.equal(a.v, 1);
  assert.ok(a.id);
});
test('update state upserts without modifying journal data', () => {
  const db = openDatabase(':memory:');
  try {
    db.stmts.ensureDevice.run({ id: 'AABBCCDDEEFF', observed_at: 1 });
    const before = db.db.prepare('SELECT * FROM grow_events').all();
    db.stmts.recordUpdateState.run('AABBCCDDEEFF', JSON.stringify(valid), 1);
    db.stmts.recordUpdateState.run(
      'AABBCCDDEEFF',
      JSON.stringify({ ...valid, checks_enabled: true }),
      2,
    );
    assert.equal(
      JSON.parse(db.stmts.getUpdateState.get('AABBCCDDEEFF').state_json).checks_enabled,
      true,
    );
    assert.deepEqual(db.db.prepare('SELECT * FROM grow_events').all(), before);
  } finally {
    db.close();
  }
});
