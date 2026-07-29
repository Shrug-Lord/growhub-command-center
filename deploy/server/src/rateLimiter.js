'use strict';

const RATE_LIMITS = Object.freeze({
  setup_ip: Object.freeze({ limit: 5, windowMs: 10 * 60_000 }),
  login_ip: Object.freeze({ limit: 10, windowMs: 5 * 60_000 }),
  login_username: Object.freeze({ limit: 10, windowMs: 5 * 60_000 }),
  username_change_ip: Object.freeze({ limit: 5, windowMs: 15 * 60_000 }),
  username_change_admin: Object.freeze({ limit: 5, windowMs: 15 * 60_000 }),
  password_change_ip: Object.freeze({ limit: 5, windowMs: 15 * 60_000 }),
  password_change_admin: Object.freeze({ limit: 5, windowMs: 15 * 60_000 }),
});

const SWEEP_INTERVAL_MS = 5 * 60_000;
const DEFAULT_CAPACITY = 10_000;

function createFixedWindowRateLimiter({
  clock = () => Date.now(),
  capacity = DEFAULT_CAPACITY,
  onThrottle = () => {},
} = {}) {
  const buckets = new Map();
  let overflowCount = 0;
  let lastOverflowAt = null;

  function bucketId(category, key) {
    if (!RATE_LIMITS[category]) throw new Error(`Unknown rate-limit category ${category}.`);
    return `${category}\0${key}`;
  }

  function sweep(now = clock()) {
    let removed = 0;
    for (const [id, bucket] of buckets) {
      if (now >= bucket.windowStartedAt + bucket.windowMs) {
        buckets.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  function earliestExpiry(now) {
    let expiry = Infinity;
    for (const bucket of buckets.values()) {
      expiry = Math.min(expiry, bucket.windowStartedAt + bucket.windowMs);
    }
    return Number.isFinite(expiry) ? Math.max(now + 1_000, expiry) : now + 1_000;
  }

  function increment(category, key, { allocate = true } = {}) {
    const now = clock();
    const definition = RATE_LIMITS[category];
    const id = bucketId(category, key);
    let bucket = buckets.get(id);

    if (bucket && now >= bucket.windowStartedAt + bucket.windowMs) {
      buckets.delete(id);
      bucket = null;
    }
    if (!bucket && !allocate) return { skipped: true };

    if (!bucket) {
      if (buckets.size >= capacity) sweep(now);
      if (buckets.size >= capacity) {
        overflowCount += 1;
        lastOverflowAt = now;
        return { overflow: true, retryAt: earliestExpiry(now) };
      }
      bucket = {
        category,
        windowMs: definition.windowMs,
        windowStartedAt: now,
        count: 0,
      };
      buckets.set(id, bucket);
    }

    bucket.count += 1;
    return {
      blocked: bucket.count > definition.limit,
      category,
      retryAt: bucket.windowStartedAt + bucket.windowMs,
    };
  }

  function consume({ primary, secondary = null, clientIp = null }) {
    const results = [];
    const first = increment(primary.category, primary.key);
    results.push(first);

    if (secondary?.key) {
      const primaryBlocked = first.blocked || first.overflow;
      results.push(
        increment(secondary.category, secondary.key, {
          allocate: !primaryBlocked || buckets.has(bucketId(secondary.category, secondary.key)),
        }),
      );
    }

    const blocked = results.filter((result) => result.blocked);
    const overflow = results.find((result) => result.overflow);
    if (blocked.length === 0 && !overflow) {
      return Object.freeze({ allowed: true, retryAfterSeconds: 0, categories: Object.freeze([]) });
    }

    const now = clock();
    const retryAt = Math.max(
      ...results
        .filter((result) => result.blocked || result.overflow)
        .map((result) => result.retryAt),
    );
    const categories = Object.freeze([...new Set(blocked.map((result) => result.category))]);
    for (const category of categories) onThrottle({ category, clientIp, now });

    return Object.freeze({
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1_000)),
      categories,
      capacityOverflow: Boolean(overflow),
    });
  }

  function snapshot() {
    const activeBucketCounts = Object.fromEntries(Object.keys(RATE_LIMITS).map((key) => [key, 0]));
    for (const bucket of buckets.values()) activeBucketCounts[bucket.category] += 1;
    return Object.freeze({
      active_bucket_counts: Object.freeze(activeBucketCounts),
      bucket_capacity: capacity,
      bucket_overflow_count: overflowCount,
      last_bucket_overflow_at: lastOverflowAt,
    });
  }

  return Object.freeze({ consume, snapshot, sweep });
}

module.exports = {
  DEFAULT_CAPACITY,
  RATE_LIMITS,
  SWEEP_INTERVAL_MS,
  createFixedWindowRateLimiter,
};
