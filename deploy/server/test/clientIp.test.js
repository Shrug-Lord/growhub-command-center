'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createClientIpResolver, normalizeIp, parseTrustedProxyList } = require('../src/clientIp');

function request(remoteAddress, forwardedFor) {
  return {
    socket: { remoteAddress },
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
  };
}

test('client IP defaults to the direct peer and ignores untrusted forwarding headers', () => {
  let now = 1_000;
  const resolver = createClientIpResolver({ clock: () => now });
  assert.equal(normalizeIp('::ffff:192.0.2.4'), '192.0.2.4');
  assert.equal(resolver.resolve(request('::ffff:192.0.2.4')), '192.0.2.4');

  now = 2_000;
  assert.equal(resolver.resolve(request('192.0.2.4', '198.51.100.10')), '192.0.2.4');
  assert.deepEqual(resolver.snapshot(), {
    enabled: false,
    entry_count: 0,
    exact_address_count: 0,
    cidr_count: 0,
    entries: [],
    ignored_forwarded_count: 1,
    last_ignored_at: 2_000,
    last_ignored_reason: 'untrusted_peer',
  });
});

test('trusted proxy chains walk right to left and stop at the first untrusted client', () => {
  const trustedProxies = parseTrustedProxyList('127.0.0.1,10.0.0.0/8,2001:db8::/32');
  const resolver = createClientIpResolver({ trustedProxies });

  assert.equal(resolver.resolve(request('127.0.0.1', '198.51.100.7, 10.2.3.4')), '198.51.100.7');
  assert.equal(resolver.resolve(request('127.0.0.1', '2001:db9::5, 2001:db8::9')), '2001:db9::5');
});

test('malformed trusted proxy chains fall back to the direct peer without retaining raw input', () => {
  const resolver = createClientIpResolver({
    trustedProxies: parseTrustedProxyList('127.0.0.1'),
    clock: () => 3_000,
  });
  assert.equal(resolver.resolve(request('127.0.0.1', '198.51.100.7, not-an-ip')), '127.0.0.1');
  const snapshot = resolver.snapshot({ redactEntries: true });
  assert.equal(snapshot.entries, undefined);
  assert.equal(snapshot.ignored_forwarded_count, 1);
  assert.equal(snapshot.last_ignored_reason, 'malformed_chain');
});
