'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { payloadDiff, safeBrokerConfig } = require('../src/diagnostics');

test('payloadDiff reports stable paths for nested schedule changes', () => {
  assert.deepEqual(
    payloadDiff(
      { v: 3, outlets: [{ id: 1, conditions: [{ start: '06:00' }] }] },
      { v: 3, outlets: [{ id: 1, conditions: [{ start: '07:00' }] }, { id: 2 }] },
    ),
    [
      {
        path: '$.outlets[0].conditions[0].start',
        expected: '06:00',
        actual: '07:00',
      },
      {
        path: '$.outlets[1]',
        expected: undefined,
        actual: { id: 2 },
      },
    ],
  );
});

test('broker diagnostics never expose MQTT credentials and redact host on export', () => {
  const config = { mqttUrl: 'mqtts://operator:secret@broker.lan:8883' };
  assert.deepEqual(safeBrokerConfig(config, false), {
    configured: true,
    protocol: 'mqtts',
    port: '8883',
    tls: true,
    credentials_configured: true,
    hostname: 'broker.lan',
  });
  assert.deepEqual(safeBrokerConfig(config, true), {
    configured: true,
    protocol: 'mqtts',
    port: '8883',
    tls: true,
    credentials_configured: true,
  });
});
