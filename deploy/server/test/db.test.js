'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { openDatabase } = require('../src/db');
const { LegacySchemaError, SchemaMigrationError } = require('../src/migrations');

function temporaryDirectory(t, prefix = 'growhub-db-test-') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function copyMigrations(t) {
  const directory = temporaryDirectory(t, 'growhub-migrations-test-');
  for (const name of [
    '001_runtime_foundation.sql',
    '002_authentication.sql',
    '003_firmware_mirror.sql',
    '004_device_actions.sql',
    '005_templates_and_drift.sql',
    '006_release_updates.sql',
  ]) {
    const source = path.join(__dirname, `../migrations/${name}`);
    fs.copyFileSync(source, path.join(directory, name));
  }
  return directory;
}

test('fresh database applies the CE domain baseline exactly once', (t) => {
  const dbPath = path.join(temporaryDirectory(t), 'growhub.db');
  const database = openDatabase(dbPath, { clock: () => 123_456 });

  assert.deepEqual(database.migrationState, { currentVersion: 6, appliedCount: 6 });
  assert.equal(database.stmts.getSetting.get('retention_days').value, '365');
  assert.deepEqual(database.stmts.getAllDevices.all(), []);
  assert.equal(database.db.pragma('user_version', { simple: true }), 6);
  assert.deepEqual(
    database.db
      .prepare(
        `
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'schedule_templates', 'schedule_template_roles',
        'device_active_schedule_mirrors', 'device_expected_schedules'
      ) ORDER BY name
    `,
      )
      .all()
      .map((row) => row.name),
    [
      'device_active_schedule_mirrors',
      'device_expected_schedules',
      'schedule_template_roles',
      'schedule_templates',
    ],
  );
  assert.equal(
    database.db
      .prepare(
        `
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name IN ('schedule_instances', 'grow_recipes')
    `,
      )
      .get().count,
    0,
  );
  assert.deepEqual(
    database.db
      .prepare(
        `
    SELECT version, name, applied_at, length(checksum) AS checksum_length
    FROM schema_migrations ORDER BY version
  `,
      )
      .all(),
    [
      {
        version: 1,
        name: 'runtime_foundation',
        applied_at: 123_456,
        checksum_length: 64,
      },
      {
        version: 2,
        name: 'authentication',
        applied_at: 123_456,
        checksum_length: 64,
      },
      {
        version: 3,
        name: 'firmware_mirror',
        applied_at: 123_456,
        checksum_length: 64,
      },
      {
        version: 4,
        name: 'device_actions',
        applied_at: 123_456,
        checksum_length: 64,
      },
      {
        version: 5,
        name: 'templates_and_drift',
        applied_at: 123_456,
        checksum_length: 64,
      },
      {
        version: 6,
        name: 'release_updates',
        applied_at: 123_456,
        checksum_length: 64,
      },
    ],
  );
  assert.deepEqual(
    database.db
      .prepare(
        `
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN (
      'admin_credentials', 'auth_sessions', 'auth_security_events'
    ) ORDER BY name
  `,
      )
      .all()
      .map((row) => row.name),
    ['admin_credentials', 'auth_security_events', 'auth_sessions'],
  );

  database.close();
  assert.equal(database.db.open, false);
  database.close();

  const reopened = openDatabase(dbPath);
  assert.deepEqual(reopened.migrationState, { currentVersion: 6, appliedCount: 0 });
  reopened.close();
});

test('runtime statements operate against the CE domain tables', () => {
  const database = openDatabase(':memory:');
  const { stmts } = database;
  const now = 1_000;

  stmts.upsertDevice.run({
    id: 'AABBCCDDEEFF',
    name: 'Bench Growhub',
    ip: '192.0.2.10',
    fw: '1.1.0C',
    last_seen: now,
  });
  assert.equal(stmts.getDevice.get('AABBCCDDEEFF').fw, '1.1.0C');

  stmts.insertMeasurement.run({
    device_id: 'AABBCCDDEEFF',
    taken_at: now,
    temp: 24.5,
    humidity: 55,
    light: 100,
    co2: 800,
    actuator: '0000',
    fw: '1.1.0C',
  });
  assert.deepEqual(stmts.getMeasurementsInRange.all('AABBCCDDEEFF', 0, 2_000), [
    {
      taken_at: now,
      temp: 24.5,
      humidity: 55,
      light: 100,
      co2: 800,
      actuator: '0000',
    },
  ]);

  const scheduleInfo = stmts.createSchedule.run({
    name: 'Flower',
    description: 'Bench draft',
    settings: '{}',
  });
  const schedule = stmts.getSchedule.get(scheduleInfo.lastInsertRowid);
  stmts.upsertInstance.run({
    device_id: 'AABBCCDDEEFF',
    schedule_id: schedule.id,
    schedule_name: schedule.name,
    schedule_settings: schedule.settings,
    active_schedule_json: '{"v":3,"outlets":[]}',
    source: 'command_center',
    started_at: now,
  });
  assert.equal(stmts.getActiveInstance.get('AABBCCDDEEFF').schedule_name, 'Flower');

  stmts.insertAlarm.run({
    device_id: 'AABBCCDDEEFF',
    type: 'temp_high',
    message: 'Temperature too high',
    severity: 'warning',
    created_at: now,
  });
  assert.equal(stmts.hasUnreadAlarmOfType.get('AABBCCDDEEFF', 'temp_high')[1], 1);

  stmts.insertEvent.run({
    device_id: 'AABBCCDDEEFF',
    schedule_id: schedule.id,
    type: 'schedule_loaded',
    phase: null,
    label: 'Flower loaded',
    notes: null,
    occurred_at: now,
    created_at: now,
  });
  assert.equal(stmts.getEvents.all('AABBCCDDEEFF')[0].schedule_id, schedule.id);

  database.close();
});

test('resolved retained-state incidents are bounded by age and per-device count', () => {
  const database = openDatabase(':memory:');
  const { stmts } = database;
  const now = Date.parse('2026-07-13T12:00:00.000Z');
  stmts.ensureDevice.run({ id: 'AABBCCDDEEFF', observed_at: now });

  for (let index = 0; index < 55; index += 1) {
    const timestamp = now - index * 1_000;
    stmts.insertRetainedStateIncident.run({
      device_id: 'AABBCCDDEEFF',
      state_key: 'presence_state',
      started_at: timestamp,
      escalated_at: timestamp,
    });
    stmts.resolveRetainedStateIncident.run({
      device_id: 'AABBCCDDEEFF',
      state_key: 'presence_state',
      resolved_at: timestamp,
    });
  }
  stmts.trimResolvedRetainedStateIncidents.run({ device_id: 'AABBCCDDEEFF' });
  assert.equal(stmts.getResolvedRetainedStateIncidents.all('AABBCCDDEEFF').length, 50);

  const old = now - 31 * 86_400_000;
  stmts.insertRetainedStateIncident.run({
    device_id: 'AABBCCDDEEFF',
    state_key: 'schedule_state',
    started_at: old,
    escalated_at: old,
  });
  stmts.resolveRetainedStateIncident.run({
    device_id: 'AABBCCDDEEFF',
    state_key: 'schedule_state',
    resolved_at: old,
  });
  stmts.deleteOldResolvedRetainedStateIncidents.run(now - 30 * 86_400_000);
  assert.equal(
    database.db
      .prepare(
        `
      SELECT COUNT(*) AS count FROM retained_state_incidents
      WHERE device_id = ? AND resolved_at < ?
    `,
      )
      .get('AABBCCDDEEFF', now - 30 * 86_400_000).count,
    0,
  );
  database.close();
});

test('legacy bench schema is refused without changing or deleting its data', (t) => {
  const dbPath = path.join(temporaryDirectory(t), 'growhub.db');
  const legacy = new Database(dbPath);
  legacy.exec('CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT)');
  legacy.prepare('INSERT INTO devices (id, name) VALUES (?, ?)').run('bench-1', 'Bench');
  legacy.close();

  assert.throws(
    () => openDatabase(dbPath),
    (error) =>
      error instanceof LegacySchemaError &&
      error.code === 'legacy_schema_requires_reset' &&
      error.message.includes('npm run compose:reset -- --yes'),
  );

  const untouched = new Database(dbPath, { readonly: true });
  assert.deepEqual(untouched.prepare('SELECT * FROM devices').all(), [
    { id: 'bench-1', name: 'Bench' },
  ]);
  assert.equal(
    untouched
      .prepare(
        `
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name = 'schema_migrations'
    `,
      )
      .get().count,
    0,
  );
  untouched.close();
});

test('changed applied migration is rejected by checksum validation', (t) => {
  const dbPath = path.join(temporaryDirectory(t), 'growhub.db');
  const migrationsDir = copyMigrations(t);
  openDatabase(dbPath, { migrationsDir }).close();
  fs.appendFileSync(
    path.join(migrationsDir, '001_runtime_foundation.sql'),
    '\n-- changed after application\n',
  );

  assert.throws(
    () => openDatabase(dbPath, { migrationsDir }),
    (error) =>
      error instanceof SchemaMigrationError &&
      error.code === 'schema_migration_failed' &&
      error.version === 1,
  );
});

test('migration checksums are stable across platform line endings', (t) => {
  const dbPath = path.join(temporaryDirectory(t), 'growhub.db');
  const migrationsDir = copyMigrations(t);
  const migrationPath = path.join(migrationsDir, '001_runtime_foundation.sql');
  openDatabase(dbPath, { migrationsDir }).close();
  fs.writeFileSync(migrationPath, fs.readFileSync(migrationPath, 'utf8').replace(/\r?\n/g, '\r\n'));

  const reopened = openDatabase(dbPath, { migrationsDir });
  assert.deepEqual(reopened.migrationState, { currentVersion: 6, appliedCount: 0 });
  reopened.close();
});

test('failed migration rolls back its schema changes and version record', (t) => {
  const dbPath = path.join(temporaryDirectory(t), 'growhub.db');
  const migrationsDir = temporaryDirectory(t, 'growhub-broken-migration-test-');
  fs.writeFileSync(
    path.join(migrationsDir, '001_broken.sql'),
    'CREATE TABLE should_rollback (id INTEGER);\nTHIS IS NOT SQL;\n',
  );

  assert.throws(
    () => openDatabase(dbPath, { migrationsDir }),
    (error) => error instanceof SchemaMigrationError && error.version === 1,
  );

  const inspected = new Database(dbPath, { readonly: true });
  assert.equal(
    inspected
      .prepare(
        `
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name = 'should_rollback'
    `,
      )
      .get().count,
    0,
  );
  assert.equal(inspected.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 0);
  inspected.close();
});
