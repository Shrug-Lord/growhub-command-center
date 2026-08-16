'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ConfigurationError } = require('../src/config');
const { startRetentionSweep, startServer } = require('../src/index');
const { createRuntimeState } = require('../src/runtimeState');

function statement({ all = [], get = null, run = { changes: 0 } } = {}) {
  return {
    all: () => all,
    get: () => get,
    run: () => run,
  };
}

test('bootstrap initializes dependencies and shuts them down in order', async () => {
  const events = [];
  const defaultStatement = statement();
  const database = {
    db: { prepare: () => defaultStatement },
    stmts: new Proxy(
      {
        getAllInstances: statement({ all: [] }),
        getSetting: statement({ get: { value: '365' } }),
        deleteOldMeasurements: statement(),
      },
      {
        get(target, key) {
          return target[key] || defaultStatement;
        },
      },
    ),
    DEFAULT_OUTLETS: '[]',
    close() {
      events.push('database_close');
    },
  };
  const mqttService = {
    connect() {
      events.push('mqtt_connect');
    },
    disconnect() {
      events.push('mqtt_disconnect');
      return Promise.resolve();
    },
    publish() {},
  };
  const server = {
    address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 3000 }),
    close(callback) {
      events.push('http_close');
      callback();
    },
    closeAllConnections() {
      events.push('http_force_close');
    },
  };
  const logger = { debug() {}, error() {}, info() {}, warn() {} };
  const intervalHandle = { unref() {} };
  const timeoutHandle = { unref() {} };

  const running = await startServer({
    env: { NODE_ENV: 'test', DB_PATH: ':memory:' },
    database,
    mqttService,
    logger,
    listenFn: async () => {
      events.push('http_listen');
      return server;
    },
    setIntervalFn: () => intervalHandle,
    clearIntervalFn: () => events.push('retention_clear'),
    setTimeoutFn: () => timeoutHandle,
    clearTimeoutFn: () => events.push('drain_timeout_clear'),
    acquireAppDataLockFn: () => {
      events.push('app_data_lock_acquire');
      return {
        release() {
          events.push('app_data_lock_release');
        },
      };
    },
  });

  assert.equal(running.runtimeState.isReady(), true);
  assert.deepEqual(events.slice(0, 3), ['app_data_lock_acquire', 'http_listen', 'mqtt_connect']);

  const firstStop = running.stop('test');
  const secondStop = running.stop('test-again');
  assert.equal(firstStop, secondStop);
  await firstStop;

  assert.equal(running.runtimeState.isShuttingDown(), true);
  assert.ok(events.indexOf('http_close') < events.indexOf('mqtt_disconnect'));
  assert.ok(events.indexOf('mqtt_disconnect') < events.indexOf('database_close'));
  assert.ok(events.indexOf('database_close') < events.indexOf('app_data_lock_release'));
  assert.equal(events.includes('http_force_close'), false);
});

test('bootstrap rejects invalid configuration before touching dependencies', async () => {
  let listened = false;
  let lockTouched = false;

  await assert.rejects(
    startServer({
      env: { PORT: '0' },
      database: {
        close() {
          throw new Error('must not close');
        },
      },
      mqttService: {
        disconnect() {
          throw new Error('must not disconnect');
        },
      },
      listenFn: async () => {
        listened = true;
        throw new Error('must not listen');
      },
      acquireAppDataLockFn: () => {
        lockTouched = true;
        throw new Error('must not acquire lock');
      },
    }),
    (error) => error instanceof ConfigurationError && error.field === 'PORT',
  );
  assert.equal(listened, false);
  assert.equal(lockTouched, false);
});

test('bootstrap closes initialized dependencies when listening fails', async () => {
  const events = [];
  const runtimeState = createRuntimeState();
  const defaultStatement = statement();
  const database = {
    db: { prepare: () => defaultStatement },
    stmts: new Proxy(
      {
        getAllInstances: statement({ all: [] }),
      },
      {
        get: (target, key) => target[key] || defaultStatement,
      },
    ),
    DEFAULT_OUTLETS: '[]',
    close() {
      events.push('database_close');
    },
  };
  const mqttService = {
    connect() {
      events.push('mqtt_connect');
    },
    disconnect() {
      events.push('mqtt_disconnect');
      return Promise.resolve();
    },
    publish() {},
  };

  await assert.rejects(
    startServer({
      env: { NODE_ENV: 'test', DB_PATH: ':memory:' },
      database,
      mqttService,
      runtimeState,
      logger: { debug() {}, error() {}, info() {}, warn() {} },
      listenFn: async () => {
        throw new Error('address unavailable');
      },
      acquireAppDataLockFn: () => {
        events.push('app_data_lock_acquire');
        return {
          release() {
            events.push('app_data_lock_release');
          },
        };
      },
    }),
    /address unavailable/,
  );

  assert.deepEqual(events, [
    'app_data_lock_acquire',
    'mqtt_disconnect',
    'database_close',
    'app_data_lock_release',
  ]);
  assert.equal(runtimeState.snapshot().phase, 'failed');
});

test('bootstrap closes the listener and dependencies when MQTT startup fails', async () => {
  const events = [];
  const defaultStatement = statement();
  const database = {
    db: { prepare: () => defaultStatement },
    stmts: new Proxy(
      { getAllInstances: statement({ all: [] }) },
      {
        get: (target, key) => target[key] || defaultStatement,
      },
    ),
    DEFAULT_OUTLETS: '[]',
    close() {
      events.push('database_close');
    },
  };
  const server = {
    address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 3000 }),
    close(callback) {
      events.push('http_close');
      callback();
    },
    closeAllConnections() {},
  };
  const mqttService = {
    connect() {
      events.push('mqtt_connect');
      throw Object.assign(new Error('broker startup failed'), { code: 'MQTT_START_FAILED' });
    },
    disconnect() {
      events.push('mqtt_disconnect');
      return Promise.resolve();
    },
    publish() {},
  };

  await assert.rejects(
    startServer({
      env: { NODE_ENV: 'test', DB_PATH: ':memory:' },
      database,
      mqttService,
      logger: { debug() {}, error() {}, info() {}, warn() {} },
      listenFn: async () => server,
      acquireAppDataLockFn: () => ({
        release() {
          events.push('app_data_lock_release');
        },
      }),
    }),
    (error) => error.code === 'MQTT_START_FAILED',
  );

  assert.deepEqual(events, [
    'mqtt_connect',
    'http_close',
    'mqtt_disconnect',
    'database_close',
    'app_data_lock_release',
  ]);
});

test('shutdown releases app-data ownership even when MQTT disconnect fails', async () => {
  const events = [];
  const defaultStatement = statement();
  const database = {
    db: { prepare: () => defaultStatement },
    stmts: new Proxy(
      {
        getAllInstances: statement({ all: [] }),
        getSetting: statement({ get: { value: '365' } }),
        deleteOldMeasurements: statement(),
      },
      {
        get: (target, key) => target[key] || defaultStatement,
      },
    ),
    DEFAULT_OUTLETS: '[]',
    close() {
      events.push('database_close');
    },
  };
  const mqttService = {
    connect() {},
    disconnect() {
      events.push('mqtt_disconnect');
      return Promise.reject(new Error('disconnect failed'));
    },
    publish() {},
  };
  const server = {
    address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 3000 }),
    close(callback) {
      callback();
    },
    closeAllConnections() {},
  };

  const running = await startServer({
    env: { NODE_ENV: 'test', DB_PATH: ':memory:' },
    database,
    mqttService,
    logger: { debug() {}, error() {}, info() {}, warn() {} },
    listenFn: async () => server,
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn() {},
    setTimeoutFn: () => ({ unref() {} }),
    clearTimeoutFn() {},
    acquireAppDataLockFn: () => ({
      release() {
        events.push('app_data_lock_release');
      },
    }),
  });

  await assert.rejects(running.stop('test'), /disconnect failed/);
  assert.deepEqual(events, ['mqtt_disconnect', 'database_close', 'app_data_lock_release']);
});

test('shutdown becomes unready immediately and force-closes connections after the drain timeout', async () => {
  let closeCallback;
  let forceCallback;
  const events = [];
  const defaultStatement = statement();
  const database = {
    db: { prepare: () => defaultStatement },
    stmts: new Proxy(
      {
        getAllInstances: statement({ all: [] }),
        getSetting: statement({ get: { value: '365' } }),
        deleteOldMeasurements: statement(),
      },
      { get: (target, key) => target[key] || defaultStatement },
    ),
    DEFAULT_OUTLETS: '[]',
    close() {
      events.push('database_close');
    },
  };
  const server = {
    address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 3000 }),
    close(callback) {
      closeCallback = callback;
    },
    closeAllConnections() {
      events.push('http_force_close');
    },
  };

  const running = await startServer({
    env: { NODE_ENV: 'test', DB_PATH: ':memory:' },
    database,
    mqttService: { connect() {}, disconnect: async () => {}, publish() {} },
    logger: { debug() {}, error() {}, info() {}, warn() {} },
    listenFn: async () => server,
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn() {},
    setTimeoutFn(callback) {
      forceCallback = callback;
      return { unref() {} };
    },
    clearTimeoutFn() {},
    acquireAppDataLockFn: () => ({
      release() {
        events.push('app_data_lock_release');
      },
    }),
  });

  const stopping = running.stop('test');
  assert.equal(running.runtimeState.isReady(), false);
  assert.equal(running.runtimeState.isShuttingDown(), true);

  forceCallback();
  assert.deepEqual(events, ['http_force_close']);
  closeCallback();
  await stopping;
  assert.deepEqual(events, ['http_force_close', 'database_close', 'app_data_lock_release']);
});

test('retention failures are logged and do not escape the scheduled callback', () => {
  let sweep;
  const failures = [];
  startRetentionSweep({
    stmts: {
      getSetting: {
        get() {
          throw Object.assign(new Error('database unavailable'), { code: 'SQLITE_BUSY' });
        },
      },
      deleteOldMeasurements: statement(),
    },
    logger: {
      info() {},
      error(event, fields) {
        failures.push({ event, fields });
      },
    },
    clock: () => 0,
    intervalMs: 60_000,
    setIntervalFn(callback) {
      sweep = callback;
      return { unref() {} };
    },
  });

  assert.doesNotThrow(() => sweep());
  assert.equal(failures.length, 1);
  assert.equal(failures[0].event, 'measurement_retention_failed');
  assert.equal(failures[0].fields.error.code, 'SQLITE_BUSY');
});

test('retention prunes each device through the indexed device-time key', () => {
  let sweep;
  const calls = [];
  const messages = [];
  startRetentionSweep({
    stmts: {
      getSetting: statement({ get: { value: '30' } }),
      getKnownDeviceIds: statement({ all: [{ id: 'AA' }, { id: 'BB' }] }),
      deleteOldMeasurements: {
        run(deviceId, cutoff) {
          calls.push({ deviceId, cutoff });
          return { changes: deviceId === 'AA' ? 2 : 3 };
        },
      },
    },
    logger: {
      info(event, fields) {
        messages.push({ event, fields });
      },
      error() {},
    },
    clock: () => 40 * 86_400_000,
    intervalMs: 60_000,
    setIntervalFn(callback) {
      sweep = callback;
      return { unref() {} };
    },
  });

  sweep();
  assert.deepEqual(calls, [
    { deviceId: 'AA', cutoff: 10 * 86_400_000 },
    { deviceId: 'BB', cutoff: 10 * 86_400_000 },
  ]);
  assert.deepEqual(messages, [
    { event: 'measurement_retention_completed', fields: { deleted_count: 5 } },
  ]);
});
