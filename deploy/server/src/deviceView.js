'use strict';

const { REQUIRED_STATE_KEYS } = require('./firmwareContract');

const API_STATE_NAMES = Object.freeze({
  presence_state: 'presence_state',
  outlet_state: 'outlet_state',
  schedule_state: 'schedule_state',
});

function parseJson(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function asIso(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function formatMirrorRecord(record) {
  if (!record) return null;
  return {
    received_at: asIso(record.received_at),
    revision: record.revision,
    retained_delivery: record.mqtt_retained === 1,
  };
}

function fallbackSyncState(stateByKey) {
  const missingStates = REQUIRED_STATE_KEYS.filter((key) => !stateByKey.has(key));
  return {
    status: missingStates.length === 0 ? 'ready' : 'syncing',
    generation: 0,
    missingStates,
    escalatedStates: [],
    startedAt: null,
    graceExpiresAt: null,
  };
}

function formatDevice(device, { stmts, mqttService, actionEngine, scheduleService }) {
  const stateRows = stmts.getDeviceStateMirrors.all(device.id);
  const stateByKey = new Map(stateRows.map((row) => [row.state_key, row]));
  const normalized = new Map(
    stateRows.map((row) => [row.state_key, parseJson(row.normalized_json)]),
  );
  const sync = mqttService?.getDeviceSyncState?.(device.id) ?? fallbackSyncState(stateByKey);
  const unsupported = REQUIRED_STATE_KEYS.map((key) => stateByKey.get(key))
    .filter((row) => row?.compatible === 0)
    .map((row) => ({
      code: 'firmware_contract_unsupported',
      state: API_STATE_NAMES[row.state_key],
      reason: row.compatibility_reason,
      received_version: row.schema_version,
    }));
  const escalatedStates = sync.status === 'broker_unavailable' ? [] : sync.escalatedStates;
  const incomplete =
    escalatedStates.length === 0
      ? []
      : [
          {
            code: 'firmware_contract_incomplete',
            affected_states: escalatedStates,
          },
        ];
  const blockers = [...unsupported, ...incomplete];
  const missingStates = sync.missingStates;
  const ready = missingStates.length === 0 && unsupported.length === 0;
  const mirrorStatus =
    unsupported.length > 0 || incomplete.length > 0 ? 'incompatible' : ready ? 'ready' : 'syncing';

  const presenceRow = stateByKey.get('presence_state');
  const outletRow = stateByKey.get('outlet_state');
  const scheduleRow = stateByKey.get('schedule_state');
  const sensorRow = stateByKey.get('sensor_state');
  const presence = normalized.get('presence_state');
  const outletState = normalized.get('outlet_state');
  const scheduleState = normalized.get('schedule_state');
  const sensorState = normalized.get('sensor_state');
  const warnings = Array.isArray(scheduleState?.warnings)
    ? scheduleState.warnings.map((warning) => ({ ...warning, source: 'firmware' }))
    : [];
  if (escalatedStates.length > 0) {
    warnings.push({
      code: 'device_state_not_received',
      severity: 'warning',
      affected_states: escalatedStates,
      source: 'command_center',
    });
  }

  const scheduleManagement = scheduleService?.deviceScheduleState?.(device.id) ?? {
    setup: null,
    expected_schedule: null,
    drift: null,
    drift_actions: null,
    label_drift: [],
  };

  return {
    id: device.id,
    name: device.name || device.id,
    display_name: device.display_name,
    reported_name: device.reported_name,
    firmware_version: device.fw,
    hidden: device.hidden === 1,
    presence: {
      status: presence?.status ?? 'unknown',
      online: presence?.status === 'online',
      ...formatMirrorRecord(presenceRow),
    },
    mirror: {
      status: mirrorStatus,
      ready,
      missing_states: missingStates,
      syncing_since: asIso(sync.startedAt),
      grace_expires_at: asIso(sync.graceExpiresAt),
      generation: sync.generation,
    },
    compatibility: {
      status: blockers.length > 0 ? 'blocked' : ready ? 'compatible' : 'pending',
      blockers,
    },
    outlets:
      outletRow?.compatible === 1 && Array.isArray(outletState?.outlets) ? outletState.outlets : [],
    outlet_state: formatMirrorRecord(outletRow),
    schedule: scheduleRow?.compatible === 1 ? scheduleState : null,
    schedule_state: formatMirrorRecord(scheduleRow),
    sensor: sensorState,
    sensor_state: formatMirrorRecord(sensorRow),
    state_revisions: Object.fromEntries(stateRows.map((row) => [row.state_key, row.revision])),
    pending_actions: actionEngine?.pending?.(device.id) ?? [],
    action_availability: actionEngine?.availability?.(device.id) ?? {},
    warnings,
    ...scheduleManagement,
  };
}

function formatServerHealth(mqttService) {
  const health = mqttService?.getHealth?.() ?? {
    broker: {
      status: mqttService?.isConnected?.() ? 'connected' : 'disconnected',
      subscriptionsReady: false,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastError: null,
    },
    retainedStateRebuild: {
      generation: 0,
      startedAt: null,
      deviceCount: 0,
      syncingDeviceCount: 0,
      missingStateCount: 0,
    },
  };
  return {
    broker: {
      status: health.broker.status,
      subscriptions_ready: health.broker.subscriptionsReady,
      last_connected_at: asIso(health.broker.lastConnectedAt),
      last_disconnected_at: asIso(health.broker.lastDisconnectedAt),
      last_error: health.broker.lastError,
    },
    retained_state_rebuild: {
      generation: health.retainedStateRebuild.generation,
      started_at: asIso(health.retainedStateRebuild.startedAt),
      device_count: health.retainedStateRebuild.deviceCount,
      syncing_device_count: health.retainedStateRebuild.syncingDeviceCount,
      missing_state_count: health.retainedStateRebuild.missingStateCount,
    },
  };
}

module.exports = { formatDevice, formatServerHealth };
