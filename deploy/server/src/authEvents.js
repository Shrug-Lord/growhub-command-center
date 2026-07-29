'use strict';

const EVENT_RETENTION_MS = 30 * 86_400_000;
const THROTTLE_COALESCE_MS = 5 * 60_000;
const THROTTLE_SPAN_MS = 24 * 3_600_000;

function createAuthEventStore({ stmts, clock = () => Date.now() }) {
  function prune(now = clock()) {
    stmts.deleteOldAuthSecurityEvents.run(now - EVENT_RETENTION_MS);
    stmts.trimAuthSecurityEvents.run();
  }

  function record(
    type,
    { clientIp = null, adminIdentity = null, category = null, reason = null, now = clock() } = {},
  ) {
    stmts.insertAuthSecurityEvent.run({
      type,
      client_ip: clientIp,
      admin_identity: adminIdentity,
      category,
      reason,
      first_at: now,
      last_at: now,
      count: 1,
    });
    prune(now);
  }

  function recordThrottle({ category, clientIp, now = clock() }) {
    const current = stmts.getLatestThrottleEvent.get({
      client_ip: clientIp,
      category,
    });
    if (
      current &&
      now - current.last_at <= THROTTLE_COALESCE_MS &&
      now - current.first_at < THROTTLE_SPAN_MS
    ) {
      stmts.updateThrottleEvent.run({
        id: current.id,
        last_at: now,
        count: current.count + 1,
      });
      prune(now);
      return;
    }
    record('rate_limit_throttled', { clientIp, category, reason: 'rate_limited', now });
  }

  function list() {
    return stmts.getAuthSecurityEvents.all();
  }

  prune();
  return Object.freeze({ list, prune, record, recordThrottle });
}

function redactAuthEventsForExport(events) {
  const aliases = new Map();
  function alias(clientIp) {
    if (!clientIp) return null;
    if (!aliases.has(clientIp)) aliases.set(clientIp, `client-${aliases.size + 1}`);
    return aliases.get(clientIp);
  }

  return events.map((event) => ({
    id: event.id,
    type: event.type,
    client: alias(event.client_ip),
    admin_identity: event.admin_identity ? 'admin' : null,
    category: event.category,
    reason: event.reason,
    first_at: event.first_at,
    last_at: event.last_at,
    count: event.count,
  }));
}

module.exports = {
  EVENT_RETENTION_MS,
  THROTTLE_COALESCE_MS,
  THROTTLE_SPAN_MS,
  createAuthEventStore,
  redactAuthEventsForExport,
};
