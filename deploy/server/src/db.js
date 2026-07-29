'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { applyMigrations } = require('./migrations');

const DEFAULT_OUTLETS = JSON.stringify([
  { id: 1, label: 'Outlet 1', type: 'None' },
  { id: 2, label: 'Outlet 2', type: 'None' },
  { id: 3, label: 'Outlet 3', type: 'None' },
  { id: 4, label: 'Outlet 4', type: 'None' },
]);

function openDatabase(dbPath, { clock, migrationsDir } = {}) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  try {
    db.pragma('foreign_keys = ON');
    const migrationState = applyMigrations(db, { dbPath, migrationsDir, clock });
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');

    const stmts = {
      // Compatibility aliases keep the current bench API running while storage uses
      // the CE domain vocabulary established for subsequent implementation phases.
      upsertDevice: db.prepare(`
        INSERT INTO devices (
          id, reported_name, ip_address, firmware_version,
          last_seen_at, created_at, updated_at
        ) VALUES (
          @id, @name, @ip, @fw, @last_seen, @last_seen, @last_seen
        )
        ON CONFLICT(id) DO UPDATE SET
          reported_name    = COALESCE(excluded.reported_name, reported_name),
          ip_address       = COALESCE(excluded.ip_address, ip_address),
          firmware_version = COALESCE(excluded.firmware_version, firmware_version),
          last_seen_at     = excluded.last_seen_at,
          updated_at       = excluded.updated_at
      `),
      ensureDevice: db.prepare(`
        INSERT INTO devices (id, created_at, updated_at)
        VALUES (@id, @observed_at, @observed_at)
        ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
      `),
      getDevice: db.prepare(`
        SELECT id,
          COALESCE(display_name, reported_name) AS name,
          display_name,
          reported_name,
          ip_address AS ip,
          firmware_version AS fw,
          last_seen_at AS last_seen,
          outlet_state_json AS outlets,
          presence_status,
          presence_received_at,
          current_mode,
          hidden
        FROM devices WHERE id = ?
      `),
      getAllDevices: db.prepare(`
        SELECT id,
          COALESCE(display_name, reported_name) AS name,
          display_name,
          reported_name,
          ip_address AS ip,
          firmware_version AS fw,
          last_seen_at AS last_seen,
          outlet_state_json AS outlets,
          presence_status,
          presence_received_at,
          current_mode,
          hidden
        FROM devices
        ORDER BY hidden ASC, COALESCE(display_name, reported_name, id) COLLATE NOCASE ASC
      `),
      getKnownDeviceIds: db.prepare(`
        SELECT id FROM devices ORDER BY id ASC
      `),
      getDeviceOutlets: db.prepare(`
        SELECT outlet_state_json AS outlets FROM devices WHERE id = ?
      `),
      setMirroredDeviceOutlets: db.prepare(`
        UPDATE devices
        SET outlet_state_json = @outlet_state_json, updated_at = @updated_at
        WHERE id = @device_id
      `),
      setMirroredDevicePresence: db.prepare(`
        UPDATE devices
        SET presence_status = @presence_status,
            presence_received_at = @presence_received_at,
            updated_at = @updated_at
        WHERE id = @device_id
      `),
      setMirroredDeviceMode: db.prepare(`
        UPDATE devices
        SET current_mode = @current_mode, updated_at = @updated_at
        WHERE id = @device_id
      `),

      getDeviceStateMirror: db.prepare(`
        SELECT device_id, state_key, schema_version, normalized_json, raw_json,
          received_at, revision, mqtt_retained, compatible, compatibility_reason
        FROM device_state_mirrors
        WHERE device_id = ? AND state_key = ?
      `),
      getDeviceStateMirrors: db.prepare(`
        SELECT device_id, state_key, schema_version, normalized_json, raw_json,
          received_at, revision, mqtt_retained, compatible, compatibility_reason
        FROM device_state_mirrors
        WHERE device_id = ?
        ORDER BY state_key ASC
      `),
      upsertDeviceStateMirror: db.prepare(`
        INSERT INTO device_state_mirrors (
          device_id, state_key, schema_version, normalized_json, raw_json,
          received_at, revision, mqtt_retained, compatible, compatibility_reason
        ) VALUES (
          @device_id, @state_key, @schema_version, @normalized_json, @raw_json,
          @received_at, 1, @mqtt_retained, @compatible, @compatibility_reason
        )
        ON CONFLICT(device_id, state_key) DO UPDATE SET
          schema_version       = excluded.schema_version,
          normalized_json      = excluded.normalized_json,
          raw_json             = excluded.raw_json,
          received_at          = excluded.received_at,
          revision             = device_state_mirrors.revision + 1,
          mqtt_retained        = excluded.mqtt_retained,
          compatible           = excluded.compatible,
          compatibility_reason = excluded.compatibility_reason
        RETURNING revision
      `),
      getDeviceErrorMirror: db.prepare(`
        SELECT device_id, error_key, normalized_json, raw_json, received_at, sequence
        FROM device_error_mirrors
        WHERE device_id = ? AND error_key = ?
      `),
      getDeviceErrorMirrors: db.prepare(`
        SELECT device_id, error_key, normalized_json, raw_json, received_at, sequence
        FROM device_error_mirrors
        WHERE device_id = ?
        ORDER BY error_key ASC
      `),
      upsertDeviceErrorMirror: db.prepare(`
        INSERT INTO device_error_mirrors (
          device_id, error_key, normalized_json, raw_json, received_at, sequence
        ) VALUES (
          @device_id, @error_key, @normalized_json, @raw_json, @received_at, 1
        )
        ON CONFLICT(device_id, error_key) DO UPDATE SET
          normalized_json = excluded.normalized_json,
          raw_json        = excluded.raw_json,
          received_at     = excluded.received_at,
          sequence        = device_error_mirrors.sequence + 1
        RETURNING sequence
      `),
      insertRetainedStateIncident: db.prepare(`
        INSERT INTO retained_state_incidents (
          device_id, state_key, started_at, escalated_at
        )
        SELECT @device_id, @state_key, @started_at, @escalated_at
        WHERE NOT EXISTS (
          SELECT 1 FROM retained_state_incidents
          WHERE device_id = @device_id
            AND state_key = @state_key
            AND resolved_at IS NULL
        )
      `),
      resolveRetainedStateIncident: db.prepare(`
        UPDATE retained_state_incidents
        SET resolved_at = @resolved_at
        WHERE device_id = @device_id
          AND state_key = @state_key
          AND resolved_at IS NULL
      `),
      getActiveRetainedStateIncidents: db.prepare(`
        SELECT id, device_id, state_key, started_at, escalated_at, resolved_at
        FROM retained_state_incidents
        WHERE device_id = ? AND resolved_at IS NULL
        ORDER BY state_key ASC
      `),
      getAllActiveRetainedStateIncidents: db.prepare(`
        SELECT id, device_id, state_key, started_at, escalated_at, resolved_at
        FROM retained_state_incidents
        WHERE resolved_at IS NULL
        ORDER BY device_id ASC, state_key ASC
      `),
      getResolvedRetainedStateIncidents: db.prepare(`
        SELECT id, device_id, state_key, started_at, escalated_at, resolved_at
        FROM retained_state_incidents
        WHERE device_id = ? AND resolved_at IS NOT NULL
        ORDER BY resolved_at DESC, id DESC
        LIMIT 50
      `),
      deleteOldResolvedRetainedStateIncidents: db.prepare(`
        DELETE FROM retained_state_incidents
        WHERE resolved_at IS NOT NULL AND resolved_at < ?
      `),
      trimResolvedRetainedStateIncidents: db.prepare(`
        DELETE FROM retained_state_incidents
        WHERE device_id = @device_id
          AND resolved_at IS NOT NULL
          AND id NOT IN (
            SELECT id FROM retained_state_incidents
            WHERE device_id = @device_id AND resolved_at IS NOT NULL
            ORDER BY resolved_at DESC, id DESC
            LIMIT 50
          )
      `),

      insertMeasurement: db.prepare(`
        INSERT INTO sensor_measurements (
          device_id, observed_at, temperature_c, humidity_rh, light_level,
          co2_ppm, actuator_summary, firmware_version
        ) VALUES (
          @device_id, @taken_at, @temp, @humidity, @light,
          @co2, @actuator, @fw
        )
      `),
      getMeasurementsInRange: db.prepare(`
        SELECT
          observed_at AS taken_at,
          temperature_c AS temp,
          humidity_rh AS humidity,
          light_level AS light,
          co2_ppm AS co2,
          actuator_summary AS actuator
        FROM sensor_measurements
        WHERE device_id = ? AND observed_at >= ? AND observed_at <= ?
        ORDER BY observed_at ASC
      `),
      deleteOldMeasurements: db.prepare(`
        DELETE FROM sensor_measurements WHERE observed_at < ?
      `),

      insertAlarm: db.prepare(`
        INSERT INTO device_alerts (device_id, type, message, severity, created_at)
        VALUES (@device_id, @type, @message, @severity, @created_at)
      `),
      hasUnreadAlarmOfType: db.prepare(`
        SELECT 1 FROM device_alerts
        WHERE device_id = ? AND type = ? AND acknowledged_at IS NULL
        LIMIT 1
      `),
      getAllAlarms: db.prepare(`
        SELECT id, device_id, type, message, severity,
          CASE WHEN acknowledged_at IS NULL THEN 0 ELSE 1 END AS read,
          created_at
        FROM device_alerts
        ORDER BY created_at DESC LIMIT 200
      `),
      markAllAlarmsRead: db.prepare(`
        UPDATE device_alerts
        SET acknowledged_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
        WHERE acknowledged_at IS NULL
      `),
      resolveAlarmType: db.prepare(`
        UPDATE device_alerts
        SET acknowledged_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
        WHERE device_id = ? AND type = ? AND acknowledged_at IS NULL
      `),

      getAllSchedules: db.prepare(`
        SELECT id, name, description, editor_state_json AS settings, revision, status
        FROM schedule_templates ORDER BY id ASC
      `),
      getSchedule: db.prepare(`
        SELECT id, name, description, editor_state_json AS settings, revision, status
        FROM schedule_templates WHERE id = ?
      `),
      createSchedule: db.prepare(`
        INSERT INTO schedule_templates (
          name, description, editor_state_json, created_at, updated_at
        ) VALUES (
          @name, @description, @settings,
          CAST(strftime('%s', 'now') AS INTEGER) * 1000,
          CAST(strftime('%s', 'now') AS INTEGER) * 1000
        )
      `),
      updateSchedule: db.prepare(`
        UPDATE schedule_templates
        SET name = @name,
            description = @description,
            editor_state_json = @settings,
            revision = revision + 1,
            updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
        WHERE id = @id
      `),
      deleteSchedule: db.prepare(`DELETE FROM schedule_templates WHERE id = ?`),

      getActiveInstance: db.prepare(`
        SELECT device_id,
          matched_template_id AS schedule_id,
          matched_template_name AS schedule_name,
          editor_snapshot_json AS schedule_settings,
          active_schedule_json,
          source,
          observed_at AS started_at
        FROM device_active_schedule_mirrors WHERE device_id = ?
      `),
      getAllInstances: db.prepare(`
        SELECT m.device_id,
          m.matched_template_id AS schedule_id,
          COALESCE(t.name, m.matched_template_name) AS schedule_name,
          COALESCE(t.editor_state_json, m.editor_snapshot_json) AS schedule_settings,
          m.active_schedule_json,
          m.source,
          m.observed_at AS started_at
        FROM device_active_schedule_mirrors m
        LEFT JOIN schedule_templates t ON t.id = m.matched_template_id
      `),
      getInstancesBySchedule: db.prepare(`
        SELECT device_id FROM device_active_schedule_mirrors
        WHERE matched_template_id = ?
      `),
      upsertInstance: db.prepare(`
        INSERT INTO device_active_schedule_mirrors (
          device_id, matched_template_id, matched_template_name,
          editor_snapshot_json, active_schedule_json, source, observed_at
        ) VALUES (
          @device_id, @schedule_id, @schedule_name,
          @schedule_settings, @active_schedule_json, @source, @started_at
        )
        ON CONFLICT(device_id) DO UPDATE SET
          matched_template_id   = excluded.matched_template_id,
          matched_template_name = excluded.matched_template_name,
          editor_snapshot_json  = excluded.editor_snapshot_json,
          active_schedule_json  = excluded.active_schedule_json,
          source                = excluded.source,
          observed_at           = excluded.observed_at
      `),
      deleteInstance: db.prepare(`
        DELETE FROM device_active_schedule_mirrors WHERE device_id = ?
      `),
      deleteInstanceBySchedule: db.prepare(`
        DELETE FROM device_active_schedule_mirrors WHERE matched_template_id = ?
      `),

      getSetting: db.prepare(`SELECT value FROM app_settings WHERE key = ?`),
      getAllSettings: db.prepare(`SELECT key, value FROM app_settings`),
      setSetting: db.prepare(`
        INSERT INTO app_settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `),

      getAdmin: db.prepare(`
        SELECT id, username, password_verifier, created_at, updated_at
        FROM admin_credentials WHERE id = 1
      `),
      insertAdmin: db.prepare(`
        INSERT INTO admin_credentials (
          id, username, password_verifier, created_at, updated_at
        ) VALUES (1, @username, @password_verifier, @created_at, @updated_at)
      `),
      updateAdminUsername: db.prepare(`
        UPDATE admin_credentials
        SET username = @username, updated_at = @updated_at
        WHERE id = 1 AND password_verifier = @expected_password_verifier
      `),
      updateAdminPassword: db.prepare(`
        UPDATE admin_credentials
        SET password_verifier = @password_verifier, updated_at = @updated_at
        WHERE id = 1 AND password_verifier = @expected_password_verifier
      `),
      insertAuthSession: db.prepare(`
        INSERT INTO auth_sessions (
          id_hash, admin_id, csrf_hash, created_at, last_seen_at, expires_at
        ) VALUES (
          @id_hash, 1, @csrf_hash, @created_at, @last_seen_at, @expires_at
        )
      `),
      getAuthSession: db.prepare(`
        SELECT s.id_hash, s.csrf_hash, s.created_at, s.last_seen_at,
          s.expires_at, s.revoked_at, a.id AS admin_id, a.username
        FROM auth_sessions s
        JOIN admin_credentials a ON a.id = s.admin_id
        WHERE s.id_hash = ?
      `),
      touchAuthSession: db.prepare(`
        UPDATE auth_sessions
        SET last_seen_at = @last_seen_at, expires_at = @expires_at
        WHERE id_hash = @id_hash AND revoked_at IS NULL
      `),
      rotateAuthSessionCsrf: db.prepare(`
        UPDATE auth_sessions
        SET csrf_hash = @csrf_hash, last_seen_at = @last_seen_at, expires_at = @expires_at
        WHERE id_hash = @id_hash AND revoked_at IS NULL
      `),
      revokeAuthSession: db.prepare(`
        UPDATE auth_sessions SET revoked_at = @revoked_at
        WHERE id_hash = @id_hash AND revoked_at IS NULL
      `),
      revokeAllAuthSessions: db.prepare(`
        UPDATE auth_sessions SET revoked_at = @revoked_at
        WHERE revoked_at IS NULL
      `),
      pruneAuthSessions: db.prepare(`
        DELETE FROM auth_sessions
        WHERE expires_at <= @now OR revoked_at IS NOT NULL
      `),

      insertAuthSecurityEvent: db.prepare(`
        INSERT INTO auth_security_events (
          type, client_ip, admin_identity, category, reason,
          first_at, last_at, count
        ) VALUES (
          @type, @client_ip, @admin_identity, @category, @reason,
          @first_at, @last_at, @count
        )
      `),
      getLatestThrottleEvent: db.prepare(`
        SELECT id, first_at, last_at, count
        FROM auth_security_events
        WHERE type = 'rate_limit_throttled'
          AND client_ip IS @client_ip
          AND category = @category
        ORDER BY last_at DESC, id DESC
        LIMIT 1
      `),
      updateThrottleEvent: db.prepare(`
        UPDATE auth_security_events
        SET last_at = @last_at, count = @count
        WHERE id = @id
      `),
      deleteOldAuthSecurityEvents: db.prepare(`
        DELETE FROM auth_security_events WHERE last_at < ?
      `),
      trimAuthSecurityEvents: db.prepare(`
        DELETE FROM auth_security_events
        WHERE id NOT IN (
          SELECT id FROM auth_security_events
          ORDER BY last_at DESC, id DESC LIMIT 100
        )
      `),
      getAuthSecurityEvents: db.prepare(`
        SELECT id, type, client_ip, admin_identity, category, reason,
          first_at, last_at, count
        FROM auth_security_events
        ORDER BY last_at DESC, id DESC
        LIMIT 100
      `),

      insertEvent: db.prepare(`
        INSERT INTO grow_events (
          device_id, template_id, type, phase, label, notes, occurred_at, created_at
        ) VALUES (
          @device_id, @schedule_id, @type, @phase, @label, @notes, @occurred_at, @created_at
        )
      `),
      getEvents: db.prepare(`
        SELECT id, device_id, template_id AS schedule_id, type, phase, label,
          notes, occurred_at, created_at
        FROM grow_events WHERE device_id = ?
        ORDER BY occurred_at DESC LIMIT 500
      `),
      getEventsInRange: db.prepare(`
        SELECT id, device_id, template_id AS schedule_id, type, phase, label,
          notes, occurred_at, created_at
        FROM grow_events
        WHERE device_id = ? AND occurred_at >= ? AND occurred_at <= ?
        ORDER BY occurred_at ASC
      `),
      getEvent: db.prepare(`
        SELECT id, device_id, template_id AS schedule_id, type, phase, label,
          notes, occurred_at, created_at
        FROM grow_events WHERE id = ?
      `),
      updateEvent: db.prepare(`
        UPDATE grow_events SET label = @label, notes = @notes, occurred_at = @occurred_at
        WHERE id = @id
          AND type NOT IN ('schedule_loaded','schedule_removed','device_online','device_offline')
      `),
      deleteEvent: db.prepare(`
        DELETE FROM grow_events
        WHERE id = ?
          AND type NOT IN ('schedule_loaded','schedule_removed','device_online','device_offline')
      `),
      getCurrentPhase: db.prepare(`
        SELECT phase FROM grow_events
        WHERE device_id = ? AND type = 'phase_change' AND phase IS NOT NULL
        ORDER BY occurred_at DESC LIMIT 1
      `),
    };

    function close() {
      if (!db.open) return;
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch (_) {}
      db.close();
    }

    return { db, stmts, DEFAULT_OUTLETS, migrationState, close };
  } catch (error) {
    try {
      if (db.open) db.close();
    } catch (_) {}
    throw error;
  }
}

module.exports = { DEFAULT_OUTLETS, openDatabase };
