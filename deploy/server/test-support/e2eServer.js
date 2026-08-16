'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/db');
const { createDeviceActionEngine } = require('../src/deviceActions');
const { createApp } = require('../src/index');
const { createLogger } = require('../src/logger');
const { loadConfig } = require('../src/config');
const { createRuntimeState } = require('../src/runtimeState');
const { createScheduleTemplateService } = require('../src/scheduleTemplates');
const { MAC, outletsPayload, schedulePayload } = require('./firmwareFixtures');

const PORT = Number(process.env.E2E_PORT || 4174);
const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'growhub-e2e-'));
const config = loadConfig({
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: String(PORT),
  APP_DATA_DIR: appDataDir,
  DB_PATH: path.join(appDataDir, 'growhub.db'),
  DIST_DIR: path.resolve(__dirname, '../../../dist'),
});
const database = openDatabase(config.dbPath);
const runtimeState = createRuntimeState();
const logger = createLogger({ level: 'error', write() {}, writeError() {} });
const state = {
  presence_state: { status: 'online' },
  outlet_state: outletsPayload(),
  schedule_state: schedulePayload(),
  sensor_state: {
    reported_name: 'Bench Growhub',
    firmware_version: '1.1.0C',
    observed_at: Date.now(),
    temperature_c: 24.2,
    humidity_rh: 55,
    light_level: 72,
    actuator_summary: '00000000',
  },
};
let actionEngine;
let scheduleService;

database.stmts.ensureDevice.run({ id: MAC, observed_at: Date.now() });
database.stmts.upsertDevice.run({
  id: MAC,
  name: 'Bench Growhub',
  ip: '192.0.2.10',
  fw: '1.1.0C',
  last_seen: Date.now(),
});

function rawFor(key, value) {
  if (key === 'presence_state') return value.status;
  return JSON.stringify(value);
}

function persistState(key, value, { retained = true, notify = true } = {}) {
  state[key] = value;
  const result = database.stmts.upsertDeviceStateMirror.get({
    device_id: MAC,
    state_key: key,
    schema_version: key === 'outlet_state' ? 1 : key === 'schedule_state' ? 3 : null,
    normalized_json: JSON.stringify(value),
    raw_json: rawFor(key, value),
    received_at: Date.now(),
    mqtt_retained: retained ? 1 : 0,
    compatible: 1,
    compatibility_reason: null,
  });
  if (key === 'presence_state') {
    database.stmts.setMirroredDevicePresence.run({
      device_id: MAC,
      presence_status: value.status,
      presence_received_at: Date.now(),
      updated_at: Date.now(),
    });
  }
  if (key === 'outlet_state') {
    database.stmts.setMirroredDeviceOutlets.run({
      device_id: MAC,
      outlet_state_json: JSON.stringify(value.outlets),
      updated_at: Date.now(),
    });
  }
  if (key === 'schedule_state') {
    database.stmts.setMirroredDeviceMode.run({
      device_id: MAC,
      current_mode: value.mode,
      updated_at: Date.now(),
    });
  }
  if (notify) {
    actionEngine?.observeState({ deviceId: MAC, stateKey: key, revision: result.revision, value });
    scheduleService?.observeState({ deviceId: MAC, stateKey: key, value });
  }
  return result.revision;
}

for (const [key, value] of Object.entries(state)) {
  persistState(key, value, { retained: key !== 'sensor_state', notify: false });
}
database.stmts.insertMeasurement.run({
  device_id: MAC,
  taken_at: Date.now(),
  temp: 24.2,
  humidity: 55,
  light: 72,
  co2: null,
  actuator: '00000000',
  fw: '1.1.0C',
});
const e2eHistoryPoints = Number.parseInt(process.env.E2E_HISTORY_POINTS || '1', 10);
if (Number.isInteger(e2eHistoryPoints) && e2eHistoryPoints > 1) {
  const insertHistory = database.db.transaction(() => {
    for (let index = 1; index < e2eHistoryPoints; index += 1) {
      database.stmts.insertMeasurement.run({
        device_id: MAC,
        taken_at: Date.now() - index * 6_000,
        temp: 22 + (index % 60) / 10,
        humidity: 50 + (index % 100) / 10,
        light: index % 100,
        co2: null,
        actuator: '00000000',
        fw: '1.1.0C',
      });
    }
  });
  insertHistory();
}

function outletStatesFromMask(mask) {
  const bitByOutlet = { 1: 3, 2: 0, 3: 1, 4: 2 };
  return [1, 2, 3, 4].map((id) => ({
    id,
    state: (mask & (1 << bitByOutlet[id])) !== 0 ? 'on' : 'off',
    summary: '',
  }));
}

function simulateFirmware(topic, rawPayload) {
  if (topic.endsWith('/outlets/config')) {
    const payload = JSON.parse(rawPayload);
    persistState('outlet_state', { v: 1, source: 'mqtt', outlets: payload.outlets });
    return;
  }
  if (topic.endsWith('/grow')) {
    persistState('schedule_state', {
      ...state.schedule_state,
      source: 'mqtt',
      active: true,
      schedule: JSON.parse(rawPayload),
    });
    return;
  }
  if (topic.endsWith('/time/action')) {
    persistState('schedule_state', {
      ...state.schedule_state,
      source: 'time',
      time_valid: true,
      time_warning: '',
      warnings: (state.schedule_state.warnings ?? []).filter(
        (warning) => warning.code !== 'time_sync_required',
      ),
    });
    return;
  }
  if (topic.endsWith('/control/mode')) {
    const command = Number(rawPayload);
    const manual = command === 2 || command === 7;
    persistState('schedule_state', {
      ...state.schedule_state,
      source: 'mqtt',
      mode: manual ? 'manual' : 'auto',
      outlet_status: command === 7 ? outletStatesFromMask(0) : state.schedule_state.outlet_status,
    });
    return;
  }
  if (topic.endsWith('/control/relay')) {
    persistState('schedule_state', {
      ...state.schedule_state,
      source: 'mqtt',
      mode: 'manual',
      outlet_status: outletStatesFromMask(Number(rawPayload)),
    });
    return;
  }
  if (topic.endsWith('/schedule/action')) {
    const payload = JSON.parse(rawPayload);
    persistState('schedule_state', {
      ...state.schedule_state,
      source: 'mqtt',
      outlet_status: state.schedule_state.outlet_status.map((outlet) =>
        outlet.id === payload.outlet ? { ...outlet, state: 'on' } : outlet,
      ),
    });
  }
}

const mqttService = {
  addObserver() {
    return () => {};
  },
  isConnected: () => true,
  publishAction(topic, payload, callback) {
    callback(null);
    setTimeout(() => simulateFirmware(topic, payload), 20);
  },
  getDeviceSyncState() {
    return {
      status: 'ready',
      generation: 1,
      missingStates: [],
      escalatedStates: [],
      startedAt: Date.now(),
      graceExpiresAt: null,
    };
  },
  getHealth() {
    return {
      broker: {
        status: 'connected',
        subscriptionsReady: true,
        lastConnectedAt: Date.now(),
        lastDisconnectedAt: null,
        lastError: null,
      },
      retainedStateRebuild: {
        generation: 1,
        startedAt: Date.now(),
        deviceCount: 1,
        syncingDeviceCount: 0,
        missingStateCount: 0,
      },
    };
  },
};

actionEngine = createDeviceActionEngine({ database, mqttService, logger });
scheduleService = createScheduleTemplateService({
  database,
  mqttService,
  actionEngine,
  logger,
});
const e2eReleaseAvailable = process.env.E2E_UPDATE_AVAILABLE === '1';
let e2eUpdateStatus = {
  current_version: '0.1.0',
  latest_release: e2eReleaseAvailable
    ? {
        tag: 'v0.2.0',
        version: '0.2.0',
        name: 'Command Center v0.2.0',
        url: 'https://github.com/Shrug-Lord/growhub-command-center/releases/tag/v0.2.0',
        published_at: '2026-08-06T12:00:00.000Z',
      }
    : null,
  update_available: e2eReleaseAvailable,
  prompt_available: e2eReleaseAvailable,
  dismissed: false,
  auto_install: false,
  checked_at: '2026-08-06T12:00:00.000Z',
  check_error: null,
  agent: { installed: true, installed_at: '2026-08-06T12:00:00.000Z' },
  install: null,
};
const updateService = {
  async check() {
    return e2eUpdateStatus;
  },
  dismiss() {
    e2eUpdateStatus = { ...e2eUpdateStatus, dismissed: true, prompt_available: false };
    return e2eUpdateStatus;
  },
  async setAutoInstall(enabled) {
    e2eUpdateStatus = { ...e2eUpdateStatus, auto_install: enabled, prompt_available: false };
    return e2eUpdateStatus;
  },
  requestInstall(tag) {
    e2eUpdateStatus = {
      ...e2eUpdateStatus,
      prompt_available: false,
      install: { state: 'requested', tag, requested_at: new Date().toISOString() },
    };
    return e2eUpdateStatus;
  },
};
runtimeState.markReady();
const app = createApp({
  config,
  runtimeState,
  database,
  mqttService,
  actionEngine,
  scheduleService,
  updateService,
  logger,
});
const server = app.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`Growhub E2E server ready on ${PORT}\n`);
});

function stop() {
  server.close(() => {
    scheduleService.close();
    actionEngine.close();
    database.close();
    fs.rmSync(appDataDir, { recursive: true, force: true });
    process.exit(0);
  });
}

process.once('SIGTERM', stop);
process.once('SIGINT', stop);
