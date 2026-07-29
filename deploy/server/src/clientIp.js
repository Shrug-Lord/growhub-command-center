'use strict';

const net = require('node:net');

function normalizeIp(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  const normalized = mapped ? mapped[1] : trimmed;
  return net.isIP(normalized) ? normalized.toLowerCase() : null;
}

function parseTrustedProxyList(value) {
  if (value === undefined || value === null || String(value).trim() === '')
    return Object.freeze([]);
  const entries = String(value)
    .split(',')
    .map((entry) => entry.trim());
  if (entries.some((entry) => !entry)) throw new Error('empty trusted-proxy entry');

  return Object.freeze(
    entries.map((source) => {
      const parts = source.split('/');
      if (parts.length > 2) throw new Error(`invalid trusted-proxy entry ${source}`);
      const address = normalizeIp(parts[0]);
      const family = net.isIP(address);
      if (!family) throw new Error(`invalid trusted-proxy address ${source}`);

      if (parts.length === 1) {
        return Object.freeze({ source, address, family, prefix: null });
      }
      if (!/^\d+$/.test(parts[1])) throw new Error(`invalid trusted-proxy prefix ${source}`);
      const prefix = Number(parts[1]);
      const maximum = family === 4 ? 32 : 128;
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > maximum) {
        throw new Error(`invalid trusted-proxy prefix ${source}`);
      }
      return Object.freeze({ source, address, family, prefix });
    }),
  );
}

function buildBlockList(entries) {
  const blockList = new net.BlockList();
  for (const entry of entries) {
    const type = entry.family === 4 ? 'ipv4' : 'ipv6';
    if (entry.prefix === null) blockList.addAddress(entry.address, type);
    else blockList.addSubnet(entry.address, entry.prefix, type);
  }
  return blockList;
}

function createClientIpResolver({ trustedProxies = [], clock = () => Date.now() } = {}) {
  const blockList = buildBlockList(trustedProxies);
  let ignoredCount = 0;
  let lastIgnoredAt = null;
  let lastIgnoredReason = null;

  function isTrusted(address) {
    const normalized = normalizeIp(address);
    if (!normalized) return false;
    return blockList.check(normalized, net.isIP(normalized) === 4 ? 'ipv4' : 'ipv6');
  }

  function ignored(reason) {
    ignoredCount += 1;
    lastIgnoredAt = clock();
    lastIgnoredReason = reason;
  }

  function resolve(req) {
    const direct = normalizeIp(req?.socket?.remoteAddress) || 'unknown';
    const forwarded = req?.headers?.['x-forwarded-for'];
    if (forwarded === undefined) return direct;

    if (!isTrusted(direct)) {
      ignored('untrusted_peer');
      return direct;
    }
    if (typeof forwarded !== 'string') {
      ignored('malformed_chain');
      return direct;
    }

    const chain = forwarded.split(',').map(normalizeIp);
    if (chain.length === 0 || chain.some((address) => !address)) {
      ignored('malformed_chain');
      return direct;
    }

    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const address = chain[index];
      if (!isTrusted(address)) return address;
    }
    return chain[0];
  }

  function snapshot({ redactEntries = false } = {}) {
    const exactCount = trustedProxies.filter((entry) => entry.prefix === null).length;
    return Object.freeze({
      enabled: trustedProxies.length > 0,
      entry_count: trustedProxies.length,
      exact_address_count: exactCount,
      cidr_count: trustedProxies.length - exactCount,
      entries: redactEntries ? undefined : trustedProxies.map((entry) => entry.source),
      ignored_forwarded_count: ignoredCount,
      last_ignored_at: lastIgnoredAt,
      last_ignored_reason: lastIgnoredReason,
    });
  }

  return Object.freeze({ isTrusted, resolve, snapshot });
}

module.exports = { createClientIpResolver, normalizeIp, parseTrustedProxyList };
