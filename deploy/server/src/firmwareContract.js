'use strict';

const MAC_PATTERN = '[0-9A-F]{12}';
const TOPIC_PATTERN = new RegExp(
  `^growhub/(${MAC_PATTERN})/(status|sensor/live|outlets/state|schedule/state|schedule/error|outlets/error|time/error|control/error)$`,
);

const ASSIGNMENTS = new Set([
  'None',
  'Light',
  'Fan',
  'Humidifier',
  'Dehumidifier',
  'Water Pump',
  'Heater',
  'AC Controller',
]);
const OUTLET_SOURCES = new Set(['local', 'mqtt', 'reconnect']);
const SCHEDULE_SOURCES = new Set(['local', 'mqtt', 'time', 'schedule', 'reconnect']);
const CONDITION_TYPES = new Set([
  'always_on',
  'time_window',
  'rh_low_band',
  'rh_high_band',
  'temp_low_band_c',
  'temp_high_band_c',
  'interval',
]);
const WARNING_SEVERITIES = new Set(['blocking', 'warning', 'info']);
const REQUIRED_STATE_KEYS = Object.freeze(['presence_state', 'outlet_state', 'schedule_state']);

const TOPICS = Object.freeze({
  status: {
    kind: 'state',
    key: 'presence_state',
    discoveryCapable: true,
    maxBytes: 16,
  },
  'sensor/live': {
    kind: 'state',
    key: 'sensor_state',
    discoveryCapable: false,
    maxBytes: 8 * 1024,
  },
  'outlets/state': {
    kind: 'state',
    key: 'outlet_state',
    discoveryCapable: true,
    maxBytes: 16 * 1024,
  },
  'schedule/state': {
    kind: 'state',
    key: 'schedule_state',
    discoveryCapable: true,
    maxBytes: 32 * 1024,
  },
  'schedule/error': {
    kind: 'error',
    key: 'schedule_error',
    discoveryCapable: false,
    maxBytes: 4 * 1024,
  },
  'outlets/error': {
    kind: 'error',
    key: 'outlet_error',
    discoveryCapable: false,
    maxBytes: 4 * 1024,
  },
  'time/error': {
    kind: 'error',
    key: 'time_error',
    discoveryCapable: false,
    maxBytes: 4 * 1024,
  },
  'control/error': {
    kind: 'error',
    key: 'control_error',
    discoveryCapable: false,
    maxBytes: 4 * 1024,
  },
});

const ERROR_REASONS = Object.freeze({
  schedule_error: new Set([
    'invalid_payload',
    'unsupported_schedule_version',
    'empty_schedule',
    'invalid_outlet',
    'missing_conditions',
    'duplicate_condition',
    'invalid_condition',
    'condition_not_allowed',
    'always_on_exclusive',
    'invalid_time_window',
    'invalid_band',
    'invalid_interval',
    'unsupported_action',
    'auto_mode_required',
    'pump_schedule_required',
    'time_sync_required',
    'pump_window_ineligible',
  ]),
  outlet_error: new Set([
    'invalid_payload',
    'unsupported_outlet_config_version',
    'missing_outlets',
    'invalid_outlet',
    'duplicate_outlet',
    'invalid_assignment',
    'invalid_label',
    'write_failed',
  ]),
  time_error: new Set([
    'invalid_payload',
    'unsupported_time_action_version',
    'unsupported_action',
    'invalid_epoch',
  ]),
  control_error: new Set([
    'invalid_payload',
    'invalid_mode',
    'invalid_relay_mask',
    'manual_mode_required',
  ]),
});

function invalid(reason) {
  return { ok: false, reason };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value, minimum, maximum) {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function isInteger(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isSafeString(value, { minimumBytes = 0, maximumBytes, pattern } = {}) {
  if (typeof value !== 'string') return false;
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes < minimumBytes || bytes > maximumBytes) return false;
  if (/\u0000|[\u0001-\u001f]|\u007f/.test(value)) return false;
  return !pattern || pattern.test(value);
}

function decodePayload(payload, maxBytes) {
  const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  if (buffer.length === 0) return invalid('empty_payload');
  if (buffer.length > maxBytes) return invalid('payload_too_large');
  try {
    return { ok: true, raw: new TextDecoder('utf-8', { fatal: true }).decode(buffer) };
  } catch (_) {
    return invalid('invalid_utf8');
  }
}

function parseJsonObject(raw) {
  try {
    const value = JSON.parse(raw);
    return isRecord(value) ? { ok: true, value } : invalid('invalid_payload_shape');
  } catch (_) {
    return invalid('invalid_json');
  }
}

function parseFirmwareTimestamp(value) {
  if (!isSafeString(value, { minimumBytes: 1, maximumBytes: 40 })) return null;
  const normalized = value.replace(' ', 'T').replace(/:(\d{3}Z)$/, '.$1');
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parsePresence(raw) {
  if (raw !== 'online' && raw !== 'offline') return invalid('invalid_presence');
  return {
    ok: true,
    normalized: { status: raw },
    schemaVersion: null,
    compatible: true,
    compatibilityReason: null,
  };
}

function parseSensor(raw, mac) {
  const decoded = parseJsonObject(raw);
  if (!decoded.ok) return decoded;
  const payload = decoded.value;
  if (payload.nId !== mac) return invalid('sensor_identity_mismatch');
  if (!isSafeString(payload.name, { minimumBytes: 1, maximumBytes: 64 })) {
    return invalid('invalid_sensor_name');
  }
  if (!isSafeString(payload.fw, { minimumBytes: 1, maximumBytes: 32 })) {
    return invalid('invalid_firmware_version');
  }
  if (!Array.isArray(payload.data) || payload.data.length !== 1 || !isRecord(payload.data[0])) {
    return invalid('invalid_sensor_data');
  }

  const entry = payload.data[0];
  const observedAt = parseFirmwareTimestamp(entry.ts);
  if (
    !isFiniteNumber(entry.t, -100, 200) ||
    !isFiniteNumber(entry.h, 0, 100) ||
    !isInteger(entry.l, 0, 255) ||
    !isSafeString(entry.a, { minimumBytes: 8, maximumBytes: 8, pattern: /^[01]{4}0{4}$/ }) ||
    observedAt === null ||
    (entry.c2 !== undefined && !isInteger(entry.c2, 0, 100_000))
  ) {
    return invalid('invalid_sensor_reading');
  }

  return {
    ok: true,
    normalized: {
      reported_name: payload.name,
      firmware_version: payload.fw,
      observed_at: observedAt,
      temperature_c: entry.t,
      humidity_rh: entry.h,
      light_level: entry.l,
      co2_ppm: entry.c2 ?? null,
      actuator_summary: entry.a,
    },
    schemaVersion: null,
    compatible: true,
    compatibilityReason: null,
  };
}

function parseOutlets(raw) {
  const decoded = parseJsonObject(raw);
  if (!decoded.ok) return decoded;
  const payload = decoded.value;
  if (!Number.isInteger(payload.v)) return invalid('invalid_outlet_state_version');
  if (payload.v !== 1) {
    return {
      ok: true,
      normalized: { v: payload.v },
      schemaVersion: payload.v,
      compatible: false,
      compatibilityReason: 'unsupported_outlet_state_version',
    };
  }
  if (
    !OUTLET_SOURCES.has(payload.source) ||
    !Array.isArray(payload.outlets) ||
    payload.outlets.length !== 4
  ) {
    return invalid('invalid_outlet_state');
  }

  const seen = new Set();
  const outlets = [];
  for (const outlet of payload.outlets) {
    if (
      !isRecord(outlet) ||
      !isInteger(outlet.id, 1, 4) ||
      seen.has(outlet.id) ||
      !ASSIGNMENTS.has(outlet.assignment) ||
      !isSafeString(outlet.label, { minimumBytes: 1, maximumBytes: 32 }) ||
      outlet.label !== outlet.label.trim()
    ) {
      return invalid('invalid_outlet_state');
    }
    seen.add(outlet.id);
    outlets.push({ id: outlet.id, assignment: outlet.assignment, label: outlet.label });
  }

  return {
    ok: true,
    normalized: { v: 1, source: payload.source, outlets: outlets.sort((a, b) => a.id - b.id) },
    schemaVersion: 1,
    compatible: true,
    compatibilityReason: null,
  };
}

function parseClockTime(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return value;
}

function parseWindow(value) {
  if (!isRecord(value)) return null;
  const start = parseClockTime(value.start);
  const end = parseClockTime(value.end);
  if (!start || !end || start === end) return null;
  return { start, end };
}

function parseCondition(value) {
  if (!isRecord(value) || !CONDITION_TYPES.has(value.type)) return null;
  if (value.type === 'always_on') return { type: value.type };
  if (value.type === 'time_window') {
    const window = parseWindow(value);
    return window ? { type: value.type, ...window } : null;
  }
  if (value.type === 'rh_low_band' || value.type === 'rh_high_band') {
    if (
      !isFiniteNumber(value.low, 0, 100) ||
      !isFiniteNumber(value.high, 0, 100) ||
      value.low >= value.high
    )
      return null;
    return { type: value.type, low: value.low, high: value.high };
  }
  if (value.type === 'temp_low_band_c' || value.type === 'temp_high_band_c') {
    if (
      !isFiniteNumber(value.low_c, -100, 200) ||
      !isFiniteNumber(value.high_c, -100, 200) ||
      value.low_c >= value.high_c
    )
      return null;
    return { type: value.type, low_c: value.low_c, high_c: value.high_c };
  }
  if (!isInteger(value.run_mins, 1, 1_440) || !isInteger(value.every_hrs, 1, 8_760)) return null;
  const condition = {
    type: value.type,
    run_mins: value.run_mins,
    every_hrs: value.every_hrs,
  };
  if (value.window !== undefined) {
    const window = parseWindow(value.window);
    if (!window) return null;
    condition.window = window;
  }
  return condition;
}

function parseScheduleDocument(value) {
  if (!isRecord(value) || !Number.isInteger(value.v)) return invalid('invalid_schedule_version');
  if (value.v !== 3) {
    return {
      ok: true,
      normalized: { v: value.v },
      schemaVersion: value.v,
      compatible: false,
      compatibilityReason: 'unsupported_schedule_version',
    };
  }
  if (!Array.isArray(value.outlets) || value.outlets.length < 1 || value.outlets.length > 4) {
    return invalid('invalid_schedule');
  }

  const seenOutlets = new Set();
  const outlets = [];
  for (const outlet of value.outlets) {
    if (
      !isRecord(outlet) ||
      !isInteger(outlet.id, 1, 4) ||
      seenOutlets.has(outlet.id) ||
      !Array.isArray(outlet.conditions) ||
      outlet.conditions.length < 1 ||
      outlet.conditions.length > CONDITION_TYPES.size
    ) {
      return invalid('invalid_schedule');
    }
    const seenConditions = new Set();
    const conditions = [];
    for (const conditionValue of outlet.conditions) {
      const condition = parseCondition(conditionValue);
      if (!condition || seenConditions.has(condition.type))
        return invalid('invalid_schedule_condition');
      seenConditions.add(condition.type);
      conditions.push(condition);
    }
    if (seenConditions.has('always_on') && conditions.length !== 1) {
      return invalid('invalid_schedule_condition');
    }
    seenOutlets.add(outlet.id);
    outlets.push({ id: outlet.id, conditions });
  }

  return {
    ok: true,
    normalized: { v: 3, outlets: outlets.sort((a, b) => a.id - b.id) },
    schemaVersion: 3,
    compatible: true,
    compatibilityReason: null,
  };
}

function parseWarning(value) {
  if (
    !isRecord(value) ||
    !isSafeString(value.code, { minimumBytes: 1, maximumBytes: 64, pattern: /^[a-z0-9_]+$/ }) ||
    !isSafeString(value.message, { minimumBytes: 1, maximumBytes: 256 }) ||
    !WARNING_SEVERITIES.has(value.severity)
  )
    return null;
  const warning = { code: value.code, message: value.message, severity: value.severity };
  if (value.outlets !== undefined) {
    if (!Array.isArray(value.outlets) || value.outlets.length > 4) return null;
    const outlets = new Set();
    for (const id of value.outlets) {
      if (!isInteger(id, 1, 4) || outlets.has(id)) return null;
      outlets.add(id);
    }
    warning.outlets = [...outlets].sort((a, b) => a - b);
  }
  return warning;
}

function parseScheduleState(raw) {
  const decoded = parseJsonObject(raw);
  if (!decoded.ok) return decoded;
  const payload = decoded.value;
  if (typeof payload.active !== 'boolean' || !Object.hasOwn(payload, 'schedule')) {
    return invalid('invalid_schedule_state');
  }
  if (
    (!payload.active && payload.schedule !== null) ||
    (payload.active && !isRecord(payload.schedule))
  ) {
    return invalid('invalid_schedule_state');
  }

  const completeEnvelope =
    new Set(['auto', 'manual']).has(payload.mode) &&
    SCHEDULE_SOURCES.has(payload.source) &&
    typeof payload.time_valid === 'boolean' &&
    new Set(['sntp', 'manual']).has(payload.time_source) &&
    new Set(['disabled', 'pending', 'synced']).has(payload.sntp_status) &&
    isSafeString(payload.time_warning, { maximumBytes: 256 }) &&
    isSafeString(payload.sensor_warning, { maximumBytes: 256 }) &&
    Array.isArray(payload.warnings) &&
    payload.warnings.length <= 8 &&
    Array.isArray(payload.outlet_status) &&
    payload.outlet_status.length === 4;

  if (!completeEnvelope) {
    return {
      ok: true,
      normalized: { active: payload.active },
      schemaVersion: Number.isInteger(payload.schedule?.v) ? payload.schedule.v : null,
      compatible: false,
      compatibilityReason: 'incomplete_schedule_state_contract',
    };
  }

  const warnings = payload.warnings.map(parseWarning);
  if (warnings.some((warning) => warning === null)) return invalid('invalid_schedule_warning');

  const seenStatuses = new Set();
  const outletStatus = [];
  for (const status of payload.outlet_status) {
    if (
      !isRecord(status) ||
      !isInteger(status.id, 1, 4) ||
      seenStatuses.has(status.id) ||
      !new Set(['on', 'off']).has(status.state) ||
      !isSafeString(status.summary, { maximumBytes: 256 })
    ) {
      return invalid('invalid_outlet_status');
    }
    seenStatuses.add(status.id);
    outletStatus.push({ id: status.id, state: status.state, summary: status.summary });
  }

  let scheduleResult = {
    ok: true,
    normalized: null,
    schemaVersion: 3,
    compatible: true,
    compatibilityReason: null,
  };
  if (payload.active) scheduleResult = parseScheduleDocument(payload.schedule);
  if (!scheduleResult.ok) return scheduleResult;

  return {
    ok: true,
    normalized: {
      active: payload.active,
      mode: payload.mode,
      source: payload.source,
      time_valid: payload.time_valid,
      time_source: payload.time_source,
      sntp_status: payload.sntp_status,
      time_warning: payload.time_warning,
      sensor_warning: payload.sensor_warning,
      warnings,
      schedule: scheduleResult.normalized,
      outlet_status: outletStatus.sort((a, b) => a.id - b.id),
    },
    schemaVersion: scheduleResult.schemaVersion,
    compatible: scheduleResult.compatible,
    compatibilityReason: scheduleResult.compatibilityReason,
  };
}

function parseError(raw, errorKey) {
  const decoded = parseJsonObject(raw);
  if (!decoded.ok) return decoded;
  const payload = decoded.value;
  if (
    !isSafeString(payload.reason, {
      minimumBytes: 1,
      maximumBytes: 64,
      pattern: /^[a-z0-9_]+$/,
    })
  )
    return invalid('invalid_error_reason');
  if (
    payload.command !== undefined &&
    !isSafeString(payload.command, { minimumBytes: 1, maximumBytes: 64 })
  ) {
    return invalid('invalid_error_command');
  }
  if (payload.outlet !== undefined && !isInteger(payload.outlet, 1, 4)) {
    return invalid('invalid_error_outlet');
  }
  if (payload.detail !== undefined && !isSafeString(payload.detail, { maximumBytes: 256 })) {
    return invalid('invalid_error_detail');
  }
  return {
    ok: true,
    normalized: {
      reason: payload.reason,
      recognized_reason: ERROR_REASONS[errorKey].has(payload.reason),
      ...(payload.command === undefined ? {} : { command: payload.command }),
      ...(payload.outlet === undefined ? {} : { outlet: payload.outlet }),
    },
    schemaVersion: null,
    compatible: true,
    compatibilityReason: null,
  };
}

function parseFirmwareMessage(topic, payload) {
  if (typeof topic !== 'string') return invalid('invalid_topic');
  const match = TOPIC_PATTERN.exec(topic);
  if (!match) return invalid('invalid_topic');
  const [, mac, path] = match;
  const topicContract = TOPICS[path];
  const decoded = decodePayload(payload, topicContract.maxBytes);
  if (!decoded.ok) return decoded;

  let result;
  if (path === 'status') result = parsePresence(decoded.raw);
  else if (path === 'sensor/live') result = parseSensor(decoded.raw, mac);
  else if (path === 'outlets/state') result = parseOutlets(decoded.raw);
  else if (path === 'schedule/state') result = parseScheduleState(decoded.raw);
  else result = parseError(decoded.raw, topicContract.key);
  if (!result.ok) return result;

  return {
    ...result,
    mac,
    path,
    kind: topicContract.kind,
    key: topicContract.key,
    discoveryCapable: topicContract.discoveryCapable,
    raw: decoded.raw,
  };
}

module.exports = {
  ASSIGNMENTS,
  REQUIRED_STATE_KEYS,
  TOPICS,
  parseFirmwareMessage,
};
