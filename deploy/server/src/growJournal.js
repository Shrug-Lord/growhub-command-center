'use strict';

const { DeviceActionError } = require('./deviceActions');

const MANUAL_TYPES = new Set([
  'phase_change',
  'observation',
  'nutrient_add',
  'ph_adjustment',
  'training',
]);
const SYSTEM_TYPES = new Set([
  'schedule_loaded',
  'schedule_removed',
  'device_online',
  'device_offline',
]);

function fail(message, code = 'invalid_journal_entry', status = 400) {
  throw new DeviceActionError(status, code, message);
}

function text(value, name, maximum, optional = false) {
  if (optional && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    fail(name + ' must contain 1–' + maximum + ' characters.');
  }
  return value.trim();
}

function id(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) fail('Choose a valid grow or entry.');
  return result;
}

function timestamp(value, now) {
  if (!Number.isSafeInteger(value) || value < 0 || value > now) {
    fail('Use an actual date and time, no later than now.');
  }
  return value;
}

function createGrowJournal({ database, clock = () => Date.now() }) {
  const { db, stmts } = database;
  const getGrow = db.prepare('SELECT * FROM grows WHERE id = ?');
  const activeGrow = db.prepare('SELECT * FROM grows WHERE device_id = ? AND ended_at IS NULL');
  const getEntry = db.prepare('SELECT * FROM grow_events WHERE id = ?');
  const entriesForGrow = db.prepare(
    'SELECT * FROM grow_events WHERE grow_id = ? ORDER BY occurred_at, id',
  );
  const listGrows = db.prepare(
    'SELECT * FROM grows WHERE device_id = ? ORDER BY started_at DESC, id DESC',
  );
  const unassigned = db.prepare(
    "SELECT * FROM grow_events WHERE device_id = ? AND grow_id IS NULL AND type NOT IN ('schedule_loaded','schedule_removed','device_online','device_offline') ORDER BY occurred_at DESC, id DESC",
  );
  const insertGrow = db.prepare(
    'INSERT INTO grows(device_id, name, started_at, created_at) VALUES (?, ?, ?, ?)',
  );
  const insertEntry = db.prepare(
    'INSERT INTO grow_events(device_id, grow_id, type, phase, label, notes, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const updateEntry = db.prepare(
    'UPDATE grow_events SET phase = ?, label = ?, notes = ?, occurred_at = ? WHERE id = ?',
  );
  const getPrompt = db.prepare(
    "SELECT * FROM grow_prompts WHERE action_id = ? AND device_id = ? AND status = 'pending'",
  );
  const resolvePrompt = db.prepare(
    "UPDATE grow_prompts SET status = ? WHERE action_id = ? AND status = 'pending'",
  );

  function requireDevice(deviceId) {
    if (!stmts.getDevice.get(deviceId)) fail('Device not found.', 'device_not_found', 404);
  }
  function requireGrow(growId, deviceId) {
    const grow = getGrow.get(id(growId));
    if (!grow || (deviceId && grow.device_id !== deviceId))
      fail('Grow not found for this device.', 'grow_not_found', 404);
    return grow;
  }
  function requireEntry(entryId) {
    const entry = getEntry.get(id(entryId));
    if (!entry) fail('Journal entry not found.', 'event_not_found', 404);
    if (SYSTEM_TYPES.has(entry.type))
      fail('Operational entries cannot be edited or deleted.', 'event_protected', 403);
    return entry;
  }
  function checkBounds(grow, occurredAt) {
    if (occurredAt < grow.started_at || (grow.ended_at !== null && occurredAt > grow.ended_at)) {
      fail(
        'The entry must fall within the grow’s start and end dates. Choose a matching grow or correct the entry date.',
      );
    }
  }
  function promptFor(deviceId, actionId) {
    if (!actionId) return null;
    const prompt = getPrompt.get(actionId, deviceId);
    if (!prompt)
      fail(
        'This schedule follow-up was already handled or superseded.',
        'grow_prompt_resolved',
        409,
      );
    return prompt;
  }
  function formatEntry(entry) {
    return { ...entry, schedule_id: entry.template_id ?? null };
  }
  function detail(growId, deviceId) {
    const grow = requireGrow(growId, deviceId);
    const entries = entriesForGrow.all(grow.id);
    const phases = entries.filter((entry) => entry.type === 'phase_change');
    const until = grow.ended_at ?? clock();
    return {
      ...grow,
      entries: entries.map(formatEntry),
      phases: phases.map((entry, index) => ({
        id: entry.id,
        phase: entry.phase,
        started_at: entry.occurred_at,
        ended_at: phases[index + 1]?.occurred_at ?? grow.ended_at,
        duration_ms: Math.max(0, (phases[index + 1]?.occurred_at ?? until) - entry.occurred_at),
      })),
      duration_ms: Math.max(0, until - grow.started_at),
    };
  }
  function prompts(deviceId) {
    return db
      .prepare(
        "SELECT * FROM grow_prompts WHERE device_id = ? AND status = 'pending' ORDER BY confirmed_at DESC, action_id DESC",
      )
      .all(deviceId);
  }
  function overview(deviceId) {
    requireDevice(deviceId);
    return {
      grows: listGrows.all(deviceId),
      unassigned: unassigned.all(deviceId).map(formatEntry),
      prompts: prompts(deviceId),
    };
  }
  const start = db.transaction((deviceId, input) => {
    requireDevice(deviceId);
    if (activeGrow.get(deviceId))
      fail('End the current grow before starting another.', 'grow_already_active', 409);
    const now = clock();
    const name = text(input.name, 'Grow name', 120);
    const phase = text(input.phase, 'Phase', 60);
    const startedAt = timestamp(input.started_at ?? now, now);
    const prompt = promptFor(deviceId, input.action_id);
    const growId = Number(insertGrow.run(deviceId, name, startedAt, now).lastInsertRowid);
    insertEntry.run(
      deviceId,
      growId,
      'phase_change',
      phase,
      'Entered ' + phase,
      null,
      startedAt,
      now,
    );
    if (prompt) resolvePrompt.run('logged', prompt.action_id);
    return detail(growId);
  });
  const end = db.transaction((growId, input) => {
    const grow = requireGrow(growId);
    if (grow.ended_at !== null) fail('This grow has already ended.', 'grow_already_ended', 409);
    const endedAt = timestamp(input.ended_at ?? clock(), clock());
    if (
      endedAt < grow.started_at ||
      entriesForGrow.all(grow.id).some((entry) => entry.occurred_at > endedAt)
    ) {
      fail('The end must be on or after the grow’s start and all its entries.');
    }
    db.prepare('UPDATE grows SET ended_at = ? WHERE id = ?').run(endedAt, grow.id);
    db.prepare(
      "UPDATE grow_prompts SET status = 'dismissed' WHERE device_id = ? AND status = 'pending'",
    ).run(grow.device_id);
    return detail(grow.id);
  });
  const createEntry = db.transaction((input) => {
    requireDevice(input.deviceId);
    if (!MANUAL_TYPES.has(input.type)) fail('Choose a supported journal entry type.');
    const grow = input.growId ? requireGrow(input.growId, input.deviceId) : null;
    const now = clock();
    const occurredAt = timestamp(input.occurredAt ?? now, now);
    if (grow) checkBounds(grow, occurredAt);
    const phase = input.type === 'phase_change' ? text(input.phase, 'Phase', 60) : null;
    const label = text(input.label, 'Label', 200);
    const notes = text(input.notes, 'Notes', 10_000, true);
    const prompt = promptFor(input.deviceId, input.actionId);
    if (prompt && (!grow || grow.ended_at !== null || input.type !== 'phase_change'))
      fail('Log a phase change in the active grow for this schedule.');
    const entryId = Number(
      insertEntry.run(
        input.deviceId,
        grow?.id ?? null,
        input.type,
        phase,
        label,
        notes,
        occurredAt,
        now,
      ).lastInsertRowid,
    );
    if (prompt) resolvePrompt.run('logged', prompt.action_id);
    return formatEntry(getEntry.get(entryId));
  });
  const editEntry = db.transaction((entryId, input) => {
    const entry = requireEntry(entryId);
    const occurredAt = timestamp(input.occurredAt ?? entry.occurred_at, clock());
    if (entry.grow_id) checkBounds(requireGrow(entry.grow_id), occurredAt);
    const phase =
      entry.type === 'phase_change' ? text(input.phase ?? entry.phase, 'Phase', 60) : null;
    const label = text(input.label ?? entry.label, 'Label', 200);
    const notes = text(
      input.notes === undefined ? entry.notes : input.notes,
      'Notes',
      10_000,
      true,
    );
    updateEntry.run(phase, label, notes, occurredAt, entry.id);
    return formatEntry(getEntry.get(entry.id));
  });
  const assign = db.transaction((growId, input) => {
    const grow = requireGrow(growId);
    if (!Array.isArray(input.entry_ids) || !input.entry_ids.length || input.entry_ids.length > 500)
      fail('Select 1–500 unassigned entries.');
    const entries = [...new Set(input.entry_ids.map(id))].map(requireEntry);
    for (const entry of entries) {
      if (entry.device_id !== grow.device_id || entry.grow_id !== null)
        fail('Select unassigned entries from this device only.');
      checkBounds(grow, entry.occurred_at);
    }
    const update = db.prepare('UPDATE grow_events SET grow_id = ? WHERE id = ?');
    for (const entry of entries) update.run(grow.id, entry.id);
    return detail(grow.id);
  });
  function deleteEntry(entryId) {
    const entry = requireEntry(entryId);
    db.prepare('DELETE FROM grow_events WHERE id = ?').run(entry.id);
    return { id: entry.id, deleted: true };
  }
  function dismiss(deviceId, actionId) {
    requireDevice(deviceId);
    const prompt = promptFor(deviceId, actionId);
    if (prompt) resolvePrompt.run('dismissed', actionId);
    return { action_id: actionId, status: 'dismissed' };
  }
  return {
    active: (deviceId) => activeGrow.get(deviceId) ?? null,
    overview,
    prompts,
    detail,
    start,
    end,
    createEntry,
    editEntry,
    deleteEntry,
    assign,
    dismiss,
  };
}

module.exports = { createGrowJournal, MANUAL_TYPES };
