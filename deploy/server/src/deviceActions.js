'use strict';

const crypto = require('node:crypto');

const CONFIRMATION_TIMEOUT_MS = 15_000;
const LATE_SCHEDULE_CONFIRMATION_GRACE_MS = 60_000;
const PUBLISH_ACK_WAIT_MS = 3_000;
const HISTORY_MAX_AGE_MS = 30 * 86_400_000;
const OUTLET_TO_RELAY_BIT = Object.freeze({ 1: 3, 2: 0, 3: 1, 4: 2 });
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
const MQTT_ACTION_TYPES = new Set([
  'load_schedule',
  'reload_expected_schedule',
  'update_outlet_config',
  'repair_outlet_label',
  'sync_time',
  'switch_to_manual',
  'return_to_auto',
  'set_manual_outlet_state',
  'emergency_all_off',
  'run_water_pump_now',
]);
const ACTION_TYPES = new Set([
  ...MQTT_ACTION_TYPES,
  'save_as_new_template',
  'acknowledge_drift',
  'acknowledge_label_drift',
  'confirm_device_setup',
]);
const TERMINAL_STATUSES = new Set(['completed', 'rejected', 'timed_out', 'interrupted', 'blocked']);

class DeviceActionError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'DeviceActionError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

class ActionBlockedCondition extends Error {
  constructor(reasonCode, context = {}, blockingRow = null) {
    super(reasonCode);
    this.name = 'ActionBlockedCondition';
    this.reasonCode = reasonCode;
    this.context = context;
    this.blockingRow = blockingRow;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(value, fallback) {
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

function formatAction(row) {
  if (!row) return null;
  const reconciliationUntil =
    new Set(['load_schedule', 'reload_expected_schedule']).has(row.type) &&
    Number.isFinite(row.timeout_at)
      ? row.timeout_at + LATE_SCHEDULE_CONFIRMATION_GRACE_MS
      : null;
  return {
    id: row.id,
    device_id: row.device_id,
    type: row.type,
    status: row.status,
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
    timeout_at: asIso(row.timeout_at),
    reconciliation_until: asIso(reconciliationUntil),
    completed_at: asIso(row.completed_at),
    reason_code: row.reason_code ?? null,
    context: parseJson(row.context_json, {}),
  };
}

const FIRMWARE_FLOAT_KEYS = new Set(['low', 'high', 'low_c', 'high_c']);

function normalizeScheduleValue(value, key = null) {
  if (Array.isArray(value)) return value.map((entry) => normalizeScheduleValue(entry));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((entryKey) => [entryKey, normalizeScheduleValue(value[entryKey], entryKey)]),
    );
  }
  if (FIRMWARE_FLOAT_KEYS.has(key) && typeof value === 'number' && Number.isFinite(value)) {
    return Math.fround(value);
  }
  return value;
}

function normalizeOutlets(outlets) {
  if (!Array.isArray(outlets) || outlets.length !== 4) return null;
  const seen = new Set();
  const normalized = [];
  for (const outlet of outlets) {
    if (
      !isRecord(outlet) ||
      !Number.isInteger(outlet.id) ||
      outlet.id < 1 ||
      outlet.id > 4 ||
      seen.has(outlet.id) ||
      !ASSIGNMENTS.has(outlet.assignment) ||
      typeof outlet.label !== 'string' ||
      outlet.label !== outlet.label.trim() ||
      Buffer.byteLength(outlet.label, 'utf8') < 1 ||
      Buffer.byteLength(outlet.label, 'utf8') > 32 ||
      /[\u0000-\u001f\u007f]/.test(outlet.label)
    )
      return null;
    seen.add(outlet.id);
    normalized.push({ id: outlet.id, assignment: outlet.assignment, label: outlet.label });
  }
  return normalized.sort((a, b) => a.id - b.id);
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function outletFingerprint(outlets) {
  const normalized = normalizeOutlets(outlets);
  return normalized ? fingerprint(normalized) : null;
}

function sameOutlets(left, right) {
  const a = normalizeOutlets(left);
  const b = normalizeOutlets(right);
  return Boolean(a && b && JSON.stringify(a) === JSON.stringify(b));
}

function normalizeSchedule(schedule) {
  if (!isRecord(schedule) || schedule.v !== 3 || !Array.isArray(schedule.outlets)) return null;
  return {
    v: 3,
    outlets: schedule.outlets
      .map((outlet) => ({
        id: outlet.id,
        conditions: Array.isArray(outlet.conditions)
          ? outlet.conditions
              .map((condition) => normalizeScheduleValue(condition))
              .sort((a, b) => String(a.type).localeCompare(String(b.type)))
          : [],
      }))
      .sort((a, b) => a.id - b.id),
  };
}

function sameSchedule(left, right) {
  const a = normalizeSchedule(left);
  const b = normalizeSchedule(right);
  return Boolean(a && b && JSON.stringify(a) === JSON.stringify(b));
}

function exactKeys(value, allowed) {
  return isRecord(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function outletStates(schedule) {
  if (!Array.isArray(schedule?.outlet_status) || schedule.outlet_status.length !== 4) return null;
  const states = new Map();
  for (const outlet of schedule.outlet_status) {
    if (
      !Number.isInteger(outlet?.id) ||
      outlet.id < 1 ||
      outlet.id > 4 ||
      states.has(outlet.id) ||
      !new Set(['on', 'off']).has(outlet.state)
    )
      return null;
    states.set(outlet.id, outlet.state);
  }
  return states.size === 4 ? states : null;
}

function relayMask(states) {
  let mask = 0;
  for (const [outletId, state] of states) {
    if (state === 'on') mask |= 1 << OUTLET_TO_RELAY_BIT[outletId];
  }
  return mask;
}

function actionClass(type, confirmation = {}) {
  if (type === 'repair_outlet_label') return 'label';
  if (type === 'update_outlet_config') {
    return confirmation.assignment_changed ? 'assignment' : 'label';
  }
  if (type === 'sync_time') return 'time';
  if (type === 'set_manual_outlet_state') return 'relay';
  if (new Set(['switch_to_manual', 'return_to_auto', 'emergency_all_off']).has(type)) return 'mode';
  if (new Set(['load_schedule', 'reload_expected_schedule', 'run_water_pump_now']).has(type)) {
    return 'schedule';
  }
  return 'local';
}

function actionsConflict(nextType, nextConfirmation, pendingRow) {
  if (nextType === 'emergency_all_off') return pendingRow.type === 'emergency_all_off';
  const next = actionClass(nextType, nextConfirmation);
  const pendingConfirmation = parseJson(pendingRow.confirmation_json, {});
  const current = actionClass(pendingRow.type, pendingConfirmation);
  if (next === 'local') return false;
  if (next === 'label') return new Set(['label', 'assignment', 'schedule']).has(current);
  if (next === 'time') return !new Set(['label', 'relay']).has(current);
  if (next === 'relay') return !new Set(['label', 'time']).has(current);
  if (next === 'mode') return current !== 'label';
  return true;
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify([row.created_at, row.id])).toString('base64url');
}

function decodeCursor(cursor) {
  if (cursor === undefined || cursor === null || cursor === '') return null;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      !Number.isInteger(value[0]) ||
      typeof value[1] !== 'string'
    )
      throw new Error('invalid');
    return { createdAt: value[0], id: value[1] };
  } catch (_) {
    throw new DeviceActionError(400, 'invalid_cursor', 'The activity cursor is invalid.');
  }
}

function createDeviceActionEngine({
  database,
  mqttService,
  logger,
  clock = () => Date.now(),
  uuid = crypto.randomUUID,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  confirmationTimeoutMs = CONFIRMATION_TIMEOUT_MS,
  publishAckWaitMs = PUBLISH_ACK_WAIT_MS,
} = {}) {
  const { db, stmts } = database;
  const deadlines = new Map();
  const terminalListeners = new Set();
  const terminalMutators = new Set();
  const handlers = new Map();
  const sql = {
    insert: db.prepare(`
      INSERT INTO device_actions (
        id, device_id, type, status, reason_code, context_json, input_json,
        confirmation_json, required_state_keys_json, base_state_revisions_json,
        base_error_sequences_json, request_id, publish_topic, publish_state,
        submitted_at, acknowledged_at, timeout_at, completed_at, created_at, updated_at
      ) VALUES (
        @id, @device_id, @type, @status, @reason_code, @context_json, @input_json,
        @confirmation_json, @required_state_keys_json, @base_state_revisions_json,
        @base_error_sequences_json, @request_id, @publish_topic, @publish_state,
        @submitted_at, @acknowledged_at, @timeout_at, @completed_at, @created_at, @updated_at
      )
    `),
    get: db.prepare(`
      SELECT * FROM device_actions WHERE device_id = ? AND id = ?
    `),
    getById: db.prepare(`SELECT * FROM device_actions WHERE id = ?`),
    pendingForDevice: db.prepare(`
      SELECT * FROM device_actions
      WHERE device_id = ? AND status = 'pending'
      ORDER BY created_at ASC, id ASC
    `),
    allPending: db.prepare(`
      SELECT * FROM device_actions
      WHERE status = 'pending'
      ORDER BY created_at ASC, id ASC
    `),
    markSubmitted: db.prepare(`
      UPDATE device_actions
      SET publish_state = 'submitted', submitted_at = @submitted_at,
          timeout_at = @timeout_at, updated_at = @updated_at
      WHERE id = @id AND status = 'pending' AND publish_state = 'prepared'
    `),
    markAcknowledged: db.prepare(`
      UPDATE device_actions
      SET publish_state = 'acknowledged', acknowledged_at = @acknowledged_at,
          updated_at = CASE WHEN updated_at < @acknowledged_at THEN @acknowledged_at ELSE updated_at END
      WHERE id = @id AND publish_state IN ('submitted', 'acknowledged')
    `),
    finish: db.prepare(`
      UPDATE device_actions
      SET status = @status, reason_code = @reason_code, completed_at = @completed_at,
          updated_at = @completed_at,
          publish_state = CASE WHEN @publish_failed = 1 THEN 'failed' ELSE publish_state END
      WHERE id = @id AND status = 'pending'
    `),
    updateContext: db.prepare(`
      UPDATE device_actions SET context_json = @context_json WHERE id = @id
    `),
    interruptPrepared: db.prepare(`
      UPDATE device_actions
      SET status = 'interrupted', reason_code = 'server_restarted_before_publish',
          completed_at = @now, updated_at = @now
      WHERE status = 'pending' AND publish_state = 'prepared'
    `),
    due: db.prepare(`
      SELECT id FROM device_actions
      WHERE status = 'pending' AND timeout_at IS NOT NULL AND timeout_at <= ?
      ORDER BY timeout_at ASC
    `),
    lateScheduleCandidates: db.prepare(`
      SELECT rowid AS action_sequence, * FROM device_actions
      WHERE device_id = @device_id
        AND type IN ('load_schedule', 'reload_expected_schedule')
        AND status = 'timed_out'
        AND reason_code = 'confirmation_timeout'
        AND timeout_at IS NOT NULL
        AND timeout_at >= @cutoff
      ORDER BY rowid DESC
    `),
    hasSupersedingAction: db.prepare(`
      SELECT 1 FROM device_actions
      WHERE device_id = @device_id
        AND rowid > @action_sequence
        AND (
          type IN ('load_schedule', 'reload_expected_schedule', 'emergency_all_off')
          OR (
            type = 'update_outlet_config'
            AND json_extract(confirmation_json, '$.assignment_changed') = 1
          )
        )
      LIMIT 1
    `),
    promoteTimedOut: db.prepare(`
      UPDATE device_actions
      SET status = 'completed', reason_code = 'confirmed_after_timeout',
          completed_at = @completed_at, updated_at = @completed_at
      WHERE id = @id AND status = 'timed_out' AND reason_code = 'confirmation_timeout'
    `),
    historyFirst: db.prepare(`
      SELECT * FROM device_actions
      WHERE device_id = @device_id
      ORDER BY created_at DESC, id DESC LIMIT @limit
    `),
    historyAfter: db.prepare(`
      SELECT * FROM device_actions
      WHERE device_id = @device_id
        AND (created_at < @created_at OR (created_at = @created_at AND id < @id))
      ORDER BY created_at DESC, id DESC LIMIT @limit
    `),
    deleteOldTerminal: db.prepare(`
      DELETE FROM device_actions
      WHERE status != 'pending' AND completed_at < ?
    `),
    trimTerminal: db.prepare(`
      DELETE FROM device_actions
      WHERE device_id = @device_id AND status != 'pending' AND id NOT IN (
        SELECT id FROM device_actions
        WHERE device_id = @device_id AND status != 'pending'
        ORDER BY created_at DESC, id DESC LIMIT 100
      )
    `),
  };

  function state(deviceId, key) {
    const row = stmts.getDeviceStateMirror.get(deviceId, key);
    return {
      row,
      value: parseJson(row?.normalized_json, null),
    };
  }

  function baseStateRevisions(deviceId, keys) {
    return Object.fromEntries(
      keys.map((key) => [key, stmts.getDeviceStateMirror.get(deviceId, key)?.revision ?? 0]),
    );
  }

  function baseErrorSequences(deviceId, keys) {
    return Object.fromEntries(
      keys.map((key) => [key, stmts.getDeviceErrorMirror.get(deviceId, key)?.sequence ?? 0]),
    );
  }

  function createRow({
    id = uuid(),
    deviceId,
    type,
    status = 'pending',
    reasonCode = null,
    context = {},
    input = {},
    confirmation = null,
    requiredStateKeys = [],
    baseState = {},
    baseErrors = {},
    requestId = null,
    publishTopic = null,
    publishState = 'not_applicable',
    now = clock(),
  }) {
    const terminal = status !== 'pending';
    sql.insert.run({
      id,
      device_id: deviceId,
      type,
      status,
      reason_code: reasonCode,
      context_json: JSON.stringify(context),
      input_json: JSON.stringify(input),
      confirmation_json: confirmation === null ? null : JSON.stringify(confirmation),
      required_state_keys_json: JSON.stringify(requiredStateKeys),
      base_state_revisions_json: JSON.stringify(baseState),
      base_error_sequences_json: JSON.stringify(baseErrors),
      request_id: requestId,
      publish_topic: publishTopic,
      publish_state: publishState,
      submitted_at: null,
      acknowledged_at: null,
      timeout_at: null,
      completed_at: terminal ? now : null,
      created_at: now,
      updated_at: now,
    });
    return sql.get.get(deviceId, id);
  }

  function notifyTerminal(row) {
    if (!row || !TERMINAL_STATUSES.has(row.status)) return;
    for (const listener of terminalListeners) {
      try {
        listener(row);
      } catch (error) {
        logger.error('device_action_terminal_listener_failed', {
          action_id: row.id,
          device_id: row.device_id,
          error,
        });
      }
    }
  }

  function mutateTerminal(row) {
    for (const mutator of terminalMutators) mutator(row);
  }

  function clearDeadline(actionId) {
    const handle = deadlines.get(actionId);
    if (handle) clearTimeoutFn(handle);
    deadlines.delete(actionId);
  }

  function finish(actionId, status, reasonCode, { publishFailed = false, at = clock() } = {}) {
    const complete = db.transaction(() => {
      const changed = sql.finish.run({
        id: actionId,
        status,
        reason_code: reasonCode,
        completed_at: at,
        publish_failed: publishFailed ? 1 : 0,
      }).changes;
      if (!changed) return { changed: false, row: sql.getById.get(actionId) };
      const row = sql.getById.get(actionId);
      mutateTerminal(row);
      return { changed: true, row };
    });
    const result = complete();
    if (!result.changed) return result.row;
    clearDeadline(actionId);
    const row = result.row;
    notifyTerminal(row);
    prune(row.device_id);
    logger.info('device_action_terminal', {
      action_id: row.id,
      device_id: row.device_id,
      action_type: row.type,
      action_status: row.status,
      reason_code: row.reason_code,
      request_id: row.request_id,
    });
    return row;
  }

  function promoteTimedOut(row, at = clock()) {
    const promote = db.transaction(() => {
      const changed = sql.promoteTimedOut.run({ id: row.id, completed_at: at }).changes;
      if (!changed) return { changed: false, row: sql.getById.get(row.id) };
      const completed = sql.getById.get(row.id);
      mutateTerminal(completed);
      return { changed: true, row: completed };
    });
    const result = promote();
    if (!result.changed) return result.row;
    notifyTerminal(result.row);
    prune(result.row.device_id);
    logger.info('device_action_late_confirmed', {
      action_id: result.row.id,
      device_id: result.row.device_id,
      action_type: result.row.type,
      request_id: result.row.request_id,
    });
    return result.row;
  }

  function confirmationFromCurrentMirror(row) {
    const required = parseJson(row.required_state_keys_json, []);
    return required.some((stateKey) => {
      const current = state(row.device_id, stateKey);
      return confirmationMatches(row, stateKey, current.row?.revision ?? 0, current.value);
    });
  }

  function timeoutOrConfirm(row) {
    const current = sql.getById.get(row.id);
    if (!current || current.status !== 'pending') return current;
    if (confirmationFromCurrentMirror(current)) return finish(current.id, 'completed', null);
    return finish(current.id, 'timed_out', 'confirmation_timeout', { at: current.timeout_at });
  }

  function scheduleDeadline(row) {
    clearDeadline(row.id);
    if (row.status !== 'pending' || !Number.isFinite(row.timeout_at)) return;
    const delay = Math.max(0, row.timeout_at - clock());
    const handle = setTimeoutFn(() => {
      deadlines.delete(row.id);
      timeoutOrConfirm(row);
    }, delay);
    handle?.unref?.();
    deadlines.set(row.id, handle);
  }

  function block({ deviceId, type, input, context, requestId, reasonCode, blockingRow = null }) {
    const row = createRow({
      deviceId,
      type,
      status: 'blocked',
      reasonCode,
      context,
      input,
      requestId,
    });
    prune(deviceId);
    throw new DeviceActionError(409, 'action_blocked', 'The device action is currently blocked.', {
      blocked_action: formatAction(row),
      blocking_action: blockingRow
        ? {
            id: blockingRow.id,
            type: blockingRow.type,
            status: blockingRow.status,
            created_at: asIso(blockingRow.created_at),
            timeout_at: asIso(blockingRow.timeout_at),
          }
        : null,
    });
  }

  function requireState(deviceId, type, input, context, requestId, key) {
    const current = state(deviceId, key);
    if (!current.row || current.row.compatible !== 1 || current.value === null) {
      block({
        deviceId,
        type,
        input,
        context: { ...context, changed_precondition: key },
        requestId,
        reasonCode: 'retained_state_syncing',
      });
    }
    return current;
  }

  function requireOnline(deviceId, type, input, context, requestId) {
    const presence = requireState(deviceId, type, input, context, requestId, 'presence_state');
    if (presence.value.status !== 'online') {
      block({ deviceId, type, input, context, requestId, reasonCode: 'device_offline' });
    }
  }

  function validateInput(type, input) {
    if (!isRecord(input)) {
      throw new DeviceActionError(400, 'invalid_action_input', 'Action input must be an object.');
    }
    if (new Set(['sync_time', 'switch_to_manual', 'emergency_all_off']).has(type)) {
      if (!exactKeys(input, [])) {
        throw new DeviceActionError(
          400,
          'invalid_action_input',
          'This action does not accept input fields.',
        );
      }
      return input;
    }
    if (type === 'return_to_auto') {
      if (
        !exactKeys(input, ['acknowledged_warning_codes']) ||
        (input.acknowledged_warning_codes !== undefined &&
          (!Array.isArray(input.acknowledged_warning_codes) ||
            input.acknowledged_warning_codes.some((code) => typeof code !== 'string')))
      ) {
        throw new DeviceActionError(
          400,
          'invalid_action_input',
          'Return to AUTO warning acknowledgement is invalid.',
        );
      }
      return {
        acknowledged_warning_codes: [...new Set(input.acknowledged_warning_codes ?? [])].sort(),
      };
    }
    if (type === 'set_manual_outlet_state') {
      if (
        !exactKeys(input, ['outlet_id', 'target_state']) ||
        !Number.isInteger(input.outlet_id) ||
        input.outlet_id < 1 ||
        input.outlet_id > 4 ||
        !new Set(['on', 'off']).has(input.target_state)
      ) {
        throw new DeviceActionError(400, 'invalid_action_input', 'Manual outlet input is invalid.');
      }
      return { outlet_id: input.outlet_id, target_state: input.target_state };
    }
    if (type === 'run_water_pump_now') {
      if (
        !exactKeys(input, ['outlet_id']) ||
        !Number.isInteger(input.outlet_id) ||
        input.outlet_id < 1 ||
        input.outlet_id > 4
      ) {
        throw new DeviceActionError(400, 'invalid_action_input', 'Pump outlet input is invalid.');
      }
      return { outlet_id: input.outlet_id };
    }
    if (new Set(['update_outlet_config', 'repair_outlet_label']).has(type)) {
      if (
        !exactKeys(input, ['outlets', 'base_fingerprint']) ||
        typeof input.base_fingerprint !== 'string' ||
        !/^[a-f0-9]{64}$/.test(input.base_fingerprint)
      ) {
        throw new DeviceActionError(
          400,
          'invalid_action_input',
          'Outlet configuration input is invalid.',
        );
      }
      const outlets = normalizeOutlets(input.outlets);
      if (!outlets) {
        throw new DeviceActionError(
          400,
          'invalid_action_input',
          'Exactly four valid physical outlets are required.',
        );
      }
      return { outlets, base_fingerprint: input.base_fingerprint };
    }
    throw new DeviceActionError(
      400,
      'unsupported_action_type',
      'The requested device action is not supported.',
    );
  }

  function buildSpec({ deviceId, type, input, requestId }) {
    requireOnline(deviceId, type, input, {}, requestId);
    if (type === 'sync_time') {
      const schedule = requireState(deviceId, type, input, {}, requestId, 'schedule_state');
      return {
        context: {},
        confirmation: { kind: 'time_valid' },
        requiredStateKeys: ['schedule_state'],
        errorKeys: ['time_error'],
        topic: `growhub/${deviceId}/time/action`,
        payload: JSON.stringify({ v: 1, action: 'sync_epoch', epoch: Math.floor(clock() / 1_000) }),
        noOp: schedule.value.time_valid === true,
      };
    }

    if (new Set(['switch_to_manual', 'return_to_auto', 'emergency_all_off']).has(type)) {
      const schedule = requireState(deviceId, type, input, {}, requestId, 'schedule_state');
      const targetMode = type === 'return_to_auto' ? 'auto' : 'manual';
      if (type === 'return_to_auto') {
        const currentWarnings = (schedule.value.warnings ?? [])
          .map((warning) => warning.code)
          .sort();
        if (JSON.stringify(currentWarnings) !== JSON.stringify(input.acknowledged_warning_codes)) {
          block({
            deviceId,
            type,
            input,
            context: { target_mode: targetMode, changed_precondition: 'schedule_state' },
            requestId,
            reasonCode: 'device_state_changed',
          });
        }
      }
      const states = outletStates(schedule.value);
      const allOff = states && [...states.values()].every((value) => value === 'off');
      return {
        context: { target_mode: targetMode },
        confirmation:
          type === 'emergency_all_off'
            ? { kind: 'emergency_all_off' }
            : { kind: 'mode', target_mode: targetMode },
        requiredStateKeys: ['schedule_state'],
        errorKeys: ['control_error'],
        topic: `growhub/${deviceId}/control/mode`,
        payload: type === 'switch_to_manual' ? '2' : type === 'return_to_auto' ? '3' : '7',
        noOp:
          type === 'emergency_all_off'
            ? schedule.value.mode === 'manual' && allOff
            : schedule.value.mode === targetMode,
      };
    }

    if (type === 'set_manual_outlet_state') {
      const outlets = requireState(deviceId, type, input, {}, requestId, 'outlet_state');
      const schedule = requireState(deviceId, type, input, {}, requestId, 'schedule_state');
      const outlet = outlets.value.outlets.find((candidate) => candidate.id === input.outlet_id);
      const context = {
        outlet_id: input.outlet_id,
        outlet_label: outlet?.label ?? `Outlet ${input.outlet_id}`,
        target_state: input.target_state,
      };
      if (!outlet || outlet.assignment === 'None') {
        block({
          deviceId,
          type,
          input,
          context,
          requestId,
          reasonCode: 'outlet_assignment_required',
        });
      }
      if (schedule.value.mode !== 'manual') {
        block({ deviceId, type, input, context, requestId, reasonCode: 'manual_mode_required' });
      }
      const states = outletStates(schedule.value);
      if (!states) {
        block({
          deviceId,
          type,
          input,
          context: { ...context, changed_precondition: 'schedule_state' },
          requestId,
          reasonCode: 'retained_state_syncing',
        });
      }
      states.set(input.outlet_id, input.target_state);
      const intendedMask = relayMask(states);
      return {
        context,
        confirmation: { kind: 'relay_mask', intended_mask: intendedMask },
        requiredStateKeys: ['schedule_state'],
        errorKeys: ['control_error'],
        topic: `growhub/${deviceId}/control/relay`,
        payload: String(intendedMask),
        noOp: relayMask(outletStates(schedule.value)) === intendedMask,
      };
    }

    if (type === 'run_water_pump_now') {
      const outlets = requireState(deviceId, type, input, {}, requestId, 'outlet_state');
      const schedule = requireState(deviceId, type, input, {}, requestId, 'schedule_state');
      const outlet = outlets.value.outlets.find((candidate) => candidate.id === input.outlet_id);
      const context = {
        outlet_id: input.outlet_id,
        outlet_label: outlet?.label ?? `Outlet ${input.outlet_id}`,
      };
      if (outlet?.assignment !== 'Water Pump') {
        block({
          deviceId,
          type,
          input,
          context,
          requestId,
          reasonCode: 'pump_assignment_required',
        });
      }
      if (schedule.value.mode !== 'auto') {
        block({ deviceId, type, input, context, requestId, reasonCode: 'auto_mode_required' });
      }
      const scheduled = schedule.value.schedule?.outlets?.some(
        (entry) =>
          entry.id === input.outlet_id &&
          entry.conditions?.some((condition) => condition.type === 'interval'),
      );
      if (!scheduled) {
        block({ deviceId, type, input, context, requestId, reasonCode: 'pump_schedule_required' });
      }
      const states = outletStates(schedule.value);
      return {
        context,
        confirmation: { kind: 'pump_on', outlet_id: input.outlet_id },
        requiredStateKeys: ['schedule_state'],
        errorKeys: ['schedule_error'],
        topic: `growhub/${deviceId}/schedule/action`,
        payload: JSON.stringify({ action: 'pump_run_now', outlet: input.outlet_id }),
        noOp: states?.get(input.outlet_id) === 'on',
      };
    }

    const currentOutlets = requireState(deviceId, type, input, {}, requestId, 'outlet_state');
    const current = normalizeOutlets(currentOutlets.value.outlets);
    if (input.base_fingerprint !== outletFingerprint(current)) {
      block({
        deviceId,
        type,
        input,
        context: { changed_precondition: 'outlet_state' },
        requestId,
        reasonCode: 'device_state_changed',
      });
    }
    const changedIds = input.outlets
      .filter((outlet) => {
        const previous = current.find((candidate) => candidate.id === outlet.id);
        return previous.assignment !== outlet.assignment || previous.label !== outlet.label;
      })
      .map((outlet) => outlet.id);
    const assignmentChanged = input.outlets.some(
      (outlet) =>
        current.find((candidate) => candidate.id === outlet.id).assignment !== outlet.assignment,
    );
    if (type === 'repair_outlet_label' && assignmentChanged) {
      throw new DeviceActionError(
        400,
        'invalid_action_input',
        'Label repair cannot change outlet assignments.',
      );
    }
    return {
      context: { outlet_ids: changedIds },
      confirmation: {
        kind: 'outlet_config',
        outlets: input.outlets,
        assignment_changed: assignmentChanged,
      },
      requiredStateKeys: ['outlet_state'],
      errorKeys: ['outlet_error'],
      topic: `growhub/${deviceId}/outlets/config`,
      payload: JSON.stringify({ v: 1, outlets: input.outlets }),
      noOp: sameOutlets(current, input.outlets),
    };
  }

  function maybeInterruptForEmergency(deviceId) {
    for (const pending of sql.pendingForDevice.all(deviceId)) {
      if (
        new Set([
          'load_schedule',
          'reload_expected_schedule',
          'run_water_pump_now',
          'set_manual_outlet_state',
          'switch_to_manual',
          'return_to_auto',
        ]).has(pending.type)
      ) {
        finish(pending.id, 'interrupted', 'superseded_by_emergency');
      }
    }
  }

  async function handoff(row, spec) {
    const submittedAt = clock();
    const timeoutAt = submittedAt + confirmationTimeoutMs;
    sql.markSubmitted.run({
      id: row.id,
      submitted_at: submittedAt,
      timeout_at: timeoutAt,
      updated_at: submittedAt,
    });
    row = sql.getById.get(row.id);
    scheduleDeadline(row);

    let settleAck;
    const ack = new Promise((resolve) => {
      settleAck = resolve;
    });
    try {
      mqttService.publishAction(spec.topic, spec.payload, (error) => {
        const observedAt = clock();
        if (error) {
          finish(row.id, 'interrupted', 'mqtt_publish_failed', {
            publishFailed: true,
            at: observedAt,
          });
        } else {
          sql.markAcknowledged.run({
            id: row.id,
            acknowledged_at: observedAt,
          });
          logger.info('device_action_publish_acknowledged', {
            action_id: row.id,
            device_id: row.device_id,
            action_type: row.type,
            request_id: row.request_id,
          });
        }
        settleAck();
      });
    } catch (_error) {
      const terminal = finish(row.id, 'interrupted', 'mqtt_publish_failed', {
        publishFailed: true,
      });
      throw new DeviceActionError(
        502,
        'action_publish_failed',
        'The device command could not be published.',
        { action: formatAction(terminal) },
      );
    }

    let waitHandle;
    await Promise.race([
      ack,
      new Promise((resolve) => {
        waitHandle = setTimeoutFn(resolve, publishAckWaitMs);
        waitHandle?.unref?.();
      }),
    ]);
    if (waitHandle) clearTimeoutFn(waitHandle);
    return sql.getById.get(row.id);
  }

  async function submit({ deviceId, type, input = {}, requestId = null }) {
    expireDue();
    if (!stmts.getDevice.get(deviceId)) {
      throw new DeviceActionError(404, 'device_not_found', 'Device not found.');
    }
    const handler = handlers.get(type);
    if (!ACTION_TYPES.has(type) || (!handler && !MQTT_ACTION_TYPES.has(type))) {
      throw new DeviceActionError(
        400,
        'unsupported_action_type',
        'The requested device action is not supported.',
      );
    }
    const validatedInput = handler?.validate ? handler.validate(input) : validateInput(type, input);
    if (
      MQTT_ACTION_TYPES.has(type) &&
      (!mqttService.isConnected() || mqttService.getHealth?.()?.broker?.subscriptionsReady !== true)
    ) {
      throw new DeviceActionError(503, 'broker_unavailable', 'The MQTT broker is unavailable.');
    }
    let spec;
    try {
      spec = handler
        ? handler.prepare({
            deviceId,
            type,
            input: validatedInput,
            requestId,
            clock,
            database,
            state: (key) => state(deviceId, key),
          })
        : buildSpec({ deviceId, type, input: validatedInput, requestId });
    } catch (error) {
      if (!(error instanceof ActionBlockedCondition)) throw error;
      block({
        deviceId,
        type,
        input: validatedInput,
        context: error.context,
        requestId,
        reasonCode: error.reasonCode,
        blockingRow: error.blockingRow,
      });
    }
    const pending = sql.pendingForDevice.all(deviceId);
    const blocker = pending.find(
      (row) => spec.conflictWithPending === true || actionsConflict(type, spec.confirmation, row),
    );
    if (blocker) {
      block({
        deviceId,
        type,
        input: validatedInput,
        context: spec.context,
        requestId,
        reasonCode: 'conflicting_action',
        blockingRow: blocker,
      });
    }
    if (type === 'emergency_all_off') maybeInterruptForEmergency(deviceId);

    const now = clock();
    if (spec.local === true) {
      const actionId = uuid();
      const commit = db.transaction(() => {
        createRow({
          id: actionId,
          deviceId,
          type,
          status: 'completed',
          reasonCode: null,
          context: spec.context ?? {},
          input: validatedInput,
          confirmation: spec.confirmation ?? null,
          requiredStateKeys: spec.requiredStateKeys ?? [],
          requestId,
          now,
        });
        const result = spec.execute?.({ actionId, now }) ?? {};
        if (result.context) {
          sql.updateContext.run({ id: actionId, context_json: JSON.stringify(result.context) });
        }
        const completed = sql.getById.get(actionId);
        mutateTerminal(completed);
        return completed;
      });
      let completed;
      try {
        completed = commit();
      } catch (error) {
        if (!(error instanceof ActionBlockedCondition)) throw error;
        block({
          deviceId,
          type,
          input: validatedInput,
          context: error.context,
          requestId,
          reasonCode: error.reasonCode,
          blockingRow: error.blockingRow,
        });
      }
      notifyTerminal(completed);
      prune(deviceId);
      return completed;
    }
    if (spec.noOp) {
      const commit = db.transaction(() => {
        const completed = createRow({
          deviceId,
          type,
          status: 'completed',
          reasonCode: 'already_in_requested_state',
          context: spec.context,
          input: validatedInput,
          confirmation: spec.confirmation,
          requiredStateKeys: spec.requiredStateKeys,
          requestId,
          now,
        });
        mutateTerminal(completed);
        return completed;
      });
      const completed = commit();
      notifyTerminal(completed);
      prune(deviceId);
      return completed;
    }

    const prepared = createRow({
      deviceId,
      type,
      context: spec.context,
      input: validatedInput,
      confirmation: spec.confirmation,
      requiredStateKeys: spec.requiredStateKeys,
      baseState: baseStateRevisions(deviceId, spec.requiredStateKeys),
      baseErrors: baseErrorSequences(deviceId, spec.errorKeys),
      requestId,
      publishTopic: spec.topic,
      publishState: 'prepared',
      now,
    });
    logger.info('device_action_prepared', {
      action_id: prepared.id,
      device_id: deviceId,
      action_type: type,
      request_id: requestId,
      mqtt_topic: spec.topic,
    });
    const submitted = await handoff(prepared, spec);
    return submitted;
  }

  function confirmationMatches(row, stateKey, revision, value) {
    const base = parseJson(row.base_state_revisions_json, {});
    if (revision <= (base[stateKey] ?? 0)) return false;
    const confirmation = parseJson(row.confirmation_json, {});
    if (confirmation.kind === 'outlet_config') {
      return stateKey === 'outlet_state' && sameOutlets(value?.outlets, confirmation.outlets);
    }
    if (confirmation.kind === 'schedule') {
      return stateKey === 'schedule_state' && sameSchedule(value?.schedule, confirmation.schedule);
    }
    if (confirmation.kind === 'time_valid') {
      return (
        stateKey === 'schedule_state' && value?.source === 'time' && value?.time_valid === true
      );
    }
    if (confirmation.kind === 'mode') {
      return stateKey === 'schedule_state' && value?.mode === confirmation.target_mode;
    }
    if (confirmation.kind === 'emergency_all_off') {
      const states = outletStates(value);
      return (
        stateKey === 'schedule_state' &&
        value?.mode === 'manual' &&
        states &&
        [...states.values()].every((entry) => entry === 'off')
      );
    }
    if (confirmation.kind === 'relay_mask') {
      const states = outletStates(value);
      return (
        stateKey === 'schedule_state' &&
        value?.mode === 'manual' &&
        states &&
        relayMask(states) === confirmation.intended_mask
      );
    }
    if (confirmation.kind === 'pump_on') {
      const states = outletStates(value);
      return (
        stateKey === 'schedule_state' &&
        value?.mode === 'auto' &&
        states?.get(confirmation.outlet_id) === 'on'
      );
    }
    return false;
  }

  function observeState({ deviceId, stateKey, revision, value }) {
    expireDue();
    for (const row of sql.pendingForDevice.all(deviceId)) {
      if (confirmationMatches(row, stateKey, revision, value)) {
        finish(row.id, 'completed', null);
      }
    }
    if (stateKey !== 'schedule_state') return;
    const cutoff = clock() - LATE_SCHEDULE_CONFIRMATION_GRACE_MS;
    for (const row of sql.lateScheduleCandidates.all({ device_id: deviceId, cutoff })) {
      if (
        sql.hasSupersedingAction.get({
          device_id: deviceId,
          action_sequence: row.action_sequence,
        }) ||
        !confirmationMatches(row, stateKey, revision, value)
      ) {
        continue;
      }
      promoteTimedOut(row);
      break;
    }
  }

  function errorMatches(row, errorKey, sequence, value) {
    const base = parseJson(row.base_error_sequences_json, {});
    if (sequence <= (base[errorKey] ?? 0)) return false;
    if (errorKey === 'schedule_error') {
      return new Set(['load_schedule', 'reload_expected_schedule', 'run_water_pump_now']).has(
        row.type,
      );
    }
    if (errorKey === 'outlet_error') {
      return new Set(['update_outlet_config', 'repair_outlet_label']).has(row.type);
    }
    if (errorKey === 'time_error') {
      return row.type === 'sync_time' && (!value.command || value.command === 'time/action');
    }
    if (errorKey === 'control_error') {
      const expected = row.type === 'set_manual_outlet_state' ? 'control/relay' : 'control/mode';
      return (
        new Set([
          'switch_to_manual',
          'return_to_auto',
          'emergency_all_off',
          'set_manual_outlet_state',
        ]).has(row.type) &&
        (!value.command || value.command === expected)
      );
    }
    return false;
  }

  function observeError({ deviceId, errorKey, sequence, value }) {
    expireDue();
    for (const row of sql.pendingForDevice.all(deviceId)) {
      if (!errorMatches(row, errorKey, sequence, value)) continue;
      const reason =
        value?.recognized_reason && typeof value.reason === 'string'
          ? `firmware_${value.reason}`
          : 'firmware_rejected';
      finish(row.id, 'rejected', reason);
    }
  }

  function expireDue() {
    const now = clock();
    for (const row of sql.due.all(now)) {
      const existing = sql.getById.get(row.id);
      timeoutOrConfirm(existing);
    }
  }

  function recover() {
    const now = clock();
    sql.interruptPrepared.run({ now });
    for (const row of sql.allPending.all()) {
      if (row.timeout_at <= now) {
        timeoutOrConfirm(row);
      } else {
        scheduleDeadline(row);
      }
    }
    for (const { id } of stmts.getKnownDeviceIds.all()) prune(id);
  }

  function get(deviceId, actionId) {
    expireDue();
    return sql.get.get(deviceId, actionId);
  }

  function list(deviceId, { limit = 25, cursor } = {}) {
    expireDue();
    const parsedLimit = Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new DeviceActionError(400, 'invalid_limit', 'limit must be an integer from 1 to 100.');
    }
    const decoded = decodeCursor(cursor);
    const rows = decoded
      ? sql.historyAfter.all({
          device_id: deviceId,
          created_at: decoded.createdAt,
          id: decoded.id,
          limit: parsedLimit + 1,
        })
      : sql.historyFirst.all({ device_id: deviceId, limit: parsedLimit + 1 });
    const page = rows.slice(0, parsedLimit);
    return {
      actions: page.map(formatAction),
      next_cursor: rows.length > parsedLimit ? encodeCursor(page.at(-1)) : null,
    };
  }

  function pending(deviceId) {
    expireDue();
    return sql.pendingForDevice.all(deviceId).map(formatAction);
  }

  function availability(deviceId) {
    expireDue();
    const keys = [
      'update_outlet_config',
      'sync_time',
      'switch_to_manual',
      'return_to_auto',
      'set_manual_outlet_state',
      'emergency_all_off',
      'run_water_pump_now',
    ];
    const result = Object.fromEntries(
      keys.map((key) => [
        key,
        {
          enabled: false,
          disabled_reason: 'retained_state_syncing',
          context: {},
        },
      ]),
    );
    const connected =
      mqttService.isConnected() && mqttService.getHealth?.()?.broker?.subscriptionsReady === true;
    if (!connected) {
      for (const entry of Object.values(result)) entry.disabled_reason = 'broker_unavailable';
      return result;
    }
    const presence = state(deviceId, 'presence_state');
    const outlets = state(deviceId, 'outlet_state');
    const schedule = state(deviceId, 'schedule_state');
    if (presence.row?.compatible !== 1) return result;
    if (presence.value?.status !== 'online') {
      for (const entry of Object.values(result)) entry.disabled_reason = 'device_offline';
      return result;
    }
    const pendingRows = sql.pendingForDevice.all(deviceId);
    function setAction(type, { required = [], predicate = null, context = {} } = {}) {
      const missing = required.filter((entry) => entry.row?.compatible !== 1);
      if (missing.length > 0) {
        result[type] = {
          enabled: false,
          disabled_reason: 'retained_state_syncing',
          context: { missing_states: missing.map((entry) => entry.key) },
        };
        return;
      }
      const confirmation = type === 'update_outlet_config' ? { assignment_changed: true } : {};
      const blocker = pendingRows.find((row) => actionsConflict(type, confirmation, row));
      if (blocker) {
        result[type] = {
          enabled: false,
          disabled_reason: 'pending_action_conflict',
          context: { blocking_action_id: blocker.id, blocking_action_type: blocker.type },
        };
        return;
      }
      const reason = predicate?.();
      result[type] = reason
        ? {
            enabled: false,
            disabled_reason: reason,
            context,
          }
        : { enabled: true, disabled_reason: null, context };
    }
    const outletState = { ...outlets, key: 'outlet_state' };
    const scheduleState = { ...schedule, key: 'schedule_state' };
    setAction('update_outlet_config', { required: [outletState, scheduleState] });
    setAction('sync_time', { required: [scheduleState] });
    setAction('switch_to_manual', { required: [scheduleState] });
    setAction('return_to_auto', {
      required: [scheduleState],
      context: { warnings: schedule.value?.warnings ?? [] },
    });
    setAction('set_manual_outlet_state', {
      required: [outletState, scheduleState],
      predicate: () => (schedule.value?.mode === 'manual' ? null : 'manual_mode_required'),
    });
    setAction('emergency_all_off', { required: [scheduleState] });
    setAction('run_water_pump_now', {
      required: [outletState, scheduleState],
      predicate: () => {
        if (schedule.value?.mode !== 'auto') return 'auto_mode_required';
        const scheduledIds = new Set(
          (schedule.value?.schedule?.outlets ?? [])
            .filter((entry) => entry.conditions?.some((condition) => condition.type === 'interval'))
            .map((entry) => entry.id),
        );
        const eligible = (outlets.value?.outlets ?? []).some(
          (outlet) => outlet.assignment === 'Water Pump' && scheduledIds.has(outlet.id),
        );
        return eligible ? null : 'pump_schedule_required';
      },
    });
    return result;
  }

  function prune(deviceId) {
    sql.deleteOldTerminal.run(clock() - HISTORY_MAX_AGE_MS);
    sql.trimTerminal.run({ device_id: deviceId });
  }

  function addTerminalListener(listener) {
    terminalListeners.add(listener);
    return () => terminalListeners.delete(listener);
  }

  function addTerminalMutator(mutator) {
    terminalMutators.add(mutator);
    return () => terminalMutators.delete(mutator);
  }

  function registerHandler(type, handler) {
    if (!ACTION_TYPES.has(type) || !handler || typeof handler.prepare !== 'function') {
      throw new TypeError('A valid canonical action handler is required.');
    }
    handlers.set(type, handler);
    return () => handlers.delete(type);
  }

  function close() {
    for (const handle of deadlines.values()) clearTimeoutFn(handle);
    deadlines.clear();
  }

  return {
    addTerminalListener,
    addTerminalMutator,
    availability,
    close,
    expireDue,
    formatAction,
    get,
    list,
    observeError,
    observeState,
    pending,
    prune,
    recover,
    registerHandler,
    submit,
  };
}

module.exports = {
  ACTION_TYPES,
  ActionBlockedCondition,
  CONFIRMATION_TIMEOUT_MS,
  LATE_SCHEDULE_CONFIRMATION_GRACE_MS,
  DeviceActionError,
  MQTT_ACTION_TYPES,
  PUBLISH_ACK_WAIT_MS,
  createDeviceActionEngine,
  formatAction,
  normalizeOutlets,
  normalizeSchedule,
  outletFingerprint,
  relayMask,
  sameOutlets,
  sameSchedule,
};
