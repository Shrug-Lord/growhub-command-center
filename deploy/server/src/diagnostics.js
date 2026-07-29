'use strict';

const STATE_TOPICS = Object.freeze({
  presence_state: 'status',
  outlet_state: 'outlets/state',
  schedule_state: 'schedule/state',
  sensor_state: 'sensor/live',
});

const ERROR_TOPICS = Object.freeze({
  schedule_error: 'schedule/error',
  outlet_error: 'outlets/error',
  time_error: 'time/error',
  control_error: 'control/error',
});

function parseJson(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function parseRaw(value) {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value);
  } catch (_) {
    return value;
  }
}

function asIso(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function deviceTopic(deviceId, suffix) {
  return suffix ? `growhub/${deviceId}/${suffix}` : null;
}

function safeBrokerConfig(config, exported) {
  let parsed;
  try {
    parsed = new URL(config.mqttUrl);
  } catch (_) {
    return { configured: true };
  }
  const base = {
    configured: true,
    protocol: parsed.protocol.replace(':', ''),
    port:
      parsed.port || (parsed.protocol === 'mqtts:' || parsed.protocol === 'wss:' ? '8883' : '1883'),
    tls: parsed.protocol === 'mqtts:' || parsed.protocol === 'wss:',
    credentials_configured: Boolean(parsed.username || parsed.password),
  };
  return exported ? base : { ...base, hostname: parsed.hostname };
}

function payloadDiff(expected, actual, path = '$', output = []) {
  if (output.length >= 500) return output;
  if (Object.is(expected, actual)) return output;
  const expectedArray = Array.isArray(expected);
  const actualArray = Array.isArray(actual);
  if (expectedArray || actualArray) {
    if (!expectedArray || !actualArray) {
      output.push({ path, expected, actual });
      return output;
    }
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length && output.length < 500; index += 1) {
      payloadDiff(expected[index], actual[index], `${path}[${index}]`, output);
    }
    return output;
  }
  const expectedObject = expected !== null && typeof expected === 'object';
  const actualObject = actual !== null && typeof actual === 'object';
  if (expectedObject || actualObject) {
    if (!expectedObject || !actualObject) {
      output.push({ path, expected, actual });
      return output;
    }
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) {
      if (output.length >= 500) break;
      payloadDiff(expected[key], actual[key], `${path}.${key}`, output);
    }
    return output;
  }
  output.push({ path, expected, actual });
  return output;
}

function createDiagnosticsService({
  database,
  mqttService,
  actionEngine,
  runtimeState,
  config,
  authSystem,
  logger,
  clock = () => Date.now(),
} = {}) {
  const { db, stmts, migrationState } = database;
  const sql = {
    pendingCounts: db.prepare(`
      SELECT device_id, COUNT(*) AS count FROM device_actions
      WHERE status = 'pending' GROUP BY device_id ORDER BY device_id ASC
    `),
    recentActions: db.prepare(`
      SELECT * FROM device_actions WHERE device_id = ?
      ORDER BY created_at DESC, id DESC LIMIT 100
    `),
    recentDeviceEvents: db.prepare(`
      SELECT * FROM device_events WHERE device_id = ?
      ORDER BY occurred_at DESC, id DESC LIMIT 100
    `),
    expectedSchedule: db.prepare(`
      SELECT * FROM device_expected_schedules WHERE device_id = ?
    `),
    activeDrift: db.prepare(`
      SELECT * FROM schedule_drift_episodes
      WHERE device_id = ? AND resolved_at IS NULL
    `),
  };

  function stateSnapshots(deviceId) {
    return stmts.getDeviceStateMirrors.all(deviceId).map((row) => ({
      key: row.state_key,
      topic: deviceTopic(deviceId, STATE_TOPICS[row.state_key]),
      retained: row.mqtt_retained === 1,
      compatible: row.compatible === 1,
      compatibility_reason: row.compatibility_reason,
      schema_version: row.schema_version,
      revision: row.revision,
      received_at: asIso(row.received_at),
      normalized: parseJson(row.normalized_json),
      raw: parseRaw(row.raw_json),
    }));
  }

  function errorSnapshots(deviceId) {
    return stmts.getDeviceErrorMirrors.all(deviceId).map((row) => ({
      key: row.error_key,
      topic: deviceTopic(deviceId, ERROR_TOPICS[row.error_key]),
      sequence: row.sequence,
      received_at: asIso(row.received_at),
      normalized: parseJson(row.normalized_json),
      raw: parseRaw(row.raw_json),
    }));
  }

  function incident(row, now = clock()) {
    const end = row.resolved_at ?? now;
    return {
      id: row.id,
      device_id: row.device_id,
      state_key: row.state_key,
      topic: deviceTopic(row.device_id, STATE_TOPICS[row.state_key]),
      started_at: asIso(row.started_at),
      escalated_at: asIso(row.escalated_at),
      resolved_at: asIso(row.resolved_at),
      duration_ms: Math.max(0, end - row.started_at),
    };
  }

  function detailedAction(row) {
    return {
      ...actionEngine.formatAction(row),
      request_id: row.request_id,
      input: parseJson(row.input_json, {}),
      confirmation: parseJson(row.confirmation_json),
      required_state_keys: parseJson(row.required_state_keys_json, []),
      base_state_revisions: parseJson(row.base_state_revisions_json, {}),
      base_error_sequences: parseJson(row.base_error_sequences_json, {}),
      publish: {
        topic: row.publish_topic,
        state: row.publish_state,
        submitted_at: asIso(row.submitted_at),
        acknowledged_at: asIso(row.acknowledged_at),
      },
    };
  }

  function expectedSchedule(deviceId) {
    const row = sql.expectedSchedule.get(deviceId);
    if (!row) return null;
    return {
      device_id: row.device_id,
      template_id: row.template_id,
      template_name: row.template_name,
      template_revision: row.template_revision,
      template_revision_id: row.template_revision_id,
      expected_fingerprint: row.expected_fingerprint,
      established_at: asIso(row.established_at),
      source_action_id: row.source_action_id,
      schedule: parseJson(row.expected_schedule_json),
      role_mapping: parseJson(row.role_mapping_json, {}),
    };
  }

  function scheduleDebugDiff(deviceId, snapshots, expected) {
    const scheduleState = snapshots.find((entry) => entry.key === 'schedule_state');
    const current = scheduleState?.normalized?.schedule ?? null;
    if (!expected && current === null) return null;
    const activeDrift = sql.activeDrift.get(deviceId);
    return {
      device_id: deviceId,
      drift_episode_id: activeDrift?.id ?? null,
      drift_reason: activeDrift?.reason ?? null,
      expected_fingerprint: expected?.expected_fingerprint ?? null,
      current_revision: scheduleState?.revision ?? null,
      current_received_at: scheduleState?.received_at ?? null,
      differences: payloadDiff(expected?.schedule ?? null, current),
    };
  }

  function device(deviceId) {
    const row = stmts.getDevice.get(deviceId);
    if (!row) return null;
    const retained = stateSnapshots(deviceId);
    const expected = expectedSchedule(deviceId);
    return {
      device: {
        id: row.id,
        name: row.name || row.id,
        firmware_version: row.fw,
        last_seen_at: asIso(row.last_seen),
        sync: mqttService.getDeviceSyncState?.(deviceId) ?? null,
      },
      retained,
      expected_schedule: expected,
      diff: scheduleDebugDiff(deviceId, retained, expected),
      retained_state_incidents: {
        active: stmts.getActiveRetainedStateIncidents.all(deviceId).map((entry) => incident(entry)),
        resolved: stmts.getResolvedRetainedStateIncidents
          .all(deviceId)
          .map((entry) => incident(entry)),
      },
      recent_history: {
        actions: sql.recentActions.all(deviceId).map(detailedAction),
        device_events: sql.recentDeviceEvents.all(deviceId).map((entry) => ({
          id: entry.id,
          device_id: entry.device_id,
          type: entry.type,
          context: parseJson(entry.context_json, {}),
          occurred_at: asIso(entry.occurred_at),
        })),
        firmware_errors: errorSnapshots(deviceId),
      },
    };
  }

  function global({ exported = false } = {}) {
    const runtime = runtimeState.snapshot();
    return {
      runtime: {
        phase: runtime.phase,
        changed_at: asIso(runtime.changedAt),
        node_version: process.version,
        platform: process.platform,
        architecture: process.arch,
        uptime_seconds: Math.floor(process.uptime()),
      },
      schema: {
        version: migrationState?.currentVersion ?? null,
        migrations_applied_at_startup: migrationState?.appliedCount ?? null,
      },
      configuration: {
        environment: config.nodeEnv,
        log_level: config.logLevel,
        broker: safeBrokerConfig(config, exported),
      },
      server_health: require('./deviceView').formatServerHealth(mqttService),
      pending_actions: {
        total: sql.pendingCounts.all().reduce((sum, row) => sum + row.count, 0),
        by_device: sql.pendingCounts.all(),
      },
      auth: authSystem.diagnostics({ exported }),
      recent_server_errors: logger.recent?.() ?? [],
    };
  }

  function summary() {
    return {
      meta: { generated_at: asIso(clock()), export_redacted: false },
      global: global(),
      devices: stmts.getAllDevices.all().map((row) => ({
        id: row.id,
        name: row.name || row.id,
        firmware_version: row.fw,
        presence: row.presence_status ?? 'unknown',
        last_seen_at: asIso(row.last_seen),
      })),
    };
  }

  function exportBundle() {
    const devices = stmts.getAllDevices.all().map((row) => device(row.id));
    const authDiagnostics = authSystem.diagnostics({ exported: true });
    return {
      meta: {
        format: 'growhub-command-center-diagnostics',
        version: 1,
        generated_at: asIso(clock()),
        export_redacted: true,
        contains_local_device_identifiers: true,
      },
      global: {
        ...global({ exported: true }),
        auth: {
          rate_limiting: authDiagnostics.rate_limiting,
          trusted_proxies: authDiagnostics.trusted_proxies,
        },
      },
      device: devices.map((entry) => entry.device),
      retained: devices.flatMap((entry) =>
        entry.retained.map((snapshot) => ({
          device_id: entry.device.id,
          ...snapshot,
        })),
      ),
      expectedSchedules: devices.map((entry) => entry.expected_schedule).filter(Boolean),
      diffs: devices.map((entry) => entry.diff).filter(Boolean),
      retainedStateIncidents: {
        active: devices.flatMap((entry) => entry.retained_state_incidents.active),
        resolved: devices.flatMap((entry) => entry.retained_state_incidents.resolved),
      },
      recentHistory: {
        actions: devices.flatMap((entry) => entry.recent_history.actions),
        deviceEvents: devices.flatMap((entry) => entry.recent_history.device_events),
        firmwareErrors: devices.flatMap((entry) =>
          entry.recent_history.firmware_errors.map((error) => ({
            device_id: entry.device.id,
            ...error,
          })),
        ),
        serverErrors: logger.recent?.() ?? [],
      },
      authSecurityEvents: authDiagnostics.auth_security_events,
    };
  }

  return Object.freeze({ device, exportBundle, summary });
}

module.exports = { createDiagnosticsService, payloadDiff, safeBrokerConfig };
