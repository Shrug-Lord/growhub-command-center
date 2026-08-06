'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { openDatabase } = require('../src/db');
const { createDeviceActionEngine, DeviceActionError } = require('../src/deviceActions');
const {
  createScheduleTemplateService,
  normalizeTemplateInput,
  scheduleFingerprint,
} = require('../src/scheduleTemplates');
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
  if (key === 'presence_state') {
    database.stmts.setMirroredDevicePresence.run({
      device_id: MAC,
      presence_status: value.status,
      presence_received_at: now,
      updated_at: now,
    });
  }
}

function flowerInput() {
  return {
    name: 'Flower',
    description: 'Main flower cycle',
    roles: [
      {
        assignment: 'Light',
        label: 'Canopy Light',
        conditions: [{ type: 'time_window', start: '06:00', end: '20:00' }],
      },
      {
        assignment: 'Water Pump',
        label: 'Reservoir Pump',
        conditions: [
          {
            type: 'interval',
            run_mins: 15,
            every_hrs: 4,
            window: { start: '08:00', end: '20:00' },
          },
        ],
      },
    ],
  };
}

function fahrenheitFanInput() {
  return {
    name: 'Veg',
    description: 'Fahrenheit-authored fan bands',
    roles: [
      {
        assignment: 'Fan',
        label: 'Exhaust Fan',
        conditions: [
          { type: 'temp_high_band_c', low_c: 25.56, high_c: 29.44 },
          { type: 'rh_high_band', low: 65, high: 75 },
        ],
      },
    ],
  };
}

function createHarness(t) {
  let now = 10_000;
  const database = openDatabase(':memory:', { clock: () => now });
  const published = [];
  const observers = new Set();
  const mqttService = {
    isConnected: () => true,
    getHealth: () => ({ broker: { subscriptionsReady: true } }),
    publishAction(topic, payload, callback) {
      published.push({ topic, payload });
      callback(null);
    },
    addObserver(observer) {
      observers.add(observer);
      return () => observers.delete(observer);
    },
  };
  const actionEngine = createDeviceActionEngine({
    database,
    mqttService,
    logger: loggerStub(),
    clock: () => now,
  });
  const service = createScheduleTemplateService({
    database,
    mqttService,
    actionEngine,
    logger: loggerStub(),
    clock: () => now,
  });
  t.after(() => {
    service.close();
    actionEngine.close();
    database.close();
  });
  seedState(database, 'presence_state', { status: 'online' });
  seedState(database, 'outlet_state', outletsPayload());
  seedState(database, 'schedule_state', schedulePayload());
  return {
    actionEngine,
    database,
    published,
    service,
    advance(milliseconds) {
      now += milliseconds;
    },
    now: () => now,
  };
}

async function prepareFahrenheitFanLoad({ actionEngine, service }) {
  const template = service.createTemplate(fahrenheitFanInput());
  const setup = service.deviceScheduleState(MAC).setup;
  await actionEngine.submit({
    deviceId: MAC,
    type: 'confirm_device_setup',
    input: { outlet_fingerprint: setup.outlet_fingerprint },
  });
  const preflight = service.preflight(MAC, template.id);
  const pending = await actionEngine.submit({
    deviceId: MAC,
    type: 'load_schedule',
    input: {
      template_id: template.id,
      mappings: preflight.mapping_object,
      acknowledged_warning_signature: preflight.warning_signature,
    },
  });
  return { pending, preflight };
}

test('template validation enforces CE v3 assignment condition rules and immutable revisions', (t) => {
  const { service } = createHarness(t);
  assert.throws(
    () =>
      normalizeTemplateInput({
        name: 'Invalid',
        roles: [
          {
            assignment: 'Light',
            label: 'Canopy',
            conditions: [{ type: 'rh_high_band', low: 50, high: 60 }],
          },
        ],
      }),
    (error) => error instanceof DeviceActionError && error.code === 'invalid_template',
  );

  const created = service.createTemplate(flowerInput());
  assert.equal(created.revision, 1);
  assert.equal(created.roles.length, 2);
  assert.ok(created.roles.every((role) => typeof role.id === 'string'));

  const updated = service.updateTemplate(created.id, {
    ...flowerInput(),
    name: 'Flower Plus',
    roles: created.roles.map((role) =>
      role.assignment === 'Light'
        ? { ...role, conditions: [{ type: 'time_window', start: '05:30', end: '21:30' }] }
        : role,
    ),
  });
  assert.equal(updated.revision, 2);
  assert.equal(service.listRevisions(created.id).length, 2);
  assert.equal(service.listRevisions(created.id)[1].name, 'Flower');
});

test('preflight requires setup review, infers physical roles, and requires warning acknowledgement', async (t) => {
  const { actionEngine, database, published, service } = createHarness(t);
  const template = service.createTemplate(flowerInput());
  const blocked = service.preflight(MAC, template.id);
  assert.equal(blocked.can_load, false);
  assert.ok(blocked.blockers.some((entry) => entry.code === 'device_setup_review_required'));

  const setup = service.deviceScheduleState(MAC).setup;
  const confirmed = await actionEngine.submit({
    deviceId: MAC,
    type: 'confirm_device_setup',
    input: { outlet_fingerprint: setup.outlet_fingerprint },
  });
  assert.equal(confirmed.status, 'completed');

  const preflight = service.preflight(MAC, template.id);
  assert.equal(preflight.can_load, true);
  assert.deepEqual(
    preflight.mappings.map((mapping) => mapping.outlet_id),
    [1, 4],
  );
  assert.ok(preflight.warnings.some((warning) => warning.code === 'extra_assigned_outlets'));
  await assert.rejects(
    actionEngine.submit({
      deviceId: MAC,
      type: 'load_schedule',
      input: { template_id: template.id, mappings: preflight.mapping_object },
    }),
    (error) =>
      error instanceof DeviceActionError &&
      error.details.blocked_action.reason_code === 'warnings_require_confirmation',
  );

  const pending = await actionEngine.submit({
    deviceId: MAC,
    type: 'load_schedule',
    input: {
      template_id: template.id,
      mappings: preflight.mapping_object,
      acknowledged_warning_signature: preflight.warning_signature,
    },
  });
  assert.equal(pending.status, 'pending');
  assert.equal(published.at(-1).topic, `growhub/${MAC}/grow`);
  assert.equal(
    database.db.prepare('SELECT COUNT(*) AS count FROM device_expected_schedules').get().count,
    0,
  );

  actionEngine.observeState({
    deviceId: MAC,
    stateKey: 'schedule_state',
    revision: 2,
    value: schedulePayload({ schedule: preflight.compiled_schedule }),
  });
  const expected = database.db
    .prepare('SELECT * FROM device_expected_schedules WHERE device_id = ?')
    .get(MAC);
  assert.equal(actionEngine.get(MAC, pending.id).status, 'completed');
  assert.equal(expected.template_revision, 1);
  assert.equal(expected.expected_fingerprint, scheduleFingerprint(preflight.compiled_schedule));
  assert.equal(
    database.db
      .prepare('SELECT COUNT(*) AS count FROM device_role_mappings WHERE device_id = ?')
      .get(MAC).count,
    2,
  );
});

test('an exact float32 schedule state late-confirms a timed-out load without republishing', async (t) => {
  const { actionEngine, database, published, service, advance } = createHarness(t);
  const { pending, preflight } = await prepareFahrenheitFanLoad({ actionEngine, service });
  const publishCount = published.length;

  advance(15_001);
  actionEngine.expireDue();
  assert.equal(actionEngine.get(MAC, pending.id).status, 'timed_out');
  assert.equal(
    database.db.prepare('SELECT COUNT(*) AS count FROM device_expected_schedules').get().count,
    0,
  );

  const firmwareSchedule = structuredClone(preflight.compiled_schedule);
  for (const condition of firmwareSchedule.outlets[0].conditions) {
    for (const key of ['low', 'high', 'low_c', 'high_c']) {
      if (typeof condition[key] === 'number') condition[key] = Math.fround(condition[key]);
    }
  }
  actionEngine.observeState({
    deviceId: MAC,
    stateKey: 'schedule_state',
    revision: 2,
    value: schedulePayload({ schedule: firmwareSchedule }),
  });

  const completed = actionEngine.get(MAC, pending.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.reason_code, 'confirmed_after_timeout');
  assert.equal(published.length, publishCount);
  assert.equal(
    database.db.prepare('SELECT COUNT(*) AS count FROM device_expected_schedules').get().count,
    1,
  );
});

test('late schedule reconciliation stops after its grace or a superseding emergency', async (t) => {
  const first = createHarness(t);
  const firstLoad = await prepareFahrenheitFanLoad(first);
  first.advance(75_001);
  first.actionEngine.expireDue();
  first.actionEngine.observeState({
    deviceId: MAC,
    stateKey: 'schedule_state',
    revision: 2,
    value: schedulePayload({ schedule: firstLoad.preflight.compiled_schedule }),
  });
  assert.equal(first.actionEngine.get(MAC, firstLoad.pending.id).status, 'timed_out');

  // A separate device-action engine would normally own the second scenario;
  // use a nested test context so its in-memory database and timers are isolated.
  await t.test('superseding emergency', async (nested) => {
    const second = createHarness(nested);
    const secondLoad = await prepareFahrenheitFanLoad(second);
    second.advance(15_001);
    second.actionEngine.expireDue();
    second.advance(1);
    await second.actionEngine.submit({ deviceId: MAC, type: 'emergency_all_off', input: {} });
    second.actionEngine.observeState({
      deviceId: MAC,
      stateKey: 'schedule_state',
      revision: 2,
      value: schedulePayload({ schedule: secondLoad.preflight.compiled_schedule }),
    });
    assert.equal(second.actionEngine.get(MAC, secondLoad.pending.id).status, 'timed_out');
  });
});

test('firmware-owned schedule changes create one drift episode and equality reconciles it', async (t) => {
  const { actionEngine, database, service } = createHarness(t);
  const template = service.createTemplate(flowerInput());
  const setup = service.deviceScheduleState(MAC).setup;
  await actionEngine.submit({
    deviceId: MAC,
    type: 'confirm_device_setup',
    input: { outlet_fingerprint: setup.outlet_fingerprint },
  });
  const preflight = service.preflight(MAC, template.id);
  const pending = await actionEngine.submit({
    deviceId: MAC,
    type: 'load_schedule',
    input: {
      template_id: template.id,
      mappings: preflight.mapping_object,
      acknowledged_warning_signature: preflight.warning_signature,
    },
  });
  actionEngine.observeState({
    deviceId: MAC,
    stateKey: 'schedule_state',
    revision: 2,
    value: schedulePayload({ schedule: preflight.compiled_schedule }),
  });
  assert.equal(actionEngine.get(MAC, pending.id).status, 'completed');

  const changed = schedulePayload({
    source: 'local',
    schedule: {
      v: 3,
      outlets: [{ id: 1, conditions: [{ type: 'time_window', start: '07:00', end: '21:00' }] }],
    },
  });
  seedState(database, 'schedule_state', changed, 3);
  service.observeState({ deviceId: MAC, stateKey: 'schedule_state', revision: 3, value: changed });
  service.observeState({ deviceId: MAC, stateKey: 'schedule_state', revision: 4, value: changed });
  assert.equal(
    database.db
      .prepare('SELECT COUNT(*) AS count FROM schedule_drift_episodes WHERE device_id = ?')
      .get(MAC).count,
    1,
  );
  assert.equal(
    database.db
      .prepare("SELECT COUNT(*) AS count FROM device_events WHERE type = 'schedule_drift_detected'")
      .get().count,
    1,
  );
  assert.equal(service.deviceScheduleState(MAC).drift.reason, 'schedule_body_changed');
  assert.ok(service.driftDetails(MAC).diff.changes.length > 0);

  const aligned = schedulePayload({ schedule: preflight.compiled_schedule });
  seedState(database, 'schedule_state', aligned, 5);
  service.observeState({ deviceId: MAC, stateKey: 'schedule_state', revision: 5, value: aligned });
  assert.equal(service.deviceScheduleState(MAC).drift, null);
  assert.equal(
    database.db
      .prepare(
        "SELECT COUNT(*) AS count FROM device_events WHERE type = 'schedule_drift_reconciled'",
      )
      .get().count,
    1,
  );
});

test('duplicate assigned labels block setup confirmation with deterministic suggestions', async (t) => {
  const { actionEngine, database, service } = createHarness(t);
  const duplicate = outletsPayload({
    outlets: outletsPayload().outlets.map((outlet) =>
      outlet.assignment === 'Fan' ? { ...outlet, label: 'Fan' } : outlet,
    ),
  });
  seedState(database, 'outlet_state', duplicate, 2);
  const setup = service.deviceScheduleState(MAC).setup;
  assert.equal(setup.can_confirm, false);
  assert.deepEqual(setup.label_conflicts[0].suggestions, [
    { id: 2, label: 'Fan 1' },
    { id: 3, label: 'Fan 2' },
  ]);
  await assert.rejects(
    actionEngine.submit({
      deviceId: MAC,
      type: 'confirm_device_setup',
      input: { outlet_fingerprint: setup.outlet_fingerprint },
    }),
    (error) =>
      error instanceof DeviceActionError &&
      error.details.blocked_action.reason_code === 'outlet_label_conflict',
  );
});

test('Save as new template locks mirror fingerprints and atomically adopts firmware drift', async (t) => {
  const { actionEngine, database, service } = createHarness(t);
  const template = service.createTemplate(flowerInput());
  const setup = service.deviceScheduleState(MAC).setup;
  await actionEngine.submit({
    deviceId: MAC,
    type: 'confirm_device_setup',
    input: { outlet_fingerprint: setup.outlet_fingerprint },
  });
  const preflight = service.preflight(MAC, template.id);
  const load = await actionEngine.submit({
    deviceId: MAC,
    type: 'load_schedule',
    input: {
      template_id: template.id,
      mappings: preflight.mapping_object,
      acknowledged_warning_signature: preflight.warning_signature,
    },
  });
  actionEngine.observeState({
    deviceId: MAC,
    stateKey: 'schedule_state',
    revision: 2,
    value: schedulePayload({ schedule: preflight.compiled_schedule }),
  });
  assert.equal(actionEngine.get(MAC, load.id).status, 'completed');

  const changed = schedulePayload({
    source: 'local',
    schedule: {
      v: 3,
      outlets: [{ id: 1, conditions: [{ type: 'time_window', start: '09:00', end: '19:00' }] }],
    },
  });
  seedState(database, 'schedule_state', changed, 3);
  service.observeState({ deviceId: MAC, stateKey: 'schedule_state', revision: 3, value: changed });
  const drift = service.deviceScheduleState(MAC).drift;
  const beforeCount = service.listTemplates().length;

  await assert.rejects(
    actionEngine.submit({
      deviceId: MAC,
      type: 'save_as_new_template',
      input: {
        name: 'Firmware Flower',
        description: '',
        schedule_fingerprint: '0'.repeat(64),
        outlet_fingerprint: service.deviceScheduleState(MAC).setup.outlet_fingerprint,
        drift_episode_id: drift.id,
      },
    }),
    (error) =>
      error instanceof DeviceActionError &&
      error.details.blocked_action.reason_code === 'device_state_changed',
  );
  assert.equal(service.listTemplates().length, beforeCount);

  const adopted = await actionEngine.submit({
    deviceId: MAC,
    type: 'save_as_new_template',
    input: {
      name: 'Firmware Flower',
      description: 'Saved from a local firmware edit',
      schedule_fingerprint: scheduleFingerprint(changed.schedule),
      outlet_fingerprint: service.deviceScheduleState(MAC).setup.outlet_fingerprint,
      drift_episode_id: drift.id,
    },
  });
  assert.equal(adopted.status, 'completed');
  assert.equal(service.listTemplates().length, beforeCount + 1);
  assert.equal(service.deviceScheduleState(MAC).drift, null);
  assert.equal(service.deviceScheduleState(MAC).expected_schedule.template_name, 'Firmware Flower');
});
