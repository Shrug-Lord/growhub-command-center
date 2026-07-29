'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CURRENT_PARAMETERS,
  hashPassword,
  normalizeUsername,
  parseVerifier,
  validatePassword,
  validateUsername,
  verifyPassword,
} = require('../src/passwordAuth');

test('admin username and password validators enforce the first-ship contract', () => {
  assert.equal(normalizeUsername('  Test.Admin  '), 'test.admin');
  assert.deepEqual(validateUsername('Grow_User-1'), {
    valid: true,
    username: 'grow_user-1',
    message: null,
  });
  assert.equal(validateUsername('admin@example.com').valid, false);
  assert.equal(validateUsername('ab').valid, false);
  assert.equal(validateUsername('contains space').valid, false);

  assert.equal(validatePassword('long enough password').valid, true);
  assert.equal(validatePassword('            ').valid, false);
  assert.equal(validatePassword('too short').valid, false);
  assert.equal(validatePassword('x'.repeat(129)).valid, false);
});

test('Argon2id verifiers are salted, self-describing, and timing-safe to verify', async () => {
  const password = 'correct horse battery staple';
  const first = await hashPassword(password);
  const second = await hashPassword(password);

  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.deepEqual(parseVerifier(first).parameters, {
    version: CURRENT_PARAMETERS.version,
    memory: CURRENT_PARAMETERS.memory,
    passes: CURRENT_PARAMETERS.passes,
    parallelism: CURRENT_PARAMETERS.parallelism,
    tagLength: CURRENT_PARAMETERS.tagLength,
  });
  assert.deepEqual(await verifyPassword(password, first), {
    valid: true,
    needsRehash: false,
  });
  assert.deepEqual(await verifyPassword('incorrect password value', first), {
    valid: false,
    needsRehash: false,
  });
});

test('supported weaker verifiers request transparent rehash and malformed data fails closed', async () => {
  const verifier = await hashPassword('correct horse battery staple', {
    parameters: {
      version: 19,
      memory: 7_168,
      passes: 1,
      parallelism: 1,
      tagLength: 32,
      saltLength: 16,
    },
  });
  assert.deepEqual(await verifyPassword('correct horse battery staple', verifier), {
    valid: true,
    needsRehash: true,
  });
  assert.deepEqual(await verifyPassword('anything at all', '$argon2id$broken'), {
    valid: false,
    needsRehash: false,
  });
});
