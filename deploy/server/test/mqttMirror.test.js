'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { openDatabase } = require('../src/db');
const { createMqttService, SUBSCRIPTIONS } = require('../src/mqtt');
const { MAC, outletsPayload, schedulePayload } = require('../test-support/firmwareFixtures');

class FakeMqttClient extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.subscriptions = null;
  }

  connectBroker() {
    this.connected = true;
    this.emit('connect');
  }

  disconnectBroker() {
    this.connected = false;
    this.emit('offline');
  }

  subscribe(subscriptions, callback) {
    this.subscriptions = subscriptions;
    callback(
      null,
      Object.entries(subscriptions).map(([topic, options]) => ({
        topic,
        qos: options.qos,
      })),
    );
  }

  deliver(topic, payload, retained = false) {
    this.emit('message', topic, Buffer.from(payload), { retain: retained });
  }

  publish() {}

  end(_force, _options, callback) {
    this.connected = false;
    callback();
  }
}

function createTimerHarness() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeoutFn(callback, delay) {
      const handle = { id: nextId++, delay, unref() {} };
      timers.set(handle.id, { handle, callback });
      return handle;
    },
    clearTimeoutFn(handle) {
      timers.delete(handle?.id);
    },
    runAll() {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const { callback } of callbacks) callback();
    },
  };
}

function createHarness(t) {
  let now = 1_000;
  const database = openDatabase(':memory:', { clock: () => now });
  const client = new FakeMqttClient();
  const timers = createTimerHarness();
  const records = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (event, context) => records.push({ level, event, context }),
    ]),
  );
  const service = createMqttService({
    url: 'mqtt://broker.test:1883',
    stmts: database.stmts,
    logger,
    clock: () => now,
    connectFn: () => client,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    retainedStateGraceMs: 60_000,
  });
  service.connect();
  client.connectBroker();
  t.after(async () => {
    await service.disconnect();
    database.close();
  });
  return {
    client,
    database,
    records,
    service,
    timers,
    advance(milliseconds) {
      now += milliseconds;
    },
  };
}

function deliverRequiredState(client) {
  client.deliver(`growhub/${MAC}/status`, 'online', true);
  client.deliver(`growhub/${MAC}/outlets/state`, JSON.stringify(outletsPayload()), true);
  client.deliver(`growhub/${MAC}/schedule/state`, JSON.stringify(schedulePayload()), true);
}

test('server subscribes to every CE state and error topic with documented QoS', (t) => {
  const { client, service } = createHarness(t);
  assert.deepEqual(client.subscriptions, SUBSCRIPTIONS);
  assert.equal(service.getHealth().broker.status, 'connected');
  assert.equal(service.getHealth().broker.subscriptionsReady, true);
});

test('only validated discovery topics create devices and state revisions are monotonic', (t) => {
  const { client, database, service } = createHarness(t);
  client.deliver(`growhub/${MAC}/sensor/live`, JSON.stringify({ nId: MAC }));
  client.deliver(`growhub/${MAC.toLowerCase()}/status`, 'online', true);
  client.deliver(`growhub/${MAC}/control/error`, JSON.stringify({ reason: 'invalid_mode' }));
  assert.deepEqual(database.stmts.getAllDevices.all(), []);

  client.deliver(`growhub/${MAC}/status`, 'online', true);
  assert.ok(database.stmts.getDevice.get(MAC));
  assert.equal(database.stmts.getDeviceStateMirror.get(MAC, 'presence_state').revision, 1);
  client.deliver(`growhub/${MAC}/status`, 'online', true);
  assert.equal(database.stmts.getDeviceStateMirror.get(MAC, 'presence_state').revision, 2);
  client.deliver(`growhub/${MAC}/status`, 'ONLINE', true);
  assert.equal(database.stmts.getDeviceStateMirror.get(MAC, 'presence_state').revision, 2);
  assert.deepEqual(service.getDeviceSyncState(MAC).missingStates, [
    'outlet_state',
    'schedule_state',
  ]);
});

test('retained state rebuilds presence, outlets, schedule, mode, outputs, and sensor mirror', (t) => {
  const { client, database, service } = createHarness(t);
  deliverRequiredState(client);
  const sync = service.getDeviceSyncState(MAC);
  assert.equal(sync.status, 'ready');
  assert.deepEqual(sync.missingStates, []);

  const outlet = database.stmts.getDeviceStateMirror.get(MAC, 'outlet_state');
  const schedule = database.stmts.getDeviceStateMirror.get(MAC, 'schedule_state');
  const device = database.stmts.getDevice.get(MAC);
  assert.equal(JSON.parse(outlet.normalized_json).outlets[0].assignment, 'Light');
  assert.equal(JSON.parse(schedule.normalized_json).mode, 'auto');
  assert.equal(JSON.parse(schedule.normalized_json).outlet_status.length, 4);
  assert.equal(device.presence_status, 'online');
  assert.equal(device.current_mode, 'auto');

  client.deliver(
    `growhub/${MAC}/sensor/live`,
    JSON.stringify({
      nId: MAC,
      name: 'Bench Growhub',
      fw: '1.1.0C',
      data: [{ l: 75, h: 58.2, t: 24.1, a: '01000000', ts: '2026-05-31 12:00:00:000Z' }],
    }),
  );
  assert.equal(database.stmts.getDevice.get(MAC).fw, '1.1.0C');
  assert.equal(
    JSON.parse(database.stmts.getDeviceStateMirror.get(MAC, 'sensor_state').normalized_json)
      .temperature_c,
    24.1,
  );
  assert.equal(
    database.stmts.getMeasurementsInRange.all(MAC, 0, Number.MAX_SAFE_INTEGER).length,
    1,
  );
});

test('error sequences advance only for known devices and preserve unknown future reasons', (t) => {
  const { client, database } = createHarness(t);
  client.deliver(`growhub/${MAC}/control/error`, JSON.stringify({ reason: 'future_reason' }));
  assert.equal(database.stmts.getDeviceErrorMirror.get(MAC, 'control_error'), undefined);
  client.deliver(`growhub/${MAC}/status`, 'online', true);
  client.deliver(`growhub/${MAC}/control/error`, JSON.stringify({ reason: 'future_reason' }));
  client.deliver(`growhub/${MAC}/control/error`, JSON.stringify({ reason: 'invalid_mode' }));
  const error = database.stmts.getDeviceErrorMirror.get(MAC, 'control_error');
  assert.equal(error.sequence, 2);
  assert.equal(JSON.parse(error.normalized_json).reason, 'invalid_mode');
});

test('reconnect starts a fresh grace generation and missing states escalate then resolve', (t) => {
  const { client, database, service, timers, advance } = createHarness(t);
  deliverRequiredState(client);
  assert.equal(service.getDeviceSyncState(MAC).status, 'ready');

  client.disconnectBroker();
  assert.equal(service.getDeviceSyncState(MAC).status, 'broker_unavailable');
  client.connectBroker();
  assert.deepEqual(service.getDeviceSyncState(MAC).missingStates, [
    'presence_state',
    'outlet_state',
    'schedule_state',
  ]);
  assert.deepEqual(service.getDeviceSyncState(MAC).escalatedStates, []);

  advance(60_000);
  timers.runAll();
  assert.deepEqual(service.getDeviceSyncState(MAC).escalatedStates, [
    'outlet_state',
    'presence_state',
    'schedule_state',
  ]);
  assert.deepEqual(
    database.stmts.getActiveRetainedStateIncidents.all(MAC).map((row) => row.state_key),
    ['outlet_state', 'presence_state', 'schedule_state'],
  );
  client.deliver(`growhub/${MAC}/status`, 'online', true);
  assert.deepEqual(
    database.stmts.getActiveRetainedStateIncidents.all(MAC).map((row) => row.state_key),
    ['outlet_state', 'schedule_state'],
  );
  assert.equal(
    database.stmts.getResolvedRetainedStateIncidents.all(MAC)[0].state_key,
    'presence_state',
  );
});

test('unsupported retained contracts stay monitorable and expose compatibility metadata', (t) => {
  const { client, database, service } = createHarness(t);
  const observed = [];
  service.addObserver({
    observeState(event) {
      observed.push(event);
    },
  });

  client.deliver(
    `growhub/${MAC}/outlets/state`,
    JSON.stringify({ v: 2, source: 'reconnect', outlets: [] }),
    true,
  );
  const state = database.stmts.getDeviceStateMirror.get(MAC, 'outlet_state');
  assert.equal(state.compatible, 0);
  assert.equal(state.schema_version, 2);
  assert.equal(state.compatibility_reason, 'unsupported_outlet_state_version');
  assert.ok(database.stmts.getDevice.get(MAC));
  assert.deepEqual(observed, []);
});

test('discovery-capable live deliveries register devices even when MQTT clears RETAIN for existing subscribers', (t) => {
  const { client, database } = createHarness(t);
  client.deliver(`growhub/${MAC}/status`, 'online', false);
  const state = database.stmts.getDeviceStateMirror.get(MAC, 'presence_state');
  assert.ok(state);
  assert.equal(state.mqtt_retained, 0);
  assert.equal(state.raw_json, 'online');
});
