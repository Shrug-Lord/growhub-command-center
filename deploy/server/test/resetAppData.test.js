'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { acquireAppDataLock, LOCK_FILE_NAME } = require('../src/appDataLock');
const { SESSION_SECRET_FILE } = require('../src/sessionSecret');
const { appDataFiles, main, resetAppData } = require('../src/resetAppData');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'growhub-reset-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('development reset removes credentials, sessions, and the persistent session secret', (t) => {
  const appDataDir = temporaryDirectory(t);
  const dbPath = path.join(appDataDir, 'growhub.db');
  const unrelated = path.join(appDataDir, 'keep-me.txt');
  for (const filename of [...appDataFiles(appDataDir, dbPath), unrelated]) {
    fs.writeFileSync(filename, 'test');
  }

  const result = resetAppData({ appDataDir, dbPath });

  assert.deepEqual(result.removed, appDataFiles(appDataDir, dbPath));
  for (const filename of appDataFiles(appDataDir, dbPath)) {
    assert.equal(fs.existsSync(filename), false);
  }
  assert.equal(fs.existsSync(path.join(appDataDir, SESSION_SECRET_FILE)), false);
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'test');
  assert.equal(fs.existsSync(path.join(appDataDir, LOCK_FILE_NAME)), true);
});

test('development reset refuses to run while the app-data directory is owned', (t) => {
  const appDataDir = temporaryDirectory(t);
  const dbPath = path.join(appDataDir, 'growhub.db');
  fs.writeFileSync(dbPath, 'bench data');
  const lock = acquireAppDataLock(appDataDir);
  t.after(() => lock.release());

  assert.throws(
    () => resetAppData({ appDataDir, dbPath }),
    (error) => error.code === 'app_data_in_use',
  );
  assert.equal(fs.readFileSync(dbPath, 'utf8'), 'bench data');
});

test('development reset refuses database paths outside app data', (t) => {
  const parent = temporaryDirectory(t);
  assert.throws(
    () =>
      resetAppData({
        appDataDir: path.join(parent, 'data'),
        dbPath: path.join(parent, 'outside.db'),
      }),
    /outside APP_DATA_DIR/,
  );
});

test('development reset CLI requires explicit confirmation', (t) => {
  const appDataDir = temporaryDirectory(t);
  const dbPath = path.join(appDataDir, 'growhub.db');
  fs.writeFileSync(dbPath, 'bench data');
  const output = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk) => {
    output.push(String(chunk));
    return true;
  };
  t.after(() => {
    process.stderr.write = originalWrite;
  });

  const status = main([], {
    NODE_ENV: 'test',
    APP_DATA_DIR: appDataDir,
    DB_PATH: dbPath,
  });

  assert.equal(status, 2);
  assert.match(output.join(''), /without confirmation/);
  assert.equal(fs.readFileSync(dbPath, 'utf8'), 'bench data');
});
