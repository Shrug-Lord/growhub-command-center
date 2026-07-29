'use strict';

const crypto = require('node:crypto');

const DEVICE_EVENT_MAX_AGE_MS = 30 * 86_400_000;
const {
  ActionBlockedCondition,
  DeviceActionError,
  normalizeSchedule,
  outletFingerprint,
  sameSchedule,
} = require('./deviceActions');

const ASSIGNMENTS = Object.freeze([
  'Light',
  'Fan',
  'Humidifier',
  'Dehumidifier',
  'Water Pump',
  'Heater',
  'AC Controller',
]);
const ASSIGNMENT_SET = new Set(ASSIGNMENTS);
const CONDITIONS_BY_ASSIGNMENT = Object.freeze({
  Light: new Set(['always_on', 'time_window']),
  Fan: new Set(['always_on', 'time_window', 'temp_high_band_c', 'rh_high_band']),
  Humidifier: new Set(['rh_low_band']),
  Dehumidifier: new Set(['rh_high_band']),
  'Water Pump': new Set(['interval']),
  Heater: new Set(['temp_low_band_c']),
  'AC Controller': new Set(['temp_high_band_c']),
});
const DRIFT_REASONS = new Set([
  'firmware_schedule_cleared',
  'outlet_assignment_changed',
  'schedule_body_changed',
  'unknown_firmware_change',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function exactKeys(value, allowed) {
  return isRecord(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function asIso(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function validFingerprint(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function clockMinutes(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function windowDuration(start, end) {
  const from = clockMinutes(start);
  const to = clockMinutes(end);
  if (from === null || to === null || from === to) return null;
  return (to - from + 1_440) % 1_440;
}

function normalizeCondition(condition, assignment) {
  if (!isRecord(condition) || typeof condition.type !== 'string') return null;
  if (!CONDITIONS_BY_ASSIGNMENT[assignment]?.has(condition.type)) return null;

  if (condition.type === 'always_on') {
    return exactKeys(condition, ['type']) ? { type: 'always_on' } : null;
  }
  if (condition.type === 'time_window') {
    if (
      !exactKeys(condition, ['type', 'start', 'end']) ||
      windowDuration(condition.start, condition.end) === null
    )
      return null;
    return { type: condition.type, start: condition.start, end: condition.end };
  }
  if (condition.type === 'rh_low_band' || condition.type === 'rh_high_band') {
    if (
      !exactKeys(condition, ['type', 'low', 'high']) ||
      typeof condition.low !== 'number' ||
      typeof condition.high !== 'number' ||
      !Number.isFinite(condition.low) ||
      !Number.isFinite(condition.high) ||
      condition.low < 10 ||
      condition.high > 95 ||
      condition.high - condition.low < 2
    )
      return null;
    return { type: condition.type, low: condition.low, high: condition.high };
  }
  if (condition.type === 'temp_low_band_c' || condition.type === 'temp_high_band_c') {
    if (
      !exactKeys(condition, ['type', 'low_c', 'high_c']) ||
      typeof condition.low_c !== 'number' ||
      typeof condition.high_c !== 'number' ||
      !Number.isFinite(condition.low_c) ||
      !Number.isFinite(condition.high_c) ||
      condition.low_c < 0 ||
      condition.high_c > 50 ||
      condition.high_c - condition.low_c < 1
    )
      return null;
    return { type: condition.type, low_c: condition.low_c, high_c: condition.high_c };
  }

  if (
    !exactKeys(condition, ['type', 'run_mins', 'every_hrs', 'window']) ||
    !Number.isInteger(condition.run_mins) ||
    condition.run_mins < 1 ||
    condition.run_mins > 240 ||
    !Number.isInteger(condition.every_hrs) ||
    condition.every_hrs < 1 ||
    condition.every_hrs > 168
  )
    return null;
  const normalized = {
    type: 'interval',
    run_mins: condition.run_mins,
    every_hrs: condition.every_hrs,
  };
  if (condition.window !== undefined) {
    if (!exactKeys(condition.window, ['start', 'end'])) return null;
    const duration = windowDuration(condition.window.start, condition.window.end);
    if (duration === null || duration < condition.run_mins) return null;
    normalized.window = { start: condition.window.start, end: condition.window.end };
  }
  return normalized;
}

function normalizeRole(role, { uuid = crypto.randomUUID } = {}) {
  if (
    !isRecord(role) ||
    !exactKeys(role, ['id', 'assignment', 'label', 'conditions']) ||
    !ASSIGNMENT_SET.has(role.assignment) ||
    typeof role.label !== 'string' ||
    role.label !== role.label.trim() ||
    Buffer.byteLength(role.label, 'utf8') < 1 ||
    Buffer.byteLength(role.label, 'utf8') > 32 ||
    /[\u0000-\u001f\u007f]/.test(role.label) ||
    !Array.isArray(role.conditions) ||
    role.conditions.length < 1
  )
    return null;
  const id = role.id === undefined ? uuid() : role.id;
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) return null;
  const conditions = role.conditions.map((condition) =>
    normalizeCondition(condition, role.assignment),
  );
  if (conditions.some((condition) => condition === null)) return null;
  const types = conditions.map((condition) => condition.type);
  if (new Set(types).size !== types.length || (types.includes('always_on') && types.length !== 1))
    return null;
  if (role.assignment !== 'Fan' && conditions.length !== 1) return null;
  return { id, assignment: role.assignment, label: role.label, conditions };
}

function normalizeTemplateInput(input, { uuid = crypto.randomUUID } = {}) {
  if (
    !isRecord(input) ||
    !exactKeys(input, ['name', 'description', 'roles']) ||
    typeof input.name !== 'string' ||
    input.name.trim() !== input.name ||
    input.name.length < 1 ||
    input.name.length > 80 ||
    (input.description !== undefined && typeof input.description !== 'string') ||
    (input.description?.length ?? 0) > 500 ||
    !Array.isArray(input.roles) ||
    input.roles.length < 1 ||
    input.roles.length > 4
  ) {
    throw new DeviceActionError(400, 'invalid_template', 'The schedule template is invalid.');
  }
  const roles = input.roles.map((role) => normalizeRole(role, { uuid }));
  if (
    roles.some((role) => role === null) ||
    new Set(roles.map((role) => role.id)).size !== roles.length ||
    new Set(roles.map((role) => `${role.assignment}\u0000${role.label.toLowerCase()}`)).size !==
      roles.length
  ) {
    throw new DeviceActionError(
      400,
      'invalid_template',
      'Template roles must be valid and uniquely identified.',
    );
  }
  return {
    name: input.name,
    description: input.description ?? '',
    roles,
  };
}

function canonicalSchedule(schedule) {
  const normalized = normalizeSchedule(schedule);
  if (!normalized) return null;
  return {
    v: 3,
    outlets: normalized.outlets.map((outlet) => ({
      id: outlet.id,
      conditions: outlet.conditions.map((condition) => {
        if (condition.type === 'always_on') return { type: condition.type };
        if (condition.type === 'time_window') {
          return { type: condition.type, start: condition.start, end: condition.end };
        }
        if (condition.type === 'rh_low_band' || condition.type === 'rh_high_band') {
          return { type: condition.type, low: condition.low, high: condition.high };
        }
        if (condition.type === 'temp_low_band_c' || condition.type === 'temp_high_band_c') {
          return { type: condition.type, low_c: condition.low_c, high_c: condition.high_c };
        }
        const result = {
          type: 'interval',
          run_mins: condition.run_mins,
          every_hrs: condition.every_hrs,
        };
        if (condition.window) {
          result.window = { start: condition.window.start, end: condition.window.end };
        }
        return result;
      }),
    })),
  };
}

function scheduleFingerprint(schedule) {
  const canonical = canonicalSchedule(schedule);
  return fingerprint(canonical);
}

function normalizeMappingInput(value) {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new DeviceActionError(400, 'invalid_action_input', 'Role mappings must be an object.');
  }
  const result = {};
  for (const [roleId, outletId] of Object.entries(value)) {
    if (!Number.isInteger(outletId) || outletId < 1 || outletId > 4) {
      throw new DeviceActionError(
        400,
        'invalid_action_input',
        'Mapped outlet ids must be physical outlets 1 through 4.',
      );
    }
    result[roleId] = outletId;
  }
  return result;
}

function labelConflicts(outlets) {
  const groups = new Map();
  for (const outlet of outlets ?? []) {
    if (outlet.assignment === 'None') continue;
    const key = outlet.label.trim().toLowerCase();
    const group = groups.get(key) ?? [];
    group.push(outlet);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const sorted = [...group].sort((a, b) => a.id - b.id);
      return {
        label: sorted[0].label,
        outlet_ids: sorted.map((outlet) => outlet.id),
        suggestions: sorted.map((outlet, index) => ({
          id: outlet.id,
          label: `${outlet.label} ${index + 1}`.slice(0, 32),
        })),
      };
    });
}

function formatTemplate(row, deployments = null) {
  if (!row) return null;
  const editor = parseJson(row.editor_state_json ?? row.settings, {});
  const result = {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    revision: row.revision,
    status: row.status,
    roles: Array.isArray(editor.roles) ? editor.roles : [],
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
  if (deployments !== null) result.deployments = deployments;
  return result;
}

function conditionSummary(condition) {
  if (condition.type === 'always_on') return 'Always on';
  if (condition.type === 'time_window') return `${condition.start}-${condition.end}`;
  if (condition.type === 'rh_low_band')
    return `Below ${condition.low}% RH, off at ${condition.high}%`;
  if (condition.type === 'rh_high_band')
    return `Above ${condition.high}% RH, off at ${condition.low}%`;
  if (condition.type === 'temp_low_band_c')
    return `Below ${condition.low_c} C, off at ${condition.high_c} C`;
  if (condition.type === 'temp_high_band_c')
    return `Above ${condition.high_c} C, off at ${condition.low_c} C`;
  const window = condition.window
    ? ` during ${condition.window.start}-${condition.window.end}`
    : '';
  return `${condition.run_mins} min every ${condition.every_hrs} hr${window}`;
}

function scheduleDiff(expected, actual, outlets = []) {
  const expectedById = new Map(
    (canonicalSchedule(expected)?.outlets ?? []).map((entry) => [entry.id, entry]),
  );
  const actualById = new Map(
    (canonicalSchedule(actual)?.outlets ?? []).map((entry) => [entry.id, entry]),
  );
  const outletById = new Map(outlets.map((outlet) => [outlet.id, outlet]));
  const changes = [];
  let unchangedCount = 0;
  for (const id of [1, 2, 3, 4]) {
    const before = expectedById.get(id);
    const after = actualById.get(id);
    const outlet = outletById.get(id);
    const label = outlet?.label ?? `Outlet ${id}`;
    if (!before && !after) continue;
    if (before && after && JSON.stringify(before) === JSON.stringify(after)) {
      unchangedCount += 1;
    } else if (!before) {
      changes.push({
        type: 'added',
        outlet_id: id,
        label,
        current: after.conditions.map(conditionSummary),
      });
    } else if (!after) {
      changes.push({
        type: 'removed',
        outlet_id: id,
        label,
        expected: before.conditions.map(conditionSummary),
      });
    } else {
      changes.push({
        type: 'changed',
        outlet_id: id,
        label,
        expected: before.conditions.map(conditionSummary),
        current: after.conditions.map(conditionSummary),
      });
    }
  }
  return { changes, unchanged_count: unchangedCount };
}

function createScheduleTemplateService({
  database,
  mqttService,
  actionEngine,
  logger,
  clock = () => Date.now(),
  uuid = crypto.randomUUID,
} = {}) {
  const { db, stmts } = database;
  const sql = {
    listTemplates: db.prepare(`
      SELECT id, name, description, revision, status, editor_state_json, created_at, updated_at
      FROM schedule_templates ORDER BY name COLLATE NOCASE ASC, id ASC
    `),
    getTemplate: db.prepare(`
      SELECT id, name, description, revision, status, editor_state_json, created_at, updated_at
      FROM schedule_templates WHERE id = ?
    `),
    insertTemplate: db.prepare(`
      INSERT INTO schedule_templates (
        name, description, revision, status, editor_state_json, created_at, updated_at
      ) VALUES (@name, @description, 1, 'load_ready', @editor_state_json, @now, @now)
    `),
    updateTemplate: db.prepare(`
      UPDATE schedule_templates
      SET name = @name, description = @description, revision = revision + 1,
          status = 'load_ready', editor_state_json = @editor_state_json, updated_at = @now
      WHERE id = @id
    `),
    deleteTemplate: db.prepare(`DELETE FROM schedule_templates WHERE id = ?`),
    insertRevision: db.prepare(`
      INSERT INTO schedule_template_revisions (
        id, template_id, revision, name, description, roles_json, created_at
      ) VALUES (@id, @template_id, @revision, @name, @description, @roles_json, @created_at)
    `),
    getRevision: db.prepare(`SELECT * FROM schedule_template_revisions WHERE id = ?`),
    listRevisions: db.prepare(`
      SELECT id, template_id, revision, name, description, roles_json, created_at
      FROM schedule_template_revisions WHERE template_id = ? ORDER BY revision DESC
    `),
    getCurrentRevision: db.prepare(`
      SELECT * FROM schedule_template_revisions
      WHERE template_id = ? ORDER BY revision DESC LIMIT 1
    `),
    deleteRoleConditions: db.prepare(`DELETE FROM schedule_role_conditions WHERE role_id = ?`),
    listRoleIds: db.prepare(`SELECT id FROM schedule_template_roles WHERE template_id = ?`),
    tempRole: db.prepare(`UPDATE schedule_template_roles SET label = @label WHERE id = @id`),
    updateRole: db.prepare(`
      UPDATE schedule_template_roles
      SET assignment = @assignment, label = @label, position = @position, updated_at = @now
      WHERE id = @id AND template_id = @template_id
    `),
    insertRole: db.prepare(`
      INSERT INTO schedule_template_roles (
        id, template_id, assignment, label, position, created_at, updated_at
      ) VALUES (@id, @template_id, @assignment, @label, @position, @now, @now)
    `),
    deleteRole: db.prepare(`DELETE FROM schedule_template_roles WHERE id = ? AND template_id = ?`),
    insertCondition: db.prepare(`
      INSERT INTO schedule_role_conditions (
        id, role_id, condition_type, condition_json, position, created_at, updated_at
      ) VALUES (@id, @role_id, @condition_type, @condition_json, @position, @now, @now)
    `),
    deploymentSummary: db.prepare(`
      SELECT e.device_id, e.template_revision, e.established_at,
        d.display_name, d.reported_name,
        CASE WHEN drift.id IS NULL THEN 0 ELSE 1 END AS drifted
      FROM device_expected_schedules e
      JOIN devices d ON d.id = e.device_id
      LEFT JOIN schedule_drift_episodes drift
        ON drift.device_id = e.device_id AND drift.resolved_at IS NULL
      WHERE e.template_id = ? ORDER BY e.established_at DESC
    `),
    getSetupReview: db.prepare(`SELECT * FROM device_setup_reviews WHERE device_id = ?`),
    upsertSetupReview: db.prepare(`
      INSERT INTO device_setup_reviews (device_id, outlet_fingerprint, reviewed_at, action_id)
      VALUES (@device_id, @outlet_fingerprint, @reviewed_at, @action_id)
      ON CONFLICT(device_id) DO UPDATE SET
        outlet_fingerprint = excluded.outlet_fingerprint,
        reviewed_at = excluded.reviewed_at,
        action_id = excluded.action_id
    `),
    getMappings: db.prepare(`
      SELECT template_id, role_id, device_id, outlet_id, assignment_snapshot,
        expected_label_snapshot, updated_at
      FROM device_role_mappings WHERE template_id = ? AND device_id = ?
    `),
    getDeviceMappings: db.prepare(`
      SELECT template_id, role_id, device_id, outlet_id, assignment_snapshot,
        expected_label_snapshot, updated_at
      FROM device_role_mappings WHERE device_id = ?
    `),
    deleteMappingsForTemplateDevice: db.prepare(`
      DELETE FROM device_role_mappings WHERE template_id = ? AND device_id = ?
    `),
    deleteMappingsForDevice: db.prepare(`DELETE FROM device_role_mappings WHERE device_id = ?`),
    deleteMapping: db.prepare(
      `DELETE FROM device_role_mappings WHERE role_id = ? AND device_id = ?`,
    ),
    insertMapping: db.prepare(`
      INSERT INTO device_role_mappings (
        template_id, role_id, device_id, outlet_id, assignment_snapshot,
        expected_label_snapshot, updated_at
      ) VALUES (
        @template_id, @role_id, @device_id, @outlet_id, @assignment_snapshot,
        @expected_label_snapshot, @updated_at
      )
    `),
    updateMappingLabel: db.prepare(`
      UPDATE device_role_mappings SET expected_label_snapshot = @label, updated_at = @updated_at
      WHERE template_id = @template_id AND role_id = @role_id
        AND device_id = @device_id AND outlet_id = @outlet_id
    `),
    getExpected: db.prepare(`SELECT * FROM device_expected_schedules WHERE device_id = ?`),
    upsertExpected: db.prepare(`
      INSERT INTO device_expected_schedules (
        device_id, template_id, template_name, template_revision,
        expected_schedule_json, role_mapping_json, established_at,
        template_revision_id, expected_fingerprint, source_action_id
      ) VALUES (
        @device_id, @template_id, @template_name, @template_revision,
        @expected_schedule_json, @role_mapping_json, @established_at,
        @template_revision_id, @expected_fingerprint, @source_action_id
      )
      ON CONFLICT(device_id) DO UPDATE SET
        template_id = excluded.template_id,
        template_name = excluded.template_name,
        template_revision = excluded.template_revision,
        expected_schedule_json = excluded.expected_schedule_json,
        role_mapping_json = excluded.role_mapping_json,
        established_at = excluded.established_at,
        template_revision_id = excluded.template_revision_id,
        expected_fingerprint = excluded.expected_fingerprint,
        source_action_id = excluded.source_action_id
    `),
    deleteExpected: db.prepare(`DELETE FROM device_expected_schedules WHERE device_id = ?`),
    getActiveDrift: db.prepare(`
      SELECT * FROM schedule_drift_episodes WHERE device_id = ? AND resolved_at IS NULL
    `),
    insertEvent: db.prepare(`
      INSERT INTO device_events (id, device_id, type, context_json, occurred_at, created_at)
      VALUES (@id, @device_id, @type, @context_json, @occurred_at, @created_at)
    `),
    insertDrift: db.prepare(`
      INSERT INTO schedule_drift_episodes (
        id, device_id, detection_event_id, expected_fingerprint, reason, started_at
      ) VALUES (@id, @device_id, @detection_event_id, @expected_fingerprint, @reason, @started_at)
    `),
    resolveDrift: db.prepare(`
      UPDATE schedule_drift_episodes
      SET resolved_at = @resolved_at, resolution = @resolution,
          reconciliation_event_id = @reconciliation_event_id
      WHERE id = @id AND resolved_at IS NULL
    `),
    listActivityFirst: db.prepare(`
      SELECT kind, occurred_at, sort_id, payload_id FROM (
        SELECT 'action' AS kind, created_at AS occurred_at,
          'a:' || id AS sort_id, id AS payload_id
        FROM device_actions WHERE device_id = @device_id
        UNION ALL
        SELECT 'device_event', occurred_at, 'e:' || id, id
        FROM device_events WHERE device_id = @device_id
      ) ORDER BY occurred_at DESC, sort_id DESC LIMIT @limit
    `),
    listActivityAfter: db.prepare(`
      SELECT kind, occurred_at, sort_id, payload_id FROM (
        SELECT 'action' AS kind, created_at AS occurred_at,
          'a:' || id AS sort_id, id AS payload_id
        FROM device_actions WHERE device_id = @device_id
        UNION ALL
        SELECT 'device_event', occurred_at, 'e:' || id, id
        FROM device_events WHERE device_id = @device_id
      ) WHERE occurred_at < @occurred_at
        OR (occurred_at = @occurred_at AND sort_id < @sort_id)
      ORDER BY occurred_at DESC, sort_id DESC LIMIT @limit
    `),
    getActionById: db.prepare(`SELECT * FROM device_actions WHERE id = ?`),
    getEventById: db.prepare(`SELECT * FROM device_events WHERE id = ?`),
    deleteOldDeviceEvents: db.prepare(`
      DELETE FROM device_events
      WHERE occurred_at < ?
        AND id NOT IN (
          SELECT detection_event_id FROM schedule_drift_episodes
          UNION
          SELECT reconciliation_event_id FROM schedule_drift_episodes
          WHERE reconciliation_event_id IS NOT NULL
        )
    `),
    trimDeviceEvents: db.prepare(`
      DELETE FROM device_events
      WHERE device_id = @device_id
        AND id NOT IN (
        SELECT id FROM device_events WHERE device_id = @device_id
        ORDER BY occurred_at DESC, id DESC LIMIT 100
      )
        AND id NOT IN (
          SELECT detection_event_id FROM schedule_drift_episodes
          UNION
          SELECT reconciliation_event_id FROM schedule_drift_episodes
          WHERE reconciliation_event_id IS NOT NULL
        )
    `),
    deleteOldResolvedDrifts: db.prepare(`
      DELETE FROM schedule_drift_episodes
      WHERE resolved_at IS NOT NULL AND resolved_at < ?
    `),
    trimResolvedDrifts: db.prepare(`
      DELETE FROM schedule_drift_episodes
      WHERE device_id = @device_id AND resolved_at IS NOT NULL AND id NOT IN (
        SELECT id FROM schedule_drift_episodes
        WHERE device_id = @device_id AND resolved_at IS NOT NULL
        ORDER BY resolved_at DESC, id DESC LIMIT 100
      )
    `),
  };

  function pruneDeviceEvents(deviceId, now = clock()) {
    sql.deleteOldResolvedDrifts.run(now - DEVICE_EVENT_MAX_AGE_MS);
    sql.trimResolvedDrifts.run({ device_id: deviceId });
    sql.deleteOldDeviceEvents.run(now - DEVICE_EVENT_MAX_AGE_MS);
    sql.trimDeviceEvents.run({ device_id: deviceId });
  }

  function mirror(deviceId, stateKey) {
    const row = stmts.getDeviceStateMirror.get(deviceId, stateKey);
    return { row, value: parseJson(row?.normalized_json) };
  }

  function syncNormalizedRoles(templateId, roles, now) {
    const previousIds = new Set(sql.listRoleIds.all(templateId).map((row) => row.id));
    const nextIds = new Set(roles.map((role) => role.id));
    for (const id of previousIds) {
      if (!nextIds.has(id)) sql.deleteRole.run(id, templateId);
    }
    for (const id of previousIds) {
      if (nextIds.has(id)) sql.tempRole.run({ id, label: `pending-${id}`.slice(0, 32) });
    }
    roles.forEach((role, position) => {
      if (previousIds.has(role.id)) {
        sql.updateRole.run({
          id: role.id,
          template_id: templateId,
          assignment: role.assignment,
          label: role.label,
          position,
          now,
        });
      } else {
        sql.insertRole.run({
          id: role.id,
          template_id: templateId,
          assignment: role.assignment,
          label: role.label,
          position,
          now,
        });
      }
      sql.deleteRoleConditions.run(role.id);
      role.conditions.forEach((condition, conditionPosition) => {
        sql.insertCondition.run({
          id: uuid(),
          role_id: role.id,
          condition_type: condition.type,
          condition_json: JSON.stringify(condition),
          position: conditionPosition,
          now,
        });
      });
    });
  }

  function persistRevision(template, now) {
    const revisionId = uuid();
    sql.insertRevision.run({
      id: revisionId,
      template_id: template.id,
      revision: template.revision,
      name: template.name,
      description: template.description,
      roles_json: JSON.stringify(template.roles),
      created_at: now,
    });
    return revisionId;
  }

  function createTemplate(input, { now = clock() } = {}) {
    const normalized = normalizeTemplateInput(input, { uuid });
    const create = db.transaction(() => {
      const info = sql.insertTemplate.run({
        name: normalized.name,
        description: normalized.description,
        editor_state_json: JSON.stringify({ roles: normalized.roles }),
        now,
      });
      const templateId = Number(info.lastInsertRowid);
      syncNormalizedRoles(templateId, normalized.roles, now);
      const row = sql.getTemplate.get(templateId);
      persistRevision({ ...normalized, id: templateId, revision: row.revision }, now);
      return sql.getTemplate.get(templateId);
    });
    return formatTemplate(create());
  }

  function updateTemplate(templateId, input, { now = clock() } = {}) {
    const id = Number(templateId);
    const current = sql.getTemplate.get(id);
    if (!current)
      throw new DeviceActionError(404, 'template_not_found', 'Schedule template not found.');
    const normalized = normalizeTemplateInput(input, { uuid });
    const update = db.transaction(() => {
      sql.updateTemplate.run({
        id,
        name: normalized.name,
        description: normalized.description,
        editor_state_json: JSON.stringify({ roles: normalized.roles }),
        now,
      });
      syncNormalizedRoles(id, normalized.roles, now);
      const row = sql.getTemplate.get(id);
      persistRevision({ ...normalized, id, revision: row.revision }, now);
      return row;
    });
    return formatTemplate(update());
  }

  function listTemplates() {
    return sql.listTemplates.all().map((row) => {
      const deployments = sql.deploymentSummary.all(row.id);
      return formatTemplate(row, {
        device_count: deployments.length,
        drifted_count: deployments.filter((deployment) => deployment.drifted === 1).length,
        update_available_count: deployments.filter(
          (deployment) => deployment.template_revision < row.revision,
        ).length,
      });
    });
  }

  function getTemplate(templateId) {
    const row = sql.getTemplate.get(Number(templateId));
    if (!row)
      throw new DeviceActionError(404, 'template_not_found', 'Schedule template not found.');
    return formatTemplate(row, {
      devices: sql.deploymentSummary.all(row.id).map((deployment) => ({
        device_id: deployment.device_id,
        device_name: deployment.display_name ?? deployment.reported_name ?? deployment.device_id,
        loaded_revision: deployment.template_revision,
        update_available: deployment.template_revision < row.revision,
        drifted: deployment.drifted === 1,
        established_at: asIso(deployment.established_at),
      })),
    });
  }

  function listRevisions(templateId) {
    getTemplate(templateId);
    return sql.listRevisions.all(Number(templateId)).map((row) => ({
      id: row.id,
      template_id: row.template_id,
      revision: row.revision,
      name: row.name,
      description: row.description,
      roles: parseJson(row.roles_json, []),
      created_at: asIso(row.created_at),
    }));
  }

  function deleteTemplate(templateId) {
    const template = getTemplate(templateId);
    const pending = db
      .prepare(
        `
      SELECT id FROM device_actions
      WHERE status = 'pending'
        AND type IN ('load_schedule', 'reload_expected_schedule')
        AND json_extract(context_json, '$.template_id') = ?
      LIMIT 1
    `,
      )
      .get(template.id);
    if (pending) {
      throw new DeviceActionError(
        409,
        'template_in_use',
        'The template has a pending device load and cannot be deleted yet.',
      );
    }
    const result = sql.deleteTemplate.run(Number(templateId));
    return { id: template.id, deleted: result.changes === 1 };
  }

  function setupState(deviceId, outlets = mirror(deviceId, 'outlet_state').value?.outlets ?? []) {
    const currentFingerprint = outletFingerprint(outlets);
    const review = sql.getSetupReview.get(deviceId);
    const conflicts = labelConflicts(outlets);
    return {
      status:
        currentFingerprint && review?.outlet_fingerprint === currentFingerprint
          ? 'confirmed'
          : 'needs_review',
      current: Boolean(currentFingerprint && review?.outlet_fingerprint === currentFingerprint),
      outlet_fingerprint: currentFingerprint,
      reviewed_at: asIso(review?.reviewed_at),
      label_conflicts: conflicts,
      can_confirm: Boolean(currentFingerprint && conflicts.length === 0),
    };
  }

  function compileSchedule(template, mappings) {
    return {
      v: 3,
      outlets: template.roles
        .map((role) => ({
          id: mappings[role.id],
          conditions: role.conditions,
        }))
        .sort((a, b) => a.id - b.id),
    };
  }

  function buildWarnings({ template, mappings, outlets, scheduleState, activeDrift }) {
    const warnings = [];
    const mappedIds = new Set(Object.values(mappings));
    for (const role of template.roles) {
      const outlet = outlets.find((entry) => entry.id === mappings[role.id]);
      if (outlet && outlet.label !== role.label) {
        warnings.push({
          code: 'label_drift',
          role_id: role.id,
          outlet_id: outlet.id,
          expected_label: role.label,
          firmware_label: outlet.label,
        });
      }
    }
    const extraOutlets = outlets
      .filter((outlet) => outlet.assignment !== 'None' && !mappedIds.has(outlet.id))
      .map((outlet) => ({ id: outlet.id, assignment: outlet.assignment, label: outlet.label }));
    if (extraOutlets.length > 0)
      warnings.push({ code: 'extra_assigned_outlets', outlets: extraOutlets });
    const activeIds = new Set(scheduleState?.schedule?.outlets?.map((outlet) => outlet.id) ?? []);
    const removedIds = [...activeIds].filter((id) => !mappedIds.has(id)).sort((a, b) => a - b);
    if (removedIds.length > 0) {
      warnings.push({ code: 'active_entries_will_be_removed', outlet_ids: removedIds });
    }
    if (activeDrift)
      warnings.push({ code: 'schedule_drift_will_be_replaced', drift_episode_id: activeDrift.id });
    for (const warning of scheduleState?.warnings ?? []) {
      warnings.push({
        code: warning.code,
        message: warning.message,
        severity: warning.severity,
        outlet_ids: warning.outlets ?? [],
        remediation: warning.code === 'time_sync_required' ? 'sync_time' : null,
      });
    }
    return warnings.sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  }

  function preflight(deviceId, templateId, requestedMappings = {}) {
    const device = stmts.getDevice.get(deviceId);
    if (!device) throw new DeviceActionError(404, 'device_not_found', 'Device not found.');
    const template = getTemplate(templateId);
    const mappingsInput = normalizeMappingInput(requestedMappings);
    if (
      Object.keys(mappingsInput).some(
        (roleId) => !template.roles.some((role) => role.id === roleId),
      )
    ) {
      throw new DeviceActionError(
        400,
        'invalid_action_input',
        'A role mapping references an unknown role.',
      );
    }

    const presence = mirror(deviceId, 'presence_state');
    const outletState = mirror(deviceId, 'outlet_state');
    const scheduleMirror = mirror(deviceId, 'schedule_state');
    const blockers = [];
    if (
      !mqttService?.isConnected?.() ||
      mqttService.getHealth?.().broker.subscriptionsReady !== true
    ) {
      blockers.push({ code: 'broker_unavailable' });
    }
    if (!presence.row || presence.row.compatible !== 1)
      blockers.push({ code: 'retained_state_syncing', state: 'presence_state' });
    else if (presence.value?.status !== 'online') blockers.push({ code: 'device_offline' });
    if (!outletState.row || outletState.row.compatible !== 1)
      blockers.push({ code: 'retained_state_syncing', state: 'outlet_state' });
    if (!scheduleMirror.row || scheduleMirror.row.compatible !== 1)
      blockers.push({ code: 'retained_state_syncing', state: 'schedule_state' });

    const outlets = outletState.value?.outlets ?? [];
    const setup = setupState(deviceId, outlets);
    if (!setup.current) {
      blockers.push({
        code: 'device_setup_review_required',
        review_blocked_by: setup.label_conflicts.length > 0 ? 'outlet_label_conflict' : null,
      });
    }

    const saved = new Map(
      sql.getMappings.all(template.id, deviceId).map((mapping) => [mapping.role_id, mapping]),
    );
    const mappings = {};
    const mappingSources = {};
    const usedOutlets = new Set();
    for (const role of template.roles) {
      let outletId = mappingsInput[role.id];
      let source = 'explicit';
      if (outletId === undefined) {
        const savedMapping = saved.get(role.id);
        const savedOutlet = outlets.find((outlet) => outlet.id === savedMapping?.outlet_id);
        if (savedOutlet?.assignment === role.assignment) {
          outletId = savedOutlet.id;
          source = 'saved';
        }
      }
      const candidates = outlets.filter((outlet) => outlet.assignment === role.assignment);
      if (outletId === undefined && candidates.length === 1) {
        outletId = candidates[0].id;
        source = 'inferred_assignment';
      }
      if (outletId === undefined && candidates.length > 1) {
        const labelMatches = candidates.filter((outlet) => outlet.label === role.label);
        if (labelMatches.length === 1) {
          outletId = labelMatches[0].id;
          source = 'inferred_label';
        }
      }
      if (outletId === undefined) {
        blockers.push({
          code: candidates.length === 0 ? 'missing_assignment' : 'ambiguous_assignment',
          role_id: role.id,
          assignment: role.assignment,
          candidate_outlet_ids: candidates.map((outlet) => outlet.id),
        });
        continue;
      }
      const outlet = outlets.find((entry) => entry.id === outletId);
      if (!outlet || outlet.assignment !== role.assignment) {
        blockers.push({
          code: 'incompatible_assignment',
          role_id: role.id,
          outlet_id: outletId,
          expected_assignment: role.assignment,
          actual_assignment: outlet?.assignment ?? null,
        });
        continue;
      }
      if (usedOutlets.has(outletId)) {
        blockers.push({ code: 'duplicate_role_mapping', role_id: role.id, outlet_id: outletId });
        continue;
      }
      usedOutlets.add(outletId);
      mappings[role.id] = outletId;
      mappingSources[role.id] = source;
    }

    const compiledSchedule =
      Object.keys(mappings).length === template.roles.length
        ? compileSchedule(template, mappings)
        : null;
    const activeDrift = sql.getActiveDrift.get(deviceId);
    const warnings = buildWarnings({
      template,
      mappings,
      outlets,
      scheduleState: scheduleMirror.value,
      activeDrift,
    });
    const warningSignature = fingerprint(warnings);
    return {
      device_id: deviceId,
      template,
      blockers,
      warnings,
      warning_signature: warningSignature,
      can_load: blockers.length === 0 && compiledSchedule !== null,
      mappings: template.roles.map((role) => {
        const outlet = outlets.find((entry) => entry.id === mappings[role.id]);
        return {
          role_id: role.id,
          role_label: role.label,
          assignment: role.assignment,
          outlet_id: mappings[role.id] ?? null,
          outlet_label: outlet?.label ?? null,
          source: mappingSources[role.id] ?? null,
        };
      }),
      mapping_object: mappings,
      preview: compiledSchedule
        ? template.roles.map((role) => {
            const outlet = outlets.find((entry) => entry.id === mappings[role.id]);
            return {
              role_id: role.id,
              role_label: role.label,
              outlet_id: outlet.id,
              outlet_label: outlet.label,
              summary: role.conditions.map(conditionSummary).join(' or '),
            };
          })
        : [],
      compiled_schedule: compiledSchedule,
      outlet_fingerprint: outletFingerprint(outlets),
      schedule_fingerprint: scheduleFingerprint(scheduleMirror.value?.schedule),
    };
  }

  function firstBlocker(preflightResult) {
    return preflightResult.blockers[0] ?? null;
  }

  function requireWarningsAcknowledged(preflightResult, signature) {
    if (preflightResult.warnings.length > 0 && signature !== preflightResult.warning_signature) {
      throw new ActionBlockedCondition('warnings_require_confirmation', {
        warnings: preflightResult.warnings,
        warning_signature: preflightResult.warning_signature,
      });
    }
  }

  function prepareLoad({ deviceId, input }) {
    const result = preflight(deviceId, input.template_id, input.mappings);
    const blocker = firstBlocker(result);
    if (blocker) throw new ActionBlockedCondition(blocker.code, blocker);
    requireWarningsAcknowledged(result, input.acknowledged_warning_signature);
    const revision = sql.getCurrentRevision.get(result.template.id);
    return {
      context: {
        template_id: result.template.id,
        template_name: result.template.name,
        template_revision: result.template.revision,
        template_revision_id: revision.id,
        mappings: result.mapping_object,
        compiled_schedule: result.compiled_schedule,
        expected_fingerprint: scheduleFingerprint(result.compiled_schedule),
        outlet_fingerprint: result.outlet_fingerprint,
        warning_codes: result.warnings.map((warning) => warning.code),
      },
      confirmation: { kind: 'schedule', schedule: result.compiled_schedule },
      requiredStateKeys: ['outlet_state', 'schedule_state'],
      errorKeys: ['schedule_error'],
      topic: `growhub/${deviceId}/grow`,
      payload: JSON.stringify(result.compiled_schedule),
      noOp: sameSchedule(
        mirror(deviceId, 'schedule_state').value?.schedule,
        result.compiled_schedule,
      ),
    };
  }

  function reloadPreflight(deviceId) {
    const expected = sql.getExpected.get(deviceId);
    if (!expected) throw new ActionBlockedCondition('missing_expected_schedule');
    const revision = expected.template_revision_id
      ? sql.getRevision.get(expected.template_revision_id)
      : null;
    if (!revision) throw new ActionBlockedCondition('missing_expected_schedule');
    const template = {
      id: expected.template_id,
      name: expected.template_name,
      revision: expected.template_revision,
      roles: parseJson(revision.roles_json, []),
    };
    const mappings = parseJson(expected.role_mapping_json, {});
    const presence = mirror(deviceId, 'presence_state');
    const outletState = mirror(deviceId, 'outlet_state');
    const scheduleMirror = mirror(deviceId, 'schedule_state');
    const blockers = [];
    if (!presence.row || presence.row.compatible !== 1) {
      blockers.push({ code: 'retained_state_syncing', state: 'presence_state' });
    } else if (presence.value?.status !== 'online') {
      blockers.push({ code: 'device_offline' });
    }
    if (!outletState.row || outletState.row.compatible !== 1) {
      blockers.push({ code: 'retained_state_syncing', state: 'outlet_state' });
    }
    if (!scheduleMirror.row || scheduleMirror.row.compatible !== 1) {
      blockers.push({ code: 'retained_state_syncing', state: 'schedule_state' });
    }
    const outlets = outletState.value?.outlets ?? [];
    const setup = setupState(deviceId, outlets);
    if (!setup.current) {
      blockers.push({
        code: 'device_setup_review_required',
        review_blocked_by: setup.label_conflicts.length > 0 ? 'outlet_label_conflict' : null,
      });
    }
    for (const role of template.roles) {
      const outletId = mappings[role.id];
      const outlet = outlets.find((entry) => entry.id === outletId);
      if (!outlet || outlet.assignment !== role.assignment) {
        blockers.push({
          code: 'incompatible_assignment',
          role_id: role.id,
          outlet_id: outletId ?? null,
          expected_assignment: role.assignment,
          actual_assignment: outlet?.assignment ?? null,
        });
      }
    }
    const expectedSchedule = parseJson(expected.expected_schedule_json);
    const warnings = buildWarnings({
      template,
      mappings,
      outlets,
      scheduleState: scheduleMirror.value,
      activeDrift: sql.getActiveDrift.get(deviceId),
    });
    const result = {
      blockers,
      warnings,
      warning_signature: fingerprint(warnings),
      compiled_schedule: expectedSchedule,
      schedule_fingerprint: scheduleFingerprint(expectedSchedule),
    };
    return { expected, result };
  }

  function establishExpectation({ deviceId, context, actionId, now }) {
    const schedule = canonicalSchedule(context.compiled_schedule);
    if (!schedule)
      throw new Error('Confirmed schedule action is missing a valid compiled schedule.');
    sql.upsertExpected.run({
      device_id: deviceId,
      template_id: context.template_id,
      template_name: context.template_name,
      template_revision: context.template_revision,
      expected_schedule_json: JSON.stringify(schedule),
      role_mapping_json: JSON.stringify(context.mappings),
      established_at: now,
      template_revision_id: context.template_revision_id,
      expected_fingerprint: scheduleFingerprint(schedule),
      source_action_id: actionId,
    });
    sql.deleteMappingsForTemplateDevice.run(context.template_id, deviceId);
    const template = formatTemplate(sql.getTemplate.get(context.template_id));
    const outlets = mirror(deviceId, 'outlet_state').value?.outlets ?? [];
    for (const role of template?.roles ?? []) {
      const outletId = context.mappings[role.id];
      const outlet = outlets.find((entry) => entry.id === outletId);
      if (!outlet) continue;
      sql.insertMapping.run({
        template_id: context.template_id,
        role_id: role.id,
        device_id: deviceId,
        outlet_id: outletId,
        assignment_snapshot: outlet.assignment,
        expected_label_snapshot: role.label,
        updated_at: now,
      });
    }
  }

  function reconcileDrift(deviceId, resolution, actionId, now) {
    const episode = sql.getActiveDrift.get(deviceId);
    if (!episode) return false;
    const eventId = uuid();
    sql.insertEvent.run({
      id: eventId,
      device_id: deviceId,
      type: 'schedule_drift_reconciled',
      context_json: JSON.stringify({
        detection_event_id: episode.detection_event_id,
        resolution,
        action_id: actionId ?? null,
      }),
      occurred_at: now,
      created_at: now,
    });
    sql.resolveDrift.run({
      id: episode.id,
      resolved_at: now,
      resolution,
      reconciliation_event_id: eventId,
    });
    pruneDeviceEvents(deviceId, now);
    return true;
  }

  function actionTerminalMutator(row) {
    if (row.status !== 'completed') return;
    const now = row.completed_at;
    const context = parseJson(row.context_json, {});
    if (row.type === 'load_schedule' || row.type === 'reload_expected_schedule') {
      establishExpectation({ deviceId: row.device_id, context, actionId: row.id, now });
      reconcileDrift(row.device_id, 'loaded_expected_schedule', row.id, now);
    }
    if (row.type === 'update_outlet_config' || row.type === 'repair_outlet_label') {
      const confirmation = parseJson(row.confirmation_json, {});
      if (
        confirmation.kind === 'outlet_config' &&
        labelConflicts(confirmation.outlets).length === 0
      ) {
        sql.upsertSetupReview.run({
          device_id: row.device_id,
          outlet_fingerprint: outletFingerprint(confirmation.outlets),
          reviewed_at: now,
          action_id: row.id,
        });
      }
    }
  }

  function currentSchedulePrecondition(deviceId, input, { requireOutlets = false } = {}) {
    const scheduleState = mirror(deviceId, 'schedule_state');
    if (!scheduleState.row || scheduleState.row.compatible !== 1) {
      throw new ActionBlockedCondition('retained_state_syncing', {
        changed_precondition: 'schedule_state',
      });
    }
    const currentScheduleFingerprint = scheduleFingerprint(scheduleState.value?.schedule);
    if (input.schedule_fingerprint !== currentScheduleFingerprint) {
      throw new ActionBlockedCondition('device_state_changed', {
        changed_precondition: 'schedule_state',
      });
    }
    let outlets = null;
    if (requireOutlets) {
      const outletState = mirror(deviceId, 'outlet_state');
      if (!outletState.row || outletState.row.compatible !== 1) {
        throw new ActionBlockedCondition('retained_state_syncing', {
          changed_precondition: 'outlet_state',
        });
      }
      outlets = outletState.value.outlets;
      if (input.outlet_fingerprint !== outletFingerprint(outlets)) {
        throw new ActionBlockedCondition('device_state_changed', {
          changed_precondition: 'outlet_state',
        });
      }
    }
    const episode = sql.getActiveDrift.get(deviceId);
    if (!episode || episode.id !== input.drift_episode_id) {
      throw new ActionBlockedCondition('device_state_changed', {
        changed_precondition: 'drift_episode',
      });
    }
    return { scheduleState: scheduleState.value, outlets, episode };
  }

  function registerActionHandlers() {
    actionEngine.registerHandler('load_schedule', {
      validate(input) {
        if (
          !exactKeys(input, ['template_id', 'mappings', 'acknowledged_warning_signature']) ||
          !Number.isInteger(input.template_id) ||
          (input.acknowledged_warning_signature !== undefined &&
            !validFingerprint(input.acknowledged_warning_signature))
        ) {
          throw new DeviceActionError(
            400,
            'invalid_action_input',
            'Schedule load input is invalid.',
          );
        }
        return {
          template_id: input.template_id,
          mappings: normalizeMappingInput(input.mappings),
          acknowledged_warning_signature: input.acknowledged_warning_signature ?? null,
        };
      },
      prepare: prepareLoad,
    });

    actionEngine.registerHandler('reload_expected_schedule', {
      validate(input) {
        if (
          !exactKeys(input, ['acknowledged_warning_signature']) ||
          (input.acknowledged_warning_signature !== undefined &&
            !validFingerprint(input.acknowledged_warning_signature))
        ) {
          throw new DeviceActionError(
            400,
            'invalid_action_input',
            'Schedule reload input is invalid.',
          );
        }
        return { acknowledged_warning_signature: input.acknowledged_warning_signature ?? null };
      },
      prepare({ deviceId, input }) {
        const { expected, result } = reloadPreflight(deviceId);
        const blocker = firstBlocker(result);
        if (blocker) throw new ActionBlockedCondition(blocker.code, blocker);
        requireWarningsAcknowledged(result, input.acknowledged_warning_signature);
        return {
          context: {
            template_id: expected.template_id,
            template_name: expected.template_name,
            template_revision: expected.template_revision,
            template_revision_id: expected.template_revision_id,
            mappings: parseJson(expected.role_mapping_json, {}),
            compiled_schedule: parseJson(expected.expected_schedule_json),
            expected_fingerprint: expected.expected_fingerprint,
            warning_codes: result.warnings.map((warning) => warning.code),
          },
          confirmation: { kind: 'schedule', schedule: parseJson(expected.expected_schedule_json) },
          requiredStateKeys: ['outlet_state', 'schedule_state'],
          errorKeys: ['schedule_error'],
          topic: `growhub/${deviceId}/grow`,
          payload: expected.expected_schedule_json,
          noOp: sameSchedule(
            mirror(deviceId, 'schedule_state').value?.schedule,
            parseJson(expected.expected_schedule_json),
          ),
        };
      },
    });

    actionEngine.registerHandler('confirm_device_setup', {
      validate(input) {
        if (
          !exactKeys(input, ['outlet_fingerprint']) ||
          !validFingerprint(input.outlet_fingerprint)
        ) {
          throw new DeviceActionError(
            400,
            'invalid_action_input',
            'Device setup confirmation is invalid.',
          );
        }
        return input;
      },
      prepare({ deviceId, input }) {
        return {
          local: true,
          conflictWithPending: true,
          context: {},
          execute({ actionId, now }) {
            const outlets = mirror(deviceId, 'outlet_state').value?.outlets;
            if (!outlets || input.outlet_fingerprint !== outletFingerprint(outlets)) {
              throw new ActionBlockedCondition('device_state_changed', {
                changed_precondition: 'outlet_state',
              });
            }
            const conflicts = labelConflicts(outlets);
            if (conflicts.length > 0) {
              throw new ActionBlockedCondition('outlet_label_conflict', { conflicts });
            }
            sql.upsertSetupReview.run({
              device_id: deviceId,
              outlet_fingerprint: input.outlet_fingerprint,
              reviewed_at: now,
              action_id: actionId,
            });
            return { context: { outlet_fingerprint: input.outlet_fingerprint } };
          },
        };
      },
    });

    actionEngine.registerHandler('acknowledge_label_drift', {
      validate(input) {
        if (
          !exactKeys(input, ['template_id', 'role_id', 'outlet_id', 'outlet_fingerprint']) ||
          !Number.isInteger(input.template_id) ||
          typeof input.role_id !== 'string' ||
          !Number.isInteger(input.outlet_id) ||
          input.outlet_id < 1 ||
          input.outlet_id > 4 ||
          !validFingerprint(input.outlet_fingerprint)
        ) {
          throw new DeviceActionError(
            400,
            'invalid_action_input',
            'Label drift acknowledgement is invalid.',
          );
        }
        return input;
      },
      prepare({ deviceId, input }) {
        return {
          local: true,
          conflictWithPending: true,
          execute({ now }) {
            const outlets = mirror(deviceId, 'outlet_state').value?.outlets;
            if (!outlets || input.outlet_fingerprint !== outletFingerprint(outlets)) {
              throw new ActionBlockedCondition('device_state_changed', {
                changed_precondition: 'outlet_state',
              });
            }
            const outlet = outlets.find((entry) => entry.id === input.outlet_id);
            const result = sql.updateMappingLabel.run({
              template_id: input.template_id,
              role_id: input.role_id,
              device_id: deviceId,
              outlet_id: input.outlet_id,
              label: outlet?.label ?? '',
              updated_at: now,
            });
            if (!outlet || result.changes !== 1) {
              throw new ActionBlockedCondition('device_state_changed', {
                changed_precondition: 'role_mapping',
              });
            }
            return { context: { outlet_id: outlet.id, accepted_label: outlet.label } };
          },
        };
      },
    });

    actionEngine.registerHandler('acknowledge_drift', {
      validate(input) {
        if (
          !exactKeys(input, ['schedule_fingerprint', 'drift_episode_id']) ||
          !validFingerprint(input.schedule_fingerprint) ||
          typeof input.drift_episode_id !== 'string'
        ) {
          throw new DeviceActionError(
            400,
            'invalid_action_input',
            'Drift acknowledgement is invalid.',
          );
        }
        return input;
      },
      prepare({ deviceId, input }) {
        return {
          local: true,
          conflictWithPending: true,
          execute({ actionId, now }) {
            currentSchedulePrecondition(deviceId, input);
            sql.deleteExpected.run(deviceId);
            sql.deleteMappingsForDevice.run(deviceId);
            reconcileDrift(deviceId, 'acknowledged_drift', actionId, now);
            return { context: { drift_episode_id: input.drift_episode_id } };
          },
        };
      },
    });

    actionEngine.registerHandler('save_as_new_template', {
      validate(input) {
        if (
          !exactKeys(input, [
            'name',
            'description',
            'schedule_fingerprint',
            'outlet_fingerprint',
            'drift_episode_id',
          ]) ||
          typeof input.name !== 'string' ||
          input.name.trim() !== input.name ||
          input.name.length < 1 ||
          input.name.length > 80 ||
          (input.description !== undefined && typeof input.description !== 'string') ||
          !validFingerprint(input.schedule_fingerprint) ||
          !validFingerprint(input.outlet_fingerprint) ||
          typeof input.drift_episode_id !== 'string'
        ) {
          throw new DeviceActionError(
            400,
            'invalid_action_input',
            'Template adoption input is invalid.',
          );
        }
        return { ...input, description: input.description ?? '' };
      },
      prepare({ deviceId, input }) {
        return {
          local: true,
          conflictWithPending: true,
          execute({ actionId, now }) {
            const current = currentSchedulePrecondition(deviceId, input, { requireOutlets: true });
            const schedule = canonicalSchedule(current.scheduleState.schedule);
            if (!schedule || schedule.outlets.length === 0) {
              throw new ActionBlockedCondition('not_adoptable');
            }
            const roles = schedule.outlets.map((entry) => {
              const outlet = current.outlets.find((candidate) => candidate.id === entry.id);
              return outlet?.assignment !== 'None'
                ? {
                    id: uuid(),
                    assignment: outlet.assignment,
                    label: outlet.label,
                    conditions: entry.conditions,
                  }
                : null;
            });
            if (roles.some((role) => role === null)) {
              throw new ActionBlockedCondition('unsupported_firmware_schedule');
            }
            let normalized;
            try {
              normalized = normalizeTemplateInput(
                {
                  name: input.name,
                  description: input.description,
                  roles,
                },
                { uuid },
              );
            } catch (_) {
              throw new ActionBlockedCondition('unsupported_firmware_schedule');
            }
            const info = sql.insertTemplate.run({
              name: normalized.name,
              description: normalized.description,
              editor_state_json: JSON.stringify({ roles: normalized.roles }),
              now,
            });
            const templateId = Number(info.lastInsertRowid);
            syncNormalizedRoles(templateId, normalized.roles, now);
            const revisionId = persistRevision(
              {
                ...normalized,
                id: templateId,
                revision: 1,
              },
              now,
            );
            const mappings = Object.fromEntries(
              normalized.roles.map((role, index) => [role.id, schedule.outlets[index].id]),
            );
            establishExpectation({
              deviceId,
              actionId,
              now,
              context: {
                template_id: templateId,
                template_name: normalized.name,
                template_revision: 1,
                template_revision_id: revisionId,
                mappings,
                compiled_schedule: schedule,
              },
            });
            reconcileDrift(deviceId, 'adopted_firmware_schedule', actionId, now);
            return { context: { template_id: templateId, template_name: normalized.name } };
          },
        };
      },
    });
  }

  function detectDrift(deviceId, scheduleState, now) {
    const expected = sql.getExpected.get(deviceId);
    if (!expected) return;
    const expectedSchedule = parseJson(expected.expected_schedule_json);
    const actualSchedule = scheduleState?.schedule ?? null;
    const active = sql.getActiveDrift.get(deviceId);
    if (sameSchedule(expectedSchedule, actualSchedule)) {
      if (active) reconcileDrift(deviceId, 'firmware_returned_to_expected', null, now);
      return;
    }
    if (active) return;

    let reason = actualSchedule ? 'schedule_body_changed' : 'firmware_schedule_cleared';
    const mappings = parseJson(expected.role_mapping_json, {});
    const outlets = mirror(deviceId, 'outlet_state').value?.outlets ?? [];
    const template = expected.template_id
      ? formatTemplate(sql.getTemplate.get(expected.template_id))
      : null;
    if (
      template?.roles.some((role) => {
        const outlet = outlets.find((entry) => entry.id === mappings[role.id]);
        return !outlet || outlet.assignment !== role.assignment;
      })
    )
      reason = 'outlet_assignment_changed';
    if (!DRIFT_REASONS.has(reason)) reason = 'unknown_firmware_change';
    const eventId = uuid();
    const episodeId = uuid();
    const context = {
      expected_template_id: expected.template_id,
      expected_template_name: expected.template_name,
      expected_template_revision: expected.template_revision,
      reason,
    };
    const transaction = db.transaction(() => {
      sql.insertEvent.run({
        id: eventId,
        device_id: deviceId,
        type: 'schedule_drift_detected',
        context_json: JSON.stringify(context),
        occurred_at: now,
        created_at: now,
      });
      sql.insertDrift.run({
        id: episodeId,
        device_id: deviceId,
        detection_event_id: eventId,
        expected_fingerprint:
          expected.expected_fingerprint ?? scheduleFingerprint(expectedSchedule),
        reason,
        started_at: now,
      });
    });
    transaction();
    pruneDeviceEvents(deviceId, now);
    logger.info('schedule_drift_detected', {
      device_id: deviceId,
      reason,
      drift_episode_id: episodeId,
    });
  }

  function observeState({ deviceId, stateKey, value }) {
    const now = clock();
    if (stateKey === 'outlet_state') {
      const outlets = value?.outlets ?? [];
      for (const mapping of sql.getDeviceMappings.all(deviceId)) {
        const outlet = outlets.find((entry) => entry.id === mapping.outlet_id);
        if (!outlet || outlet.assignment !== mapping.assignment_snapshot) {
          sql.deleteMapping.run(mapping.role_id, deviceId);
        }
      }
    }
    if (stateKey === 'schedule_state') detectDrift(deviceId, value, now);
  }

  function driftDetails(deviceId) {
    const episode = sql.getActiveDrift.get(deviceId);
    if (!episode)
      throw new DeviceActionError(404, 'drift_not_found', 'The device is not currently drifted.');
    const expected = sql.getExpected.get(deviceId);
    const scheduleState = mirror(deviceId, 'schedule_state');
    if (!scheduleState.row || scheduleState.row.compatible !== 1) {
      throw new DeviceActionError(
        409,
        'retained_state_syncing',
        'Current schedule state is still syncing.',
      );
    }
    if (!expected)
      throw new DeviceActionError(
        409,
        'missing_expected_schedule',
        'Expected schedule is unavailable.',
      );
    const outlets = mirror(deviceId, 'outlet_state').value?.outlets ?? [];
    return {
      outlet_fingerprint: outletFingerprint(outlets),
      episode: {
        id: episode.id,
        reason: episode.reason,
        started_at: asIso(episode.started_at),
      },
      expected: {
        template_id: expected.template_id,
        template_name: expected.template_name,
        template_revision: expected.template_revision,
        fingerprint: expected.expected_fingerprint,
      },
      firmware: {
        source: scheduleState.value.source,
        fingerprint: scheduleFingerprint(scheduleState.value.schedule),
        received_at: asIso(scheduleState.row.received_at),
      },
      diff: scheduleDiff(
        parseJson(expected.expected_schedule_json),
        scheduleState.value.schedule,
        outlets,
      ),
    };
  }

  function driftAvailability(deviceId) {
    const drift = sql.getActiveDrift.get(deviceId);
    const hidden = () => ({ visible: false, enabled: false, disabled_reason: 'not_drifted' });
    if (!drift) {
      return {
        view_drift_details: hidden(),
        reload_expected_schedule: hidden(),
        save_as_new_template: hidden(),
        acknowledge_drift: hidden(),
      };
    }
    const schedule = mirror(deviceId, 'schedule_state');
    const outlets = mirror(deviceId, 'outlet_state');
    const expected = sql.getExpected.get(deviceId);
    const pending = actionEngine.pending(deviceId);
    const brokerUnavailable =
      !mqttService?.isConnected?.() || mqttService.getHealth?.().broker.subscriptionsReady !== true;
    const device = stmts.getDevice.get(deviceId);
    const scheduleReady = schedule.row?.compatible === 1;
    const outletsReady = outlets.row?.compatible === 1;
    const adoptable = Boolean(canonicalSchedule(schedule.value?.schedule)?.outlets.length);
    const state = (enabled, disabledReason = null, context = undefined) => ({
      visible: true,
      enabled,
      disabled_reason: enabled ? null : disabledReason,
      ...(context ? { context } : {}),
    });
    const localReason =
      pending.length > 0
        ? 'pending_action_conflict'
        : !scheduleReady
          ? 'retained_state_syncing'
          : null;
    let reloadReason = brokerUnavailable ? 'broker_unavailable' : null;
    if (!reloadReason && pending.length > 0) reloadReason = 'pending_action_conflict';
    if (!reloadReason && (!scheduleReady || !outletsReady)) reloadReason = 'retained_state_syncing';
    if (!reloadReason && device?.presence_status !== 'online') reloadReason = 'device_offline';
    if (!reloadReason && !expected) reloadReason = 'missing_expected_schedule';
    return {
      view_drift_details: state(
        scheduleReady && Boolean(expected),
        !scheduleReady ? 'retained_state_syncing' : 'missing_expected_schedule',
      ),
      reload_expected_schedule: state(!reloadReason, reloadReason),
      save_as_new_template: state(!localReason && adoptable, localReason ?? 'not_adoptable'),
      acknowledge_drift: state(!localReason, localReason),
    };
  }

  function deviceScheduleState(deviceId) {
    const setup = setupState(deviceId);
    const expected = sql.getExpected.get(deviceId);
    const drift = sql.getActiveDrift.get(deviceId);
    const template = expected?.template_id ? sql.getTemplate.get(expected.template_id) : null;
    const mappings = expected ? parseJson(expected.role_mapping_json, {}) : {};
    const outlets = mirror(deviceId, 'outlet_state').value?.outlets ?? [];
    const labelDrift = expected?.template_id
      ? sql.getMappings
          .all(expected.template_id, deviceId)
          .map((mapping) => {
            const outlet = outlets.find((entry) => entry.id === mapping.outlet_id);
            return outlet &&
              outlet.assignment === mapping.assignment_snapshot &&
              outlet.label !== mapping.expected_label_snapshot
              ? {
                  template_id: mapping.template_id,
                  role_id: mapping.role_id,
                  outlet_id: mapping.outlet_id,
                  expected_label: mapping.expected_label_snapshot,
                  firmware_label: outlet.label,
                }
              : null;
          })
          .filter(Boolean)
      : [];
    return {
      setup,
      expected_schedule: expected
        ? {
            template_id: expected.template_id,
            template_name: expected.template_name,
            loaded_revision: expected.template_revision,
            latest_revision: template?.revision ?? null,
            update_available: Boolean(template && template.revision > expected.template_revision),
            established_at: asIso(expected.established_at),
            role_mappings: mappings,
          }
        : null,
      drift: drift
        ? {
            id: drift.id,
            reason: drift.reason,
            started_at: asIso(drift.started_at),
            expected_fingerprint: drift.expected_fingerprint,
          }
        : null,
      drift_actions: driftAvailability(deviceId),
      label_drift: labelDrift,
    };
  }

  function decodeActivityCursor(cursor) {
    if (!cursor) return null;
    try {
      const value = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
      if (!Array.isArray(value) || !Number.isInteger(value[0]) || typeof value[1] !== 'string')
        throw new Error();
      return { occurred_at: value[0], sort_id: value[1] };
    } catch (_) {
      throw new DeviceActionError(400, 'invalid_cursor', 'The activity cursor is invalid.');
    }
  }

  function activity(deviceId, { limit = 25, cursor } = {}) {
    const parsedLimit = Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new DeviceActionError(400, 'invalid_limit', 'limit must be an integer from 1 to 100.');
    }
    const decoded = decodeActivityCursor(cursor);
    const rows = decoded
      ? sql.listActivityAfter.all({
          device_id: deviceId,
          occurred_at: decoded.occurred_at,
          sort_id: decoded.sort_id,
          limit: parsedLimit + 1,
        })
      : sql.listActivityFirst.all({ device_id: deviceId, limit: parsedLimit + 1 });
    const page = rows.slice(0, parsedLimit);
    return {
      activity: page.map((row) => {
        if (row.kind === 'action') {
          return {
            kind: 'action',
            occurred_at: asIso(row.occurred_at),
            action: actionEngine.formatAction(sql.getActionById.get(row.payload_id)),
          };
        }
        const event = sql.getEventById.get(row.payload_id);
        return {
          kind: 'device_event',
          occurred_at: asIso(row.occurred_at),
          device_event: {
            id: event.id,
            type: event.type,
            context: parseJson(event.context_json, {}),
            occurred_at: asIso(event.occurred_at),
          },
        };
      }),
      next_cursor:
        rows.length > parsedLimit
          ? Buffer.from(JSON.stringify([page.at(-1).occurred_at, page.at(-1).sort_id])).toString(
              'base64url',
            )
          : null,
    };
  }

  registerActionHandlers();
  const removeTerminalMutator = actionEngine.addTerminalMutator(actionTerminalMutator);
  for (const { id } of stmts.getKnownDeviceIds.all()) pruneDeviceEvents(id);

  return {
    activity,
    createTemplate,
    deleteTemplate,
    deviceScheduleState,
    driftDetails,
    getTemplate,
    listRevisions,
    listTemplates,
    observeState,
    preflight,
    scheduleDiff,
    scheduleFingerprint,
    updateTemplate,
    close() {
      removeTerminalMutator();
    },
  };
}

module.exports = {
  ASSIGNMENTS,
  canonicalSchedule,
  createScheduleTemplateService,
  labelConflicts,
  normalizeCondition,
  normalizeTemplateInput,
  scheduleDiff,
  scheduleFingerprint,
};
