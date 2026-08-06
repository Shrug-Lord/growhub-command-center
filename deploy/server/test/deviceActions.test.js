'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { openDatabase } = require('../src/db');
const {
  DeviceActionError,
  createDeviceActionEngine,
  outletFingerprint,
  sameSchedule,
} = require('../src/deviceActions');
const { MAC, outletsPayload, schedulePayload } = require('../test-support/firmwareFixtures');

function loggerStub() {
  return Object.fromEntries(['debug', 'info', 'warn', 'error'].map((level) => [level, () => {}]));
}

function seedState(database, key, value, revision = 1) {
  const now = 1_000;
  database.stmts.ensureDevice.run({ id: MAC, observed_at: now });
  database.db
    .prepare(
      `
    INSERT INTO device_state_mirrors (
      device_id, state_key, schema_version, normalized_json, raw_json,
      received_at, revision, mqtt_retained, compatible, compatibility_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, NULL)
    ON CONFLICT(device_id, state_key) DO UPDATE SET
      normalized_json = excluded.normalized_json,
      raw_json = excluded.raw_json,
      received_at = excluded.received_at,
      revision = excluded.revision,
      compatible = 1,
      compatibility_reason = NULL
  `,
    )
    .run(
      MAC,
      key,
      key === 'outlet_state' ? 1 : key === 'schedule_state' ? 3 : null,
      JSON.stringify(value),
      JSON.stringify(value),
      now,
      revision,
    );
}

function createHarness(t, { callbackError = null } = {}) {
  let now = 10_000;
  const database = openDatabase(':memory:', { clock: () => now });
  const published = [];
  const mqttService = {
    isConnected: () => true,
    getHealth: () => ({ broker: { subscriptionsReady: true } }),
    publishAction(topic, payload, callback) {
      published.push({ topic, payload });
      callback(callbackError);
    },
  };
  const engine = createDeviceActionEngine({
    database,
    mqttService,
    logger: loggerStub(),
    clock: () => now,
  });
  t.after(() => {
    engine.close();
    database.close();
  });
  seedState(database, 'presence_state', { status: 'online' });
  seedState(database, 'outlet_state', {
    v: 1,
    source: 'reconnect',
    outlets: outletsPayload().outlets,
  });
  seedState(database, 'schedule_state', schedulePayload());
  return {
    database,
    engine,
    published,
    now: () => now,
    advance(milliseconds) {
      now += milliseconds;
    },
  };
}

test('PUBACK leaves an action pending until a newer authoritative state confirms it', async (t) => {
  const { database, engine, published } = createHarness(t);
  const pending = await engine.submit({
    deviceId: MAC,
    type: 'switch_to_manual',
    input: {},
    requestId: 'request-1',
  });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.publish_state, 'acknowledged');
  assert.equal(published[0].topic, `growhub/${MAC}/control/mode`);
  assert.equal(published[0].payload, '2');
  assert.equal(pending.timeout_at - pending.submitted_at, 15_000);

  engine.observeState({
    deviceId: MAC,
    stateKey: 'schedule_state',
    revision: 1,
    value: schedulePayload({ mode: 'manual' }),
  });
  assert.equal(engine.get(MAC, pending.id).status, 'pending');

  engine.observeState({
    deviceId: MAC,
    stateKey: 'schedule_state',
    revision: 2,
    value: schedulePayload({ mode: 'manual' }),
  });
  assert.equal(engine.get(MAC, pending.id).status, 'completed');

  seedState(database, 'schedule_state', schedulePayload({ mode: 'manual' }), 2);
  const noOp = await engine.submit({ deviceId: MAC, type: 'switch_to_manual', input: {} });
  assert.equal(noOp.status, 'completed');
  assert.equal(noOp.reason_code, 'already_in_requested_state');
  assert.equal(published.length, 1);
});

test('schedule equality models firmware float32 band storage', () => {
  const intended = {
    v: 3,
    outlets: [
      {
        id: 2,
        conditions: [
          { type: 'temp_high_band_c', low_c: 25.56, high_c: 29.44 },
          { type: 'rh_high_band', low: 65, high: 75 },
        ],
      },
    ],
  };
  const firmware = {
    v: 3,
    outlets: [
      {
        id: 2,
        conditions: [
          { high: Math.fround(75), low: Math.fround(65), type: 'rh_high_band' },
          {
            high_c: Math.fround(29.44),
            low_c: Math.fround(25.56),
            type: 'temp_high_band_c',
          },
        ],
      },
    ],
  };

  assert.equal(sameSchedule(intended, firmware), true);
});

test('the deadline rechecks the persisted mirror before timing out', async (t) => {
  const { database, engine, advance } = createHarness(t);
  const pending = await engine.submit({ deviceId: MAC, type: 'switch_to_manual', input: {} });
  seedState(database, 'schedule_state', schedulePayload({ mode: 'manual' }), 2);

  advance(15_001);
  engine.expireDue();

  assert.equal(engine.get(MAC, pending.id).status, 'completed');
});

test('manual outlet mask uses Outlet 1 bit 3 and confirms only the complete intended mask', async (t) => {
  const { database, engine, published } = createHarness(t);
  seedState(database, 'schedule_state', schedulePayload({ mode: 'manual' }), 1);
  const pending = await engine.submit({
    deviceId: MAC,
    type: 'set_manual_outlet_state',
    input: { outlet_id: 1, target_state: 'on' },
  });
  assert.equal(published[0].payload, '8');

  engine.observeState({
    deviceId: MAC,
    stateKey: 'schedule_state',
    revision: 2,
    value: schedulePayload({
      mode: 'manual',
      outlet_status: [
        { id: 1, state: 'on', summary: '' },
        { id: 2, state: 'on', summary: '' },
        { id: 3, state: 'off', summary: '' },
        { id: 4, state: 'off', summary: '' },
      ],
    }),
  });
  assert.equal(engine.get(MAC, pending.id).status, 'pending');

  engine.observeState({
    deviceId: MAC,
    stateKey: 'schedule_state',
    revision: 3,
    value: schedulePayload({
      mode: 'manual',
      outlet_status: [1, 2, 3, 4].map((id) => ({
        id,
        state: id === 1 ? 'on' : 'off',
        summary: '',
      })),
    }),
  });
  assert.equal(engine.get(MAC, pending.id).status, 'completed');
});

test('newer matching firmware errors reject while timeouts and terminal results stay immutable', async (t) => {
  const { database, engine, advance } = createHarness(t);
  seedState(database, 'schedule_state', schedulePayload({ time_valid: false }), 1);
  const rejected = await engine.submit({ deviceId: MAC, type: 'sync_time', input: {} });
  engine.observeError({
    deviceId: MAC,
    errorKey: 'time_error',
    sequence: 1,
    value: { command: 'time/action', reason: 'invalid_epoch', recognized_reason: true },
  });
  assert.equal(engine.get(MAC, rejected.id).status, 'rejected');
  assert.equal(engine.get(MAC, rejected.id).reason_code, 'firmware_invalid_epoch');

  const pending = await engine.submit({
    deviceId: MAC,
    type: 'switch_to_manual',
    input: {},
  });
  advance(15_001);
  engine.expireDue();
  assert.equal(engine.get(MAC, pending.id).status, 'timed_out');
  engine.observeState({
    deviceId: MAC,
    stateKey: 'schedule_state',
    revision: 2,
    value: schedulePayload({ mode: 'manual' }),
  });
  assert.equal(engine.get(MAC, pending.id).status, 'timed_out');
});

test('firmware errors reject only pending actions in the matching command family', async (t) => {
  const { database, engine } = createHarness(t);
  seedState(database, 'schedule_state', schedulePayload({ time_valid: false }), 1);
  const pending = await engine.submit({ deviceId: MAC, type: 'sync_time', input: {} });

  engine.observeError({
    deviceId: MAC,
    errorKey: 'schedule_error',
    sequence: 1,
    value: { reason: 'invalid_payload', recognized_reason: true },
  });
  assert.equal(engine.get(MAC, pending.id).status, 'pending');

  engine.observeError({
    deviceId: MAC,
    errorKey: 'time_error',
    sequence: 1,
    value: { command: 'time/action', reason: 'invalid_epoch', recognized_reason: true },
  });
  assert.equal(engine.get(MAC, pending.id).status, 'rejected');
  assert.equal(engine.get(MAC, pending.id).reason_code, 'firmware_invalid_epoch');
});

test('conflicts persist blocked attempts and emergency all-off interrupts superseded actions', async (t) => {
  const { engine, published } = createHarness(t);
  const pump = await engine.submit({
    deviceId: MAC,
    type: 'run_water_pump_now',
    input: { outlet_id: 4 },
  });
  await assert.rejects(
    engine.submit({ deviceId: MAC, type: 'switch_to_manual', input: {} }),
    (error) =>
      error instanceof DeviceActionError &&
      error.status === 409 &&
      error.details.blocked_action.status === 'blocked' &&
      error.details.blocking_action.id === pump.id,
  );

  const emergency = await engine.submit({
    deviceId: MAC,
    type: 'emergency_all_off',
    input: {},
  });
  assert.equal(emergency.status, 'pending');
  assert.equal(engine.get(MAC, pump.id).status, 'interrupted');
  assert.equal(engine.get(MAC, pump.id).reason_code, 'superseded_by_emergency');
  assert.equal(published.at(-1).payload, '7');
});

test('outlet writes are full replacements guarded by the retained outlet fingerprint', async (t) => {
  const { database, engine, published } = createHarness(t);
  const current = outletsPayload().outlets.sort((a, b) => a.id - b.id);
  const intended = current.map((outlet) =>
    outlet.id === 2 ? { ...outlet, label: 'Vent Fan' } : outlet,
  );
  await assert.rejects(
    engine.submit({
      deviceId: MAC,
      type: 'update_outlet_config',
      input: { outlets: intended, base_fingerprint: '0'.repeat(64) },
    }),
    (error) =>
      error instanceof DeviceActionError &&
      error.details.blocked_action.reason_code === 'device_state_changed',
  );

  const pending = await engine.submit({
    deviceId: MAC,
    type: 'update_outlet_config',
    input: { outlets: intended, base_fingerprint: outletFingerprint(current) },
  });
  assert.equal(JSON.parse(published.at(-1).payload).outlets.length, 4);
  engine.observeState({
    deviceId: MAC,
    stateKey: 'outlet_state',
    revision: 2,
    value: { v: 1, source: 'mqtt', outlets: intended },
  });
  assert.equal(engine.get(MAC, pending.id).status, 'completed');
  assert.equal(
    JSON.parse(
      database.db
        .prepare('SELECT confirmation_json FROM device_actions WHERE id = ?')
        .get(pending.id).confirmation_json,
    ).assignment_changed,
    false,
  );
});

test('restart recovery interrupts prepared actions and never republishes submitted actions', async (t) => {
  const { database, engine, published } = createHarness(t);
  const pending = await engine.submit({
    deviceId: MAC,
    type: 'switch_to_manual',
    input: {},
  });
  engine.close();

  database.db
    .prepare(
      `
    INSERT INTO device_actions (
      id, device_id, type, status, reason_code, context_json, input_json,
      confirmation_json, required_state_keys_json, base_state_revisions_json,
      base_error_sequences_json, request_id, publish_topic, publish_state,
      submitted_at, acknowledged_at, timeout_at, completed_at, created_at, updated_at
    ) VALUES (?, ?, 'sync_time', 'pending', NULL, '{}', '{}',
      '{"kind":"time_valid"}', '["schedule_state"]', '{"schedule_state":1}',
      '{"time_error":0}', NULL, ?, 'prepared', NULL, NULL, NULL, NULL, 10001, 10001)
  `,
    )
    .run('00000000-0000-4000-8000-000000000001', MAC, `growhub/${MAC}/time/action`);

  const recovered = createDeviceActionEngine({
    database,
    mqttService: {
      isConnected: () => true,
      getHealth: () => ({ broker: { subscriptionsReady: true } }),
      publishAction() {
        throw new Error('must not republish');
      },
    },
    logger: loggerStub(),
    clock: () => 10_002,
  });
  t.after(() => recovered.close());
  recovered.recover();
  assert.equal(published.length, 1);
  assert.equal(recovered.get(MAC, pending.id).status, 'pending');
  assert.equal(
    recovered.get(MAC, '00000000-0000-4000-8000-000000000001').reason_code,
    'server_restarted_before_publish',
  );
});

test('action history uses stable opaque cursor pagination', async (t) => {
  const { database, engine, advance } = createHarness(t);
  seedState(database, 'schedule_state', schedulePayload({ mode: 'manual' }), 1);
  for (let index = 0; index < 4; index += 1) {
    await engine.submit({ deviceId: MAC, type: 'switch_to_manual', input: {} });
    advance(1);
  }
  const first = engine.list(MAC, { limit: 2 });
  const second = engine.list(MAC, { limit: 2, cursor: first.next_cursor });
  assert.equal(first.actions.length, 2);
  assert.equal(second.actions.length, 2);
  assert.equal(new Set([...first.actions, ...second.actions].map((action) => action.id)).size, 4);
});
