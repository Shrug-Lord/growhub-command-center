'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_FILE = /^(\d{3})_([a-z0-9_]+)\.sql$/;

class LegacySchemaError extends Error {
  constructor(dbPath, tableCount) {
    super(
      `Legacy bench database detected at ${dbPath}. It was not modified. For native development run \`npm run reset:dev -- --yes\`; for Docker Compose run \`npm run compose:reset -- --yes\`.`,
    );
    this.name = 'LegacySchemaError';
    this.code = 'legacy_schema_requires_reset';
    this.expose = true;
    this.tableCount = tableCount;
  }
}

class SchemaMigrationError extends Error {
  constructor(message, { cause, version } = {}) {
    super(message, { cause });
    this.name = 'SchemaMigrationError';
    this.code = 'schema_migration_failed';
    this.expose = true;
    this.version = version;
  }
}

function checksum(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

function loadMigrations(migrationsDir) {
  const migrations = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => {
      const match = MIGRATION_FILE.exec(entry.name);
      if (!match) {
        throw new SchemaMigrationError(
          `Invalid migration filename ${entry.name}; expected NNN_lowercase_name.sql.`,
        );
      }
      const sql = fs
        .readFileSync(path.join(migrationsDir, entry.name), 'utf8')
        .replace(/\r\n?/g, '\n');
      return {
        version: Number(match[1]),
        name: match[2],
        filename: entry.name,
        sql,
        checksum: checksum(sql),
      };
    })
    .sort((a, b) => a.version - b.version);

  if (migrations.length === 0) {
    throw new SchemaMigrationError(`No migrations found in ${migrationsDir}.`);
  }

  migrations.forEach((migration, index) => {
    const expected = index + 1;
    if (migration.version !== expected) {
      throw new SchemaMigrationError(
        `Migration sequence must be contiguous from 001; expected ${String(expected).padStart(3, '0')} but found ${migration.filename}.`,
      );
    }
  });

  return migrations;
}

function userTables(db) {
  return db
    .prepare(
      `
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `,
    )
    .all()
    .map((row) => row.name);
}

function ensureMigrationTable(db, dbPath) {
  const tables = userTables(db);
  if (tables.length > 0 && !tables.includes('schema_migrations')) {
    throw new LegacySchemaError(dbPath, tables.length);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
}

function validateAppliedMigrations(applied, migrations) {
  if (applied.length > migrations.length) {
    throw new SchemaMigrationError(
      `Database schema version ${applied.at(-1).version} is newer than this Command Center build.`,
    );
  }

  for (const [index, row] of applied.entries()) {
    if (row.version !== index + 1) {
      throw new SchemaMigrationError(
        'Applied database migrations are not a contiguous sequence from version 001.',
      );
    }
    const expected = migrations[row.version - 1];
    if (!expected || row.name !== expected.name || row.checksum !== expected.checksum) {
      throw new SchemaMigrationError(
        `Applied migration ${String(row.version).padStart(3, '0')} does not match this Command Center build. Restore the original migration files or reset development data.`,
        { version: row.version },
      );
    }
  }
}

function applyMigrations(
  db,
  { dbPath, migrationsDir = path.join(__dirname, '../migrations'), clock = () => Date.now() } = {},
) {
  const migrations = loadMigrations(migrationsDir);
  ensureMigrationTable(db, dbPath);

  const applied = db
    .prepare(
      `
    SELECT version, name, checksum
    FROM schema_migrations
    ORDER BY version
  `,
    )
    .all();
  validateAppliedMigrations(applied, migrations);

  const insertMigration = db.prepare(`
    INSERT INTO schema_migrations (version, name, checksum, applied_at)
    VALUES (@version, @name, @checksum, @applied_at)
  `);

  for (const migration of migrations.slice(applied.length)) {
    try {
      db.exec('BEGIN IMMEDIATE');
      db.exec(migration.sql);
      insertMigration.run({
        version: migration.version,
        name: migration.name,
        checksum: migration.checksum,
        applied_at: clock(),
      });
      db.pragma(`user_version = ${migration.version}`);
      db.exec('COMMIT');
    } catch (error) {
      try {
        if (db.inTransaction) db.exec('ROLLBACK');
      } catch (_) {}
      throw new SchemaMigrationError(`Failed to apply database migration ${migration.filename}.`, {
        cause: error,
        version: migration.version,
      });
    }
  }

  const foreignKeyViolations = db.pragma('foreign_key_check');
  if (foreignKeyViolations.length > 0) {
    throw new SchemaMigrationError('Database foreign-key validation failed after migration.');
  }

  return Object.freeze({
    currentVersion: migrations.length,
    appliedCount: migrations.length - applied.length,
  });
}

module.exports = {
  LegacySchemaError,
  SchemaMigrationError,
  applyMigrations,
  loadMigrations,
};
