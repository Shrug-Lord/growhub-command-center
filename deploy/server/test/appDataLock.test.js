'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AppDataLockError, LOCK_FILE_NAME, acquireAppDataLock } = require('../src/appDataLock');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'growhub-lock-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function waitForOutput(stream, expected) {
  return new Promise((resolve, reject) => {
    let output = '';
    function onData(chunk) {
      output += chunk.toString();
      if (!output.includes(expected)) return;
      cleanup();
      resolve(output);
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    function cleanup() {
      stream.off('data', onData);
      stream.off('error', onError);
    }
    stream.on('data', onData);
    stream.on('error', onError);
  });
}

test('app-data lock rejects a competing owner and releases idempotently', (t) => {
  const directory = temporaryDirectory(t);
  const first = acquireAppDataLock(directory);

  assert.equal(path.basename(first.lockPath), LOCK_FILE_NAME);
  assert.throws(
    () => acquireAppDataLock(directory),
    (error) =>
      error instanceof AppDataLockError &&
      error.code === 'app_data_in_use' &&
      error.expose === true,
  );

  first.release();
  first.release();
  const second = acquireAppDataLock(directory);
  second.release();
});

test('operating system releases app-data ownership after process death', async (t) => {
  const directory = temporaryDirectory(t);
  const fixture = path.join(__dirname, '../test-support/holdAppDataLock.js');
  const child = spawn(process.execPath, [fixture, directory], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });

  await waitForOutput(child.stdout, 'locked\n');
  assert.throws(
    () => acquireAppDataLock(directory),
    (error) => error.code === 'app_data_in_use',
  );

  child.kill('SIGKILL');
  await once(child, 'exit');

  const recovered = acquireAppDataLock(directory);
  recovered.release();
});
