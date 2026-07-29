'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { ConfigurationError, loadConfig } = require('../src/config');

test('loadConfig returns local development defaults', () => {
  const config = loadConfig({});

  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 3000);
  assert.equal(config.logLevel, 'info');
  assert.equal(config.mqttUrl, 'mqtt://127.0.0.1:1883');
  assert.equal(config.mqttClientId, 'growhub-command-center');
  assert.equal(config.dbPath, path.join(config.appDataDir, 'growhub.db'));
  assert.deepEqual(config.trustedProxies, []);
});

test('loadConfig derives the database path from APP_DATA_DIR', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_DATA_DIR: './tmp/app-data',
  });

  assert.equal(config.appDataDir, path.resolve('./tmp/app-data'));
  assert.equal(config.dbPath, path.resolve('./tmp/app-data/growhub.db'));
});

test('loadConfig accepts an in-memory database and secure MQTT transport', () => {
  const config = loadConfig({
    DB_PATH: ':memory:',
    MQTT_URL: 'mqtts://broker.example.test:8883',
    PORT: '8080',
    LOG_LEVEL: 'debug',
  });

  assert.equal(config.dbPath, ':memory:');
  assert.equal(config.mqttUrl, 'mqtts://broker.example.test:8883');
  assert.equal(config.port, 8080);
  assert.equal(config.logLevel, 'debug');
});

for (const [field, value] of [
  ['PORT', '0'],
  ['PORT', 'not-a-port'],
  ['LOG_LEVEL', 'verbose'],
  ['NODE_ENV', 'staging'],
  ['MQTT_URL', 'https://broker.example.test'],
  ['MQTT_CLIENT_ID', 'invalid client id'],
  ['DB_PATH', ''],
  ['APP_DATA_DIR', ''],
  ['DIST_DIR', ''],
]) {
  test(`loadConfig rejects ${field}=${JSON.stringify(value)}`, () => {
    assert.throws(
      () => loadConfig({ [field]: value }),
      (error) =>
        error instanceof ConfigurationError &&
        error.code === 'invalid_configuration' &&
        error.field === field,
    );
  });
}

test('loadConfig rejects a persistent database outside APP_DATA_DIR', () => {
  assert.throws(
    () =>
      loadConfig({
        APP_DATA_DIR: './tmp/app-data',
        DB_PATH: './tmp/other/growhub.db',
      }),
    (error) =>
      error instanceof ConfigurationError &&
      error.code === 'invalid_configuration' &&
      error.field === 'DB_PATH',
  );
});

test('loadConfig validates trusted proxy addresses and CIDR ranges', () => {
  const config = loadConfig({
    TRUSTED_PROXIES: '127.0.0.1,10.0.0.0/8,2001:db8::/32',
  });
  assert.deepEqual(
    config.trustedProxies.map((entry) => entry.source),
    ['127.0.0.1', '10.0.0.0/8', '2001:db8::/32'],
  );

  assert.throws(
    () => loadConfig({ TRUSTED_PROXIES: '10.0.0.0/99' }),
    (error) => error instanceof ConfigurationError && error.field === 'TRUSTED_PROXIES',
  );
});
