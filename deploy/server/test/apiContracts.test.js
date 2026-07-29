'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');
const { createDeviceActionEngine } = require('../src/deviceActions');
const { parseFirmwareMessage } = require('../src/firmwareContract');
const { createApp } = require('../src/index');
const { createRuntimeState } = require('../src/runtimeState');
const { createScheduleTemplateService } = require('../src/scheduleTemplates');
const { outletsPayload, schedulePayload } = require('../test-support/firmwareFixtures');

const DEVICE_ID = 'AABBCCDDEEFF';
const OUTLETS = [
  { id: 1, label: 'Canopy Light', type: 'Light' },
  { id: 2, label: 'Exhaust Fan', type: 'Fan' },
  { id: 3, label: 'Outlet 3', type: 'None' },
  { id: 4, label: 'Outlet 4', type: 'None' },
];

function loggerStub() {
  return { debug() {}, error() {}, info() {}, warn() {} };
}

function seed(database, now) {
  database.db
    .prepare(
      `
    INSERT INTO devices (
      id, reported_name, firmware_version, last_seen_at,
      outlet_state_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(DEVICE_ID, 'Bench', '1.1.0C', now, JSON.stringify(OUTLETS), now, now);
  database.stmts.insertMeasurement.run({
    device_id: DEVICE_ID,
    taken_at: now,
    temp: 24,
    humidity: 55,
    light: 200,
    co2: 900,
    actuator: '0',
    fw: '1.1.0C',
  });
  const mirrorMessages = [
    parseFirmwareMessage(`growhub/${DEVICE_ID}/status`, 'online'),
    parseFirmwareMessage(`growhub/${DEVICE_ID}/outlets/state`, JSON.stringify(outletsPayload())),
    parseFirmwareMessage(`growhub/${DEVICE_ID}/schedule/state`, JSON.stringify(schedulePayload())),
    parseFirmwareMessage(
      `growhub/${DEVICE_ID}/sensor/live`,
      JSON.stringify({
        nId: DEVICE_ID,
        name: 'Bench',
        fw: '1.1.0C',
        data: [{ l: 70, h: 55, t: 24, a: '00000000', ts: '2026-07-13 12:00:00:000Z' }],
      }),
    ),
  ];
  for (const message of mirrorMessages) {
    database.stmts.upsertDeviceStateMirror.get({
      device_id: DEVICE_ID,
      state_key: message.key,
      schema_version: message.schemaVersion,
      normalized_json: JSON.stringify(message.normalized),
      raw_json: message.raw,
      received_at: now,
      mqtt_retained: message.key === 'sensor_state' ? 0 : 1,
      compatible: message.compatible ? 1 : 0,
      compatibility_reason: message.compatibilityReason,
    });
  }
  database.stmts.insertAlarm.run({
    device_id: DEVICE_ID,
    type: 'temperature_high',
    message: 'Temperature is high',
    severity: 'warning',
    created_at: now,
  });
  const schedule = database.stmts.createSchedule.run({
    name: 'Flower',
    description: 'Flower schedule',
    settings: '{}',
  });
  database.stmts.insertEvent.run({
    device_id: DEVICE_ID,
    schedule_id: schedule.lastInsertRowid,
    type: 'observation',
    phase: null,
    label: 'Bench note',
    notes: null,
    occurred_at: now,
    created_at: now,
  });
  return Number(schedule.lastInsertRowid);
}

async function withFixture(callback) {
  const now = Date.parse('2026-07-13T12:00:00.000Z');
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'growhub-api-contract-'));
  const database = openDatabase(':memory:', { clock: () => now });
  const scheduleId = seed(database, now);
  const runtimeState = createRuntimeState({ clock: () => now });
  runtimeState.markReady();
  const published = [];
  const mqttService = {
    publishAction(topic, payload, callback) {
      published.push({ topic, payload });
      callback(null);
    },
    isConnected: () => true,
    getHealth() {
      return {
        broker: {
          status: 'connected',
          subscriptionsReady: true,
          lastConnectedAt: now,
          lastDisconnectedAt: null,
          lastError: null,
        },
        retainedStateRebuild: {
          generation: 1,
          startedAt: now,
          deviceCount: 1,
          syncingDeviceCount: 0,
          missingStateCount: 0,
        },
      };
    },
  };
  const actionEngine = createDeviceActionEngine({
    database,
    mqttService,
    logger: loggerStub(),
    clock: () => now,
  });
  const scheduleService = createScheduleTemplateService({
    database,
    mqttService,
    actionEngine,
    logger: loggerStub(),
    clock: () => now,
  });
  const app = createApp({
    config: loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', APP_DATA_DIR: appDataDir }),
    runtimeState,
    database,
    mqttService,
    actionEngine,
    scheduleService,
    logger: loggerStub(),
    clock: () => now,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const setupResponse = await fetch(`${baseUrl}/api/v1/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'correct horse battery staple',
        password_confirmation: 'correct horse battery staple',
      }),
    });
    assert.equal(setupResponse.status, 201);
    const loginResponse = await fetch(`${baseUrl}/api/v1/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'correct horse battery staple' }),
    });
    const login = await loginResponse.json();
    assert.equal(loginResponse.status, 201);
    const session = {
      cookie: loginResponse.headers.get('set-cookie').split(';')[0],
      csrf: login.session.csrf_token,
    };
    const request = (requestPath, options = {}) =>
      jsonRequest(baseUrl, requestPath, { ...options, session });
    await callback({
      actionEngine,
      baseUrl,
      database,
      login,
      published,
      request,
      scheduleId,
      scheduleService,
      session,
    });
  } finally {
    scheduleService.close();
    actionEngine.close();
    await new Promise((resolve, reject) =>
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      }),
    );
    database.close();
    fs.rmSync(appDataDir, { recursive: true, force: true });
  }
}

async function jsonRequest(baseUrl, path, options = {}) {
  const { session, allowError = false, ...fetchOptions } = options;
  const method = fetchOptions.method || 'GET';
  const headers = {
    ...(fetchOptions.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(session ? { Cookie: session.cookie } : {}),
    ...(session && method !== 'GET' && method !== 'HEAD' ? { 'X-CSRF-Token': session.csrf } : {}),
    ...fetchOptions.headers,
  };
  const response = await fetch(`${baseUrl}${path}`, { ...fetchOptions, headers });
  const body = await response.json();
  if (!allowError) {
    assert.ok(
      response.ok,
      `${method} ${path} returned ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return { body, response };
}

function assertOnlyResource(body, name) {
  assert.deepEqual(Object.keys(body), [name]);
  assert.notEqual(body[name], undefined);
}

test('read APIs return direct named resources', async () => {
  await withFixture(async ({ login, request }) => {
    assertOnlyResource(login, 'session');
    assert.equal(login.session.user.username, 'admin');
    assert.equal(login.session.csrf_token.length, 43);
    assert.equal(login.session.user.devices[0].id, DEVICE_ID);
    assert.equal(login.session.user.devices[0].presence.status, 'online');
    assert.equal(login.session.user.devices[0].mirror.ready, true);

    const cases = [
      ['/api/v1/session', 'session'],
      ['/api/v1/data-logs/rangev3?deviceId=AABBCCDDEEFF', 'series'],
      [`/api/v1/data-logs/device/${DEVICE_ID}/request-csv`, 'export'],
      [`/api/v1/iot-devices/${DEVICE_ID}`, 'device'],
      ['/api/v1/devices', 'devices'],
      [`/api/v1/devices/${DEVICE_ID}`, 'device'],
      [`/api/v1/devices/${DEVICE_ID}/outlets`, 'outlets'],
      ['/api/v1/server/health', 'server_health'],
      ['/api/v1/diagnostics', 'diagnostics'],
      [`/api/v1/diagnostics/devices/${DEVICE_ID}`, 'diagnostics'],
      ['/api/v1/diagnostics/export', 'diagnostics'],
      ['/api/v1/alarms/user/local-user-1', 'alerts'],
      ['/api/v1/schedule-templates', 'templates'],
      [`/api/v1/events?deviceId=${DEVICE_ID}`, 'events'],
      [`/api/v1/events/phase/current?deviceId=${DEVICE_ID}`, 'current_phase'],
      ['/api/v1/settings', 'settings'],
    ];

    for (const [path, resource] of cases) {
      const { body } = await request(path);
      assertOnlyResource(body, resource);
    }

    const activity = await request(`/api/v1/devices/${DEVICE_ID}/activity`);
    assert.deepEqual(Object.keys(activity.body), ['activity', 'next_cursor']);
    assert.equal(activity.response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(activity.response.headers.get('x-frame-options'), 'DENY');
    assert.match(
      activity.response.headers.get('content-security-policy'),
      /frame-ancestors 'none'/,
    );

    const diagnostics = await request(`/api/v1/diagnostics/devices/${DEVICE_ID}`);
    assert.equal(diagnostics.body.diagnostics.device.id, DEVICE_ID);
    assert.ok(
      diagnostics.body.diagnostics.retained.some(
        (entry) =>
          entry.topic === `growhub/${DEVICE_ID}/schedule/state` &&
          entry.raw !== null &&
          entry.normalized !== null,
      ),
    );

    const exported = await request('/api/v1/diagnostics/export');
    assert.equal(exported.body.diagnostics.meta.export_redacted, true);
    assert.equal(exported.body.diagnostics.meta.contains_local_device_identifiers, true);
    assert.match(
      exported.response.headers.get('content-disposition'),
      /^attachment; filename="growhub-diagnostics-/,
    );
    const exportText = JSON.stringify(exported.body.diagnostics);
    assert.doesNotMatch(exportText, /correct horse battery staple/);
    assert.doesNotMatch(exportText, /csrf_token|session_id|password_verifier|client_ip/);
    assert.ok(
      exported.body.diagnostics.authSecurityEvents.every(
        (entry) => entry.admin_identity === null || entry.admin_identity === 'admin',
      ),
    );
  });
});

test('mutation APIs return the resource they changed without generic success wrappers', async () => {
  await withFixture(async ({ actionEngine, published, request }) => {
    const rename = await request(`/api/v1/iot-devices/${DEVICE_ID}/name`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'Flower Tent' }),
    });
    assertOnlyResource(rename.body, 'device');
    assert.equal(rename.body.device.name, 'Flower Tent');

    const command = await request(`/api/v1/devices/${DEVICE_ID}/actions`, {
      method: 'POST',
      body: JSON.stringify({ type: 'switch_to_manual', input: {} }),
    });
    assertOnlyResource(command.body, 'action');
    assert.equal(command.response.status, 202);
    assert.equal(command.body.action.type, 'switch_to_manual');
    assert.equal(command.body.action.status, 'pending');
    actionEngine.observeState({
      deviceId: DEVICE_ID,
      stateKey: 'schedule_state',
      revision: 2,
      value: schedulePayload({ mode: 'manual' }),
    });

    const alerts = await request('/api/v1/alarms/user/local-user-1', {
      method: 'PUT',
      body: JSON.stringify({}),
    });
    assertOnlyResource(alerts.body, 'alerts');

    const settings = await request('/api/v1/settings', {
      method: 'PUT',
      body: JSON.stringify({ retention_days: '30' }),
    });
    assertOnlyResource(settings.body, 'settings');
    assert.equal(settings.body.settings.retention_days, '30');

    const createdSchedule = await request('/api/v1/schedule-templates', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Seedling',
        description: '',
        roles: [
          {
            assignment: 'Light',
            label: 'Canopy Light',
            conditions: [{ type: 'time_window', start: '08:00', end: '20:00' }],
          },
        ],
      }),
    });
    assertOnlyResource(createdSchedule.body, 'template');
    const createdScheduleId = createdSchedule.body.template.id;

    const updatedSchedule = await request(`/api/v1/schedule-templates/${createdScheduleId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: 'Seedling Updated',
        description: '',
        roles: createdSchedule.body.template.roles,
      }),
    });
    assertOnlyResource(updatedSchedule.body, 'template');

    const setup = await request(`/api/v1/devices/${DEVICE_ID}/actions`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'confirm_device_setup',
        input: {
          outlet_fingerprint: (await request(`/api/v1/devices/${DEVICE_ID}`)).body.device.setup
            .outlet_fingerprint,
        },
      }),
    });
    assertOnlyResource(setup.body, 'action');

    const preflight = await request(`/api/v1/devices/${DEVICE_ID}/schedule-preflight`, {
      method: 'POST',
      body: JSON.stringify({ template_id: createdScheduleId }),
    });
    assertOnlyResource(preflight.body, 'preflight');

    const loaded = await request(`/api/v1/devices/${DEVICE_ID}/actions`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'load_schedule',
        input: {
          template_id: createdScheduleId,
          mappings: preflight.body.preflight.mapping_object,
          acknowledged_warning_signature: preflight.body.preflight.warning_signature,
        },
      }),
    });
    assertOnlyResource(loaded.body, 'action');
    assert.equal(loaded.response.status, 202);
    actionEngine.observeState({
      deviceId: DEVICE_ID,
      stateKey: 'schedule_state',
      revision: 3,
      value: schedulePayload({ schedule: preflight.body.preflight.compiled_schedule }),
    });

    const createdEvent = await request('/api/v1/events', {
      method: 'POST',
      body: JSON.stringify({ deviceId: DEVICE_ID, type: 'observation', label: 'New note' }),
    });
    assertOnlyResource(createdEvent.body, 'event');
    const eventId = createdEvent.body.event.id;

    const updatedEvent = await request(`/api/v1/events/${eventId}`, {
      method: 'PATCH',
      body: JSON.stringify({ label: 'Updated note' }),
    });
    assertOnlyResource(updatedEvent.body, 'event');

    const deletedEvent = await request(`/api/v1/events/${eventId}`, {
      method: 'DELETE',
    });
    assertOnlyResource(deletedEvent.body, 'event');

    const deletedSchedule = await request(`/api/v1/schedule-templates/${createdScheduleId}`, {
      method: 'DELETE',
    });
    assertOnlyResource(deletedSchedule.body, 'template');

    assert.ok(published.length >= 2);
  });
});
