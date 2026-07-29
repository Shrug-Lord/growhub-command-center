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

function waitForOutput(child, expected, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let output = '';
    let errorOutput = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for child output: ${expected.trim()}`));
    }, timeoutMs);
    function onData(chunk) {
      output += chunk.toString();
      if (!output.includes(expected)) return;
      cleanup();
      resolve(output);
    }
    function onErrorData(chunk) {
      errorOutput += chunk.toString();
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    function onExit(code, signal) {
      cleanup();
      reject(
        new Error(
          `Child exited before producing expected output (code=${code}, signal=${signal}): ${errorOutput.trim()}`,
        ),
      );
    }
    function cleanup() {
      clearTimeout(timeout);
      child.stdout.off('data', onData);
      child.stderr.off('data', onErrorData);
      child.off('error', onError);
      child.off('exit', onExit);
    }
    child.stdout.on('data', onData);
    child.stderr.on('data', onErrorData);
    child.on('error', onError);
    child.on('exit', onExit);
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

  await waitForOutput(child, 'locked\n');
  assert.throws(
    () => acquireAppDataLock(directory),
    (error) => error.code === 'app_data_in_use',
  );

  const childExit = once(child, 'exit');
  child.kill('SIGKILL');
  await childExit;

  const recovered = acquireAppDataLock(directory);
  recovered.release();
});
