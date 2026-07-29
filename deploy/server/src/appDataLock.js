'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const LOCK_FILE_NAME = '.growhub-command-center.lock.sqlite';

class AppDataLockError extends Error {
  constructor(message, { cause, lockPath } = {}) {
    super(message, { cause });
    this.name = 'AppDataLockError';
    this.code = 'app_data_in_use';
    this.expose = true;
    this.lockPath = lockPath;
  }
}

function isLockContention(error) {
  return error?.code === 'SQLITE_BUSY' || error?.code === 'SQLITE_LOCKED';
}

function acquireAppDataLock(appDataDir) {
  fs.mkdirSync(appDataDir, { recursive: true });
  const lockPath = path.join(appDataDir, LOCK_FILE_NAME);
  let db;

  try {
    db = new Database(lockPath, { timeout: 0 });
    db.pragma('busy_timeout = 0');
    db.pragma('journal_mode = DELETE');
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_data_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1)
      );
    `);
    db.exec('BEGIN EXCLUSIVE');
  } catch (error) {
    try {
      db?.close();
    } catch (_) {}
    if (isLockContention(error)) {
      throw new AppDataLockError(
        `Another Command Center process already owns app data at ${appDataDir}. Stop that process before starting another instance.`,
        { cause: error, lockPath },
      );
    }
    throw error;
  }

  let released = false;
  return Object.freeze({
    lockPath,
    release() {
      if (released) return;
      released = true;
      try {
        if (db.inTransaction) db.exec('ROLLBACK');
      } finally {
        if (db.open) db.close();
      }
    },
  });
}

module.exports = {
  AppDataLockError,
  LOCK_FILE_NAME,
  acquireAppDataLock,
};
