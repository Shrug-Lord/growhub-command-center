'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAuthEventStore, redactAuthEventsForExport } = require('../src/authEvents');
const { openDatabase } = require('../src/db');

test('auth event history coalesces throttles and remains bounded', () => {
  let now = 1_000;
  const database = openDatabase(':memory:', { clock: () => now });
  const store = createAuthEventStore({ stmts: database.stmts, clock: () => now });

  store.recordThrottle({ category: 'login_ip', clientIp: '192.0.2.1', now });
  now += 60_000;
  store.recordThrottle({ category: 'login_ip', clientIp: '192.0.2.1', now });
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].count, 2);
  assert.equal(store.list()[0].first_at, 1_000);

  now += 5 * 60_000 + 1;
  store.recordThrottle({ category: 'login_ip', clientIp: '192.0.2.1', now });
  assert.equal(store.list().length, 2);

  for (let index = 0; index < 105; index += 1) {
    now += 1;
    store.record('login_succeeded', {
      clientIp: `192.0.2.${(index % 200) + 1}`,
      adminIdentity: 'bench-admin',
      now,
    });
  }
  assert.equal(store.list().length, 100);
  database.close();
});

test('auth event export uses per-bundle client aliases and a fixed admin identity', () => {
  const source = [
    {
      id: 1,
      type: 'login_succeeded',
      client_ip: '192.0.2.10',
      admin_identity: 'test.admin',
      category: null,
      reason: null,
      first_at: 1,
      last_at: 1,
      count: 1,
    },
    {
      id: 2,
      type: 'rate_limit_throttled',
      client_ip: '192.0.2.10',
      admin_identity: null,
      category: 'login_ip',
      reason: 'rate_limited',
      first_at: 2,
      last_at: 3,
      count: 2,
    },
    {
      id: 3,
      type: 'logout',
      client_ip: '198.51.100.8',
      admin_identity: 'test.admin',
      category: null,
      reason: null,
      first_at: 4,
      last_at: 4,
      count: 1,
    },
  ];

  const exported = redactAuthEventsForExport(source);
  assert.equal(exported[0].client, 'client-1');
  assert.equal(exported[1].client, 'client-1');
  assert.equal(exported[2].client, 'client-2');
  assert.equal(exported[0].admin_identity, 'admin');
  assert.equal(JSON.stringify(exported).includes('192.0.2.10'), false);
  assert.equal(JSON.stringify(exported).includes('test.admin'), false);
});
