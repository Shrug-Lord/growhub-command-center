'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { REDACTED, createLogger } = require('../src/logger');

test('logger writes structured JSON and redacts sensitive fields', () => {
  const output = [];
  const errors = [];
  const logger = createLogger({
    level: 'info',
    clock: () => new Date('2026-07-13T12:00:00.000Z'),
    write: (line) => output.push(line),
    writeError: (line) => errors.push(line),
  });

  logger.info('setup_attempted', {
    username: 'admin',
    password: 'do-not-log',
    nested: { csrfToken: 'also-secret' },
  });
  logger.debug('not_emitted');

  assert.equal(errors.length, 0);
  assert.equal(output.length, 1);
  const record = JSON.parse(output[0]);
  assert.deepEqual(record, {
    timestamp: '2026-07-13T12:00:00.000Z',
    level: 'info',
    event: 'setup_attempted',
    username: 'admin',
    password: REDACTED,
    nested: { csrfToken: REDACTED },
  });
});

test('logger sends warning and error records to stderr', () => {
  const output = [];
  const errors = [];
  const logger = createLogger({
    level: 'warn',
    write: (line) => output.push(line),
    writeError: (line) => errors.push(line),
  });

  logger.info('not_emitted');
  logger.warn('broker_offline');
  logger.error('startup_failed', { error: new Error('failed') });

  assert.equal(output.length, 0);
  assert.equal(errors.length, 2);
  assert.equal(JSON.parse(errors[0]).event, 'broker_offline');
  assert.deepEqual(JSON.parse(errors[1]).error, {
    name: 'Error',
    message: 'failed',
  });
});

test('production logging redacts credential aliases and omits arbitrary error messages', () => {
  const errors = [];
  const logger = createLogger({
    level: 'error',
    includeErrorMessages: false,
    writeError: (line) => errors.push(line),
  });

  logger.error('request_failed', {
    apiKey: 'secret-key',
    credentials: { username: 'admin', password: 'secret-password' },
    error: Object.assign(new Error('SELECT password FROM users'), { code: 'SQLITE_ERROR' }),
  });

  const record = JSON.parse(errors[0]);
  assert.equal(record.apiKey, REDACTED);
  assert.equal(record.credentials, REDACTED);
  assert.deepEqual(record.error, { name: 'Error', code: 'SQLITE_ERROR' });
  assert.equal(errors[0].includes('SELECT password'), false);
  assert.equal(errors[0].includes('secret-password'), false);
});

test('log strings are bounded while exposed operational errors remain readable', () => {
  const errors = [];
  const logger = createLogger({
    level: 'error',
    includeErrorMessages: false,
    writeError: (line) => errors.push(line),
  });
  const error = Object.assign(new Error('Reset the application data before retrying.'), {
    code: 'legacy_schema_detected',
    expose: true,
  });

  logger.error('server_start_failed', { detail: 'x'.repeat(10_000), error });

  const record = JSON.parse(errors[0]);
  assert.match(record.detail, /\[Truncated\]$/);
  assert.equal(record.detail.length < 4_200, true);
  assert.equal(record.error.message, 'Reset the application data before retrying.');
});

test('logger keeps a bounded sanitized diagnostics ring for warnings and errors', () => {
  const logger = createLogger({
    level: 'debug',
    write() {},
    writeError() {},
    clock: () => new Date('2026-07-13T12:00:00.000Z'),
  });
  for (let index = 0; index < 105; index += 1) {
    logger.warn('broker_warning', { index, password: 'never-export-me' });
  }
  logger.info('routine_status', { value: true });
  const recent = logger.recent();
  assert.equal(recent.length, 100);
  assert.equal(recent[0].index, 104);
  assert.equal(recent[0].password, REDACTED);
  assert.equal(
    recent.some((entry) => entry.event === 'routine_status'),
    false,
  );
});
