'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SessionSecretError, createSessionSecretStore, hashToken } = require('../src/sessionSecret');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'growhub-session-secret-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('session secret is persistent, restrictive, and domain-separates token hashes', (t) => {
  const appDataDir = temporaryDirectory(t);
  const firstStore = createSessionSecretStore(appDataDir);
  const secret = firstStore.ensure();
  assert.equal(secret.length, 32);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(firstStore.filename).mode & 0o777, 0o600);
  }

  const reloaded = createSessionSecretStore(appDataDir).load();
  assert.deepEqual(reloaded, secret);
  assert.notEqual(
    hashToken(secret, 'session', 'same-token'),
    hashToken(secret, 'csrf', 'same-token'),
  );
});

test('malformed session secret fails closed', (t) => {
  const appDataDir = temporaryDirectory(t);
  const store = createSessionSecretStore(appDataDir);
  fs.writeFileSync(store.filename, 'not a valid secret\n');
  assert.throws(
    () => store.load(),
    (error) => error instanceof SessionSecretError && error.code === 'invalid_session_secret',
  );
});
