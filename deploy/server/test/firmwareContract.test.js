'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseFirmwareMessage } = require('../src/firmwareContract');
const { MAC, outletsPayload, schedulePayload } = require('../test-support/firmwareFixtures');

test('topic identity is closed and presence accepts only exact CE values', () => {
  assert.equal(parseFirmwareMessage(`growhub/${MAC}/status`, 'online').ok, true);
  assert.equal(parseFirmwareMessage(`growhub/${MAC}/status`, 'offline').ok, true);
  assert.deepEqual(parseFirmwareMessage(`growhub/${MAC.toLowerCase()}/status`, 'online'), {
    ok: false,
    reason: 'invalid_topic',
  });
  assert.equal(parseFirmwareMessage(`growhub/${MAC}/status/extra`, 'online').ok, false);
  assert.equal(parseFirmwareMessage(`growhub/${MAC}/status`, 'ONLINE').ok, false);
});

test('sensor payload must match topic identity and cannot discover independently', () => {
  const payload = {
    nId: MAC,
    name: 'GrowHub_B2C3',
    fw: '1.1.0C',
    data: [{ l: 75, h: 58.2, t: 24.1, a: '01000000', ts: '2026-05-31 12:00:00:000Z' }],
  };
  const parsed = parseFirmwareMessage(`growhub/${MAC}/sensor/live`, JSON.stringify(payload));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.discoveryCapable, false);
  assert.equal(parsed.normalized.temperature_c, 24.1);
  assert.equal(parsed.normalized.actuator_summary, '01000000');

  payload.data[0].l = 255;
  const maximumLight = parseFirmwareMessage(`growhub/${MAC}/sensor/live`, JSON.stringify(payload));
  assert.equal(maximumLight.ok, true);
  assert.equal(maximumLight.normalized.light_level, 255);

  payload.data[0].l = 256;
  assert.equal(
    parseFirmwareMessage(`growhub/${MAC}/sensor/live`, JSON.stringify(payload)).ok,
    false,
  );
  payload.data[0].l = 1.5;
  assert.equal(
    parseFirmwareMessage(`growhub/${MAC}/sensor/live`, JSON.stringify(payload)).ok,
    false,
  );
  payload.data[0].l = 75;

  payload.nId = '112233445566';
  assert.deepEqual(parseFirmwareMessage(`growhub/${MAC}/sensor/live`, JSON.stringify(payload)), {
    ok: false,
    reason: 'sensor_identity_mismatch',
  });
});

test('outlet state validates the full physical assignment contract and sorts by id', () => {
  const parsed = parseFirmwareMessage(
    `growhub/${MAC}/outlets/state`,
    JSON.stringify(outletsPayload()),
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.discoveryCapable, true);
  assert.deepEqual(
    parsed.normalized.outlets.map((outlet) => outlet.id),
    [1, 2, 3, 4],
  );

  const duplicate = outletsPayload();
  duplicate.outlets[3].id = 2;
  assert.equal(
    parseFirmwareMessage(`growhub/${MAC}/outlets/state`, JSON.stringify(duplicate)).ok,
    false,
  );

  const unsupported = parseFirmwareMessage(
    `growhub/${MAC}/outlets/state`,
    JSON.stringify({ v: 2, source: 'reconnect', outlets: [] }),
  );
  assert.equal(unsupported.ok, true);
  assert.equal(unsupported.compatible, false);
  assert.equal(unsupported.compatibilityReason, 'unsupported_outlet_state_version');
});

test('schedule state normalizes CE v3 mode, outputs, warnings, and conditions', () => {
  const payload = schedulePayload({
    warnings: [
      {
        code: 'time_sntp_unhealthy',
        message: 'SNTP has not synchronized',
        severity: 'warning',
      },
    ],
  });
  const parsed = parseFirmwareMessage(`growhub/${MAC}/schedule/state`, JSON.stringify(payload));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.compatible, true);
  assert.equal(parsed.normalized.mode, 'auto');
  assert.equal(parsed.normalized.schedule.v, 3);
  assert.equal(parsed.normalized.outlet_status.length, 4);
  assert.equal(parsed.normalized.warnings[0].code, 'time_sntp_unhealthy');

  const scheduleEngineUpdate = parseFirmwareMessage(
    `growhub/${MAC}/schedule/state`,
    JSON.stringify(schedulePayload({ source: 'schedule' })),
  );
  assert.equal(scheduleEngineUpdate.ok, true);
  assert.equal(scheduleEngineUpdate.compatible, true);

  const incomplete = parseFirmwareMessage(
    `growhub/${MAC}/schedule/state`,
    JSON.stringify({ active: false, schedule: null }),
  );
  assert.equal(incomplete.ok, true);
  assert.equal(incomplete.compatible, false);
  assert.equal(incomplete.compatibilityReason, 'incomplete_schedule_state_contract');

  const invalid = schedulePayload();
  invalid.schedule.outlets[0].conditions[0].end = '06:00';
  assert.equal(
    parseFirmwareMessage(`growhub/${MAC}/schedule/state`, JSON.stringify(invalid)).ok,
    false,
  );
});

test('future firmware error reasons remain diagnosable without becoming recognized', () => {
  const parsed = parseFirmwareMessage(
    `growhub/${MAC}/control/error`,
    JSON.stringify({ command: 'control/relay', reason: 'future_reason' }),
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.kind, 'error');
  assert.equal(parsed.discoveryCapable, false);
  assert.equal(parsed.normalized.reason, 'future_reason');
  assert.equal(parsed.normalized.recognized_reason, false);
});

test('payload limits and UTF-8 validation reject input before JSON parsing', () => {
  assert.deepEqual(parseFirmwareMessage(`growhub/${MAC}/status`, Buffer.from([0xff])), {
    ok: false,
    reason: 'invalid_utf8',
  });
  assert.deepEqual(parseFirmwareMessage(`growhub/${MAC}/status`, 'x'.repeat(17)), {
    ok: false,
    reason: 'payload_too_large',
  });
});
