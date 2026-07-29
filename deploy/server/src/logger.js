'use strict';

const LEVEL_PRIORITY = Object.freeze({ error: 0, warn: 1, info: 2, debug: 3 });
const SENSITIVE_KEY =
  /(authorization|cookie|credential|csrf|password|secret|session|token|api[-_]?key)/i;
const REDACTED = '[REDACTED]';
const MAX_STRING_LENGTH = 4_096;
const RECENT_EVENT_LIMIT = 100;

function boundedString(value) {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}[Truncated]`;
}

function sanitize(
  value,
  key = '',
  seen = new WeakSet(),
  depth = 0,
  { includeErrorMessages = true } = {},
) {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return boundedString(value);
  if (typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (value instanceof Error) {
    const output = { name: value.name };
    if (value.code !== undefined) output.code = boundedString(String(value.code));
    if (includeErrorMessages || value.expose === true) {
      output.message = boundedString(value.message);
    }
    return output;
  }
  if (depth >= 6) return '[Truncated]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => sanitize(item, '', seen, depth + 1, { includeErrorMessages }));
  }

  const result = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, 100)) {
    result[childKey] = sanitize(childValue, childKey, seen, depth + 1, { includeErrorMessages });
  }
  return result;
}

function createLogger({
  level = 'info',
  clock = () => new Date(),
  write = (line) => process.stdout.write(line),
  writeError = (line) => process.stderr.write(line),
  includeErrorMessages = true,
} = {}) {
  const threshold = LEVEL_PRIORITY[level];
  if (threshold === undefined) throw new Error(`Unsupported log level: ${level}`);
  const recentEvents = [];

  function emit(logLevel, event, fields = {}) {
    if (LEVEL_PRIORITY[logLevel] > threshold) return;
    const record = {
      timestamp: clock().toISOString(),
      level: logLevel,
      event,
      ...sanitize(fields, '', new WeakSet(), 0, { includeErrorMessages }),
    };
    if (logLevel === 'error' || logLevel === 'warn') {
      recentEvents.unshift(record);
      if (recentEvents.length > RECENT_EVENT_LIMIT) recentEvents.length = RECENT_EVENT_LIMIT;
    }
    const line = `${JSON.stringify(record)}\n`;
    if (logLevel === 'error' || logLevel === 'warn') writeError(line);
    else write(line);
  }

  return Object.freeze({
    error: (event, fields) => emit('error', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    info: (event, fields) => emit('info', event, fields),
    debug: (event, fields) => emit('debug', event, fields),
    recent: () => recentEvents.map((entry) => ({ ...entry })),
  });
}

module.exports = { RECENT_EVENT_LIMIT, REDACTED, createLogger, sanitize };
