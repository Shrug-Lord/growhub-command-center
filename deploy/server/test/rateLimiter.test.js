'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createFixedWindowRateLimiter } = require('../src/rateLimiter');

test('fixed windows count every request without extending the anchored window', () => {
  let now = 0;
  const throttles = [];
  const limiter = createFixedWindowRateLimiter({
    clock: () => now,
    onThrottle: (entry) => throttles.push(entry),
  });
  const request = () =>
    limiter.consume({
      primary: { category: 'setup_ip', key: '192.0.2.1' },
      clientIp: '192.0.2.1',
    });

  for (let count = 0; count < 5; count += 1) assert.equal(request().allowed, true);
  assert.deepEqual(request(), {
    allowed: false,
    retryAfterSeconds: 600,
    categories: ['setup_ip'],
    capacityOverflow: false,
  });

  now = 599_500;
  assert.equal(request().retryAfterSeconds, 1);
  now = 600_000;
  assert.equal(request().allowed, true);
  assert.equal(throttles.length, 2);
});

test('a blocked IP bucket does not allocate a new secondary identity bucket', () => {
  const limiter = createFixedWindowRateLimiter({ clock: () => 0 });
  const consume = (username) =>
    limiter.consume({
      primary: { category: 'login_ip', key: '192.0.2.1' },
      secondary: { category: 'login_username', key: username },
      clientIp: '192.0.2.1',
    });

  for (let count = 0; count < 10; count += 1) assert.equal(consume('admin').allowed, true);
  assert.equal(consume('never-allocate').allowed, false);
  assert.equal(limiter.snapshot().active_bucket_counts.login_username, 1);

  const existing = consume('admin');
  assert.equal(existing.allowed, false);
  assert.deepEqual(existing.categories, ['login_ip', 'login_username']);
});

test('capacity overflow preserves active buckets and reports only aggregate pressure', () => {
  let now = 1_000;
  const throttles = [];
  const limiter = createFixedWindowRateLimiter({
    capacity: 2,
    clock: () => now,
    onThrottle: (entry) => throttles.push(entry),
  });
  const consume = (key) =>
    limiter.consume({
      primary: { category: 'setup_ip', key },
      clientIp: key,
    });

  assert.equal(consume('192.0.2.1').allowed, true);
  now = 2_000;
  assert.equal(consume('192.0.2.2').allowed, true);
  now = 3_000;
  const overflow = consume('192.0.2.3');
  assert.equal(overflow.allowed, false);
  assert.equal(overflow.capacityOverflow, true);
  assert.deepEqual(overflow.categories, []);
  assert.equal(throttles.length, 0);
  assert.equal(limiter.snapshot().bucket_overflow_count, 1);
  assert.equal(limiter.snapshot().last_bucket_overflow_at, 3_000);
});
