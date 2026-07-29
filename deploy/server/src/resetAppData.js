'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { acquireAppDataLock } = require('./appDataLock');
const { loadConfig } = require('./config');
const { SESSION_SECRET_FILE } = require('./sessionSecret');

function databaseFiles(dbPath) {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`];
}

function appDataFiles(appDataDir, dbPath) {
  return [...databaseFiles(dbPath), path.join(appDataDir, SESSION_SECRET_FILE)];
}

function resetAppData({
  appDataDir,
  dbPath,
  acquireLock = acquireAppDataLock,
  fileSystem = fs,
} = {}) {
  if (!appDataDir || !dbPath || dbPath === ':memory:') {
    throw new Error('A persistent database inside APP_DATA_DIR is required for reset.');
  }

  const relative = path.relative(appDataDir, dbPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Refusing to reset a database outside APP_DATA_DIR.');
  }

  const appDataLock = acquireLock(appDataDir);
  const removed = [];
  try {
    for (const filename of appDataFiles(appDataDir, dbPath)) {
      if (!fileSystem.existsSync(filename)) continue;
      fileSystem.rmSync(filename, { force: true });
      removed.push(filename);
    }
  } finally {
    appDataLock.release();
  }

  return Object.freeze({ dbPath, removed: Object.freeze(removed) });
}

function main(argv = process.argv.slice(2), env = process.env) {
  const config = loadConfig(env);
  if (!argv.includes('--yes')) {
    process.stderr.write(
      `Refusing to delete development data without confirmation. Run \`npm run reset:dev -- --yes\` to remove ${config.dbPath} and its SQLite sidecars.\n`,
    );
    return 2;
  }

  const result = resetAppData(config);
  process.stdout.write(
    `Reset complete. Removed ${result.removed.length} app-data file(s) from ${config.appDataDir}. The next start will apply all migrations and require admin setup.\n`,
  );
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { appDataFiles, databaseFiles, main, resetAppData };
