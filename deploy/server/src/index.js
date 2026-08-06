'use strict';

const express = require('express');
const path = require('node:path');
const { acquireAppDataLock } = require('./appDataLock');
const { createAuthSystem, SWEEP_INTERVAL_MS } = require('./auth');
const { ConfigurationError, loadConfig } = require('./config');
const { openDatabase } = require('./db');
const { createDeviceActionEngine, DeviceActionError } = require('./deviceActions');
const { createDiagnosticsService } = require('./diagnostics');
const { formatDevice, formatServerHealth } = require('./deviceView');
const { errorHandler, requestContext, sendError } = require('./http');
const { createLogger } = require('./logger');
const { createMqttService } = require('./mqtt');
const { createRuntimeState } = require('./runtimeState');
const { createScheduleTemplateService } = require('./scheduleTemplates');
const { createReleaseUpdateService, ReleaseUpdateError } = require('./releaseUpdates');

// ── Math helpers ──────────────────────────────────────────────────────────────

function satVP(t) {
  return 0.6108 * Math.exp((17.27 * t) / (t + 237.3));
}
function calcVPD(t, rh) {
  return parseFloat((satVP(t) * (1 - rh / 100)).toFixed(3));
}
function calcDewPoint(t, rh) {
  const g = Math.log(rh / 100) + (17.27 * t) / (237.3 + t);
  return parseFloat(((237.3 * g) / (17.27 - g)).toFixed(2));
}

// ── Express setup ─────────────────────────────────────────────────────────────

function createApp({
  config,
  runtimeState,
  database,
  mqttService,
  actionEngine,
  scheduleService,
  updateService,
  diagnosticsService: suppliedDiagnosticsService,
  logger,
  uuid,
  clock = () => Date.now(),
  authSystem: suppliedAuthSystem,
}) {
  const { db, stmts } = database;
  const authSystem = suppliedAuthSystem || createAuthSystem({ database, config, clock });
  const diagnosticsService =
    suppliedDiagnosticsService ||
    createDiagnosticsService({
      database,
      mqttService,
      actionEngine,
      runtimeState,
      config,
      authSystem,
      logger,
      clock,
    });

  const app = express();
  app.locals.authSystem = authSystem;
  app.disable('x-powered-by');
  app.use(requestContext({ logger, uuid, clock }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; form-action 'self'",
    );
    next();
  });
  app.use('/health', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/health/live', (_req, res) =>
    res.json({
      status: 'ok',
      setup_required: authSystem.setupRequired(),
    }),
  );
  app.get('/health/ready', (_req, res) => {
    const state = runtimeState.snapshot();
    if (runtimeState.isReady()) return res.json({ status: 'ready' });
    return res.status(503).json({
      status: 'not_ready',
      reason: state.failureReason || state.phase,
    });
  });
  app.all('/health', (req, res) =>
    sendError(req, res, 404, 'not_found', 'The requested resource was not found.'),
  );

  app.use('/api', (req, res, next) => {
    if (!runtimeState.isShuttingDown()) return next();
    return sendError(
      req,
      res,
      503,
      'server_shutting_down',
      'Command Center is restarting. Try again after it becomes ready.',
    );
  });
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  const DIST_DIR = config.distDir;
  app.use(express.static(DIST_DIR));

  // ── Auth ──────────────────────────────────────────────────────────────────────

  function asyncHandler(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
  }

  const requireAuth = authSystem.requireAuth;
  const requireWriteAuth = [authSystem.requireAuth, authSystem.requireCsrf];

  function formatDeviceSummary(device) {
    return formatDevice(device, {
      stmts,
      mqttService,
      actionEngine,
      scheduleService,
    });
  }

  function sendDeviceActionError(req, res, error) {
    if (!(error instanceof DeviceActionError)) throw error;
    return sendError(req, res, error.status, error.code, error.message, error.details);
  }

  function sendReleaseUpdateError(req, res, error) {
    if (!(error instanceof ReleaseUpdateError)) throw error;
    return sendError(req, res, error.status, error.code, error.message);
  }

  function formatSession(session) {
    return {
      csrf_token: session.csrfToken,
      expires_at: new Date(session.expiresAt).toISOString(),
      user: {
        id: 'local-admin',
        username: session.username,
        devices: stmts.getAllDevices.all().map(formatDeviceSummary),
      },
    };
  }

  app.get('/api/v1/bootstrap', (req, res) => {
    const auth = authSystem.authenticate(req, res);
    if (!auth) {
      return res.json({
        bootstrap: {
          session: null,
          setup_required: authSystem.setupRequired(),
        },
      });
    }
    req.auth = auth;
    return res.json({
      bootstrap: {
        session: formatSession(authSystem.refreshSession(req)),
        setup_required: false,
      },
    });
  });

  app.post(
    '/api/v1/setup',
    asyncHandler(async (req, res) => {
      const setup = await authSystem.setup(req, {
        username: req.body?.username,
        password: req.body?.password,
        passwordConfirmation: req.body?.password_confirmation,
      });
      return res.status(201).json({ setup: { complete: true, username: setup.username } });
    }),
  );

  app.post(
    '/api/v1/session',
    asyncHandler(async (req, res) => {
      const session = await authSystem.login(req, {
        username: req.body?.username,
        password: req.body?.password,
      });
      authSystem.setSessionCookie(req, res, session.sessionId);
      return res.status(201).json({ session: formatSession(session) });
    }),
  );

  app.get('/api/v1/session', requireAuth, (req, res) => {
    return res.json({ session: formatSession(authSystem.refreshSession(req)) });
  });

  app.delete('/api/v1/session', ...requireWriteAuth, (req, res) => {
    return res.json({ session: authSystem.logout(req, res) });
  });

  app.patch(
    '/api/v1/admin/username',
    ...requireWriteAuth,
    asyncHandler(async (req, res) => {
      const result = await authSystem.changeUsername(req, {
        username: req.body?.username,
        currentPassword: req.body?.current_password,
      });
      authSystem.clearSessionCookie(req, res);
      return res.json({
        admin: { username: result.username },
        sessions: { revoked_count: result.revokedCount },
      });
    }),
  );

  app.patch(
    '/api/v1/admin/password',
    ...requireWriteAuth,
    asyncHandler(async (req, res) => {
      const result = await authSystem.changePassword(req, {
        currentPassword: req.body?.current_password,
        password: req.body?.password,
        passwordConfirmation: req.body?.password_confirmation,
      });
      authSystem.clearSessionCookie(req, res);
      return res.json({
        admin: { username: result.username },
        sessions: { revoked_count: result.revokedCount },
      });
    }),
  );

  app.get('/api/v1/server/health', requireAuth, (_req, res) => {
    return res.json({ server_health: formatServerHealth(mqttService) });
  });

  // ── Command Center releases ─────────────────────────────────────────────────

  app.get(
    '/api/v1/updates',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!updateService) {
        return sendError(req, res, 503, 'update_service_unavailable', 'Updates are unavailable.');
      }
      const updates = await updateService.check({ force: req.query.check === '1' });
      return res.json({ updates });
    }),
  );

  app.post('/api/v1/updates/dismiss', ...requireWriteAuth, (req, res) => {
    if (!updateService) {
      return sendError(req, res, 503, 'update_service_unavailable', 'Updates are unavailable.');
    }
    try {
      return res.json({ updates: updateService.dismiss(req.body?.tag) });
    } catch (error) {
      return sendReleaseUpdateError(req, res, error);
    }
  });

  app.put(
    '/api/v1/updates/settings',
    ...requireWriteAuth,
    asyncHandler(async (req, res) => {
      if (!updateService) {
        return sendError(req, res, 503, 'update_service_unavailable', 'Updates are unavailable.');
      }
      try {
        return res.json({
          updates: await updateService.setAutoInstall(req.body?.auto_install),
        });
      } catch (error) {
        return sendReleaseUpdateError(req, res, error);
      }
    }),
  );

  app.post('/api/v1/updates/install', ...requireWriteAuth, (req, res) => {
    if (!updateService) {
      return sendError(req, res, 503, 'update_service_unavailable', 'Updates are unavailable.');
    }
    try {
      return res.status(202).json({
        updates: updateService.requestInstall(req.body?.tag),
      });
    } catch (error) {
      return sendReleaseUpdateError(req, res, error);
    }
  });

  // ── Read-only diagnostics ────────────────────────────────────────────────────

  app.get('/api/v1/diagnostics', requireAuth, (_req, res) => {
    return res.json({ diagnostics: diagnosticsService.summary() });
  });

  app.get('/api/v1/diagnostics/devices/:deviceId', requireAuth, (req, res) => {
    const diagnostics = diagnosticsService.device(req.params.deviceId);
    if (!diagnostics) return sendError(req, res, 404, 'device_not_found', 'Device not found.');
    return res.json({ diagnostics });
  });

  app.get('/api/v1/diagnostics/export', requireAuth, (_req, res) => {
    const timestamp = new Date(clock()).toISOString().replace(/[:.]/g, '-');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="growhub-diagnostics-${timestamp}.json"`,
    );
    return res.json({ diagnostics: diagnosticsService.exportBundle() });
  });

  // ── Data logs ─────────────────────────────────────────────────────────────────

  app.get('/api/v1/data-logs/rangev3', requireAuth, (req, res) => {
    const { deviceId, fromDate, toDate } = req.query;
    if (!deviceId) return sendError(req, res, 400, 'invalid_request', 'deviceId is required.');
    const fromMs = fromDate ? new Date(fromDate).getTime() : clock() - 24 * 3_600_000;
    const toMs = toDate ? new Date(toDate).getTime() : clock();
    const rows = stmts.getMeasurementsInRange.all(deviceId, fromMs, toMs);
    const series = { temp: [], rh: [], light: [], co2: [], vpd: [], dewPoint: [] };
    for (const row of rows) {
      const ts = row.taken_at,
        t = row.temp ?? 0,
        rh = row.humidity ?? 0;
      series.temp.push([ts, t]);
      series.rh.push([ts, rh]);
      series.light.push([ts, row.light ?? 0]);
      series.co2.push([ts, row.co2 ?? 0]);
      series.vpd.push([ts, calcVPD(t, rh)]);
      series.dewPoint.push([ts, calcDewPoint(t, rh)]);
    }
    return res.json({ series });
  });

  app.get('/api/v1/data-logs/device/:deviceId/request-csv', requireAuth, (_req, res) => {
    return res.json({
      export: {
        available: false,
        message: 'CSV export not available in community edition',
      },
    });
  });

  // ── Device actions ────────────────────────────────────────────────────────────

  app.post(
    '/api/v1/devices/:deviceId/actions',
    ...requireWriteAuth,
    asyncHandler(async (req, res) => {
      if (!actionEngine) {
        return sendError(
          req,
          res,
          503,
          'action_engine_unavailable',
          'Device actions are unavailable.',
        );
      }
      const body = req.body;
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).some((key) => !new Set(['type', 'input']).has(key)) ||
        typeof body.type !== 'string'
      ) {
        return sendError(req, res, 400, 'invalid_action', 'A typed device action is required.');
      }
      try {
        const row = await actionEngine.submit({
          deviceId: req.params.deviceId,
          type: body.type,
          input: body.input ?? {},
          requestId: req.requestId,
        });
        const action = actionEngine.formatAction(row);
        if (action.status === 'pending') {
          res.setHeader('Location', `/api/v1/devices/${req.params.deviceId}/actions/${action.id}`);
          return res.status(202).json({ action });
        }
        return res.json({ action });
      } catch (error) {
        return sendDeviceActionError(req, res, error);
      }
    }),
  );

  app.get('/api/v1/devices/:deviceId/actions', requireAuth, (req, res) => {
    const device = stmts.getDevice.get(req.params.deviceId);
    if (!device) return sendError(req, res, 404, 'device_not_found', 'Device not found.');
    if (!actionEngine) return res.json({ actions: [], next_cursor: null });
    try {
      return res.json(actionEngine.list(req.params.deviceId, req.query));
    } catch (error) {
      return sendDeviceActionError(req, res, error);
    }
  });

  app.get('/api/v1/devices/:deviceId/actions/:actionId', requireAuth, (req, res) => {
    const device = stmts.getDevice.get(req.params.deviceId);
    if (!device) return sendError(req, res, 404, 'device_not_found', 'Device not found.');
    const row = actionEngine?.get(req.params.deviceId, req.params.actionId);
    if (!row) return sendError(req, res, 404, 'action_not_found', 'Device action not found.');
    return res.json({ action: actionEngine.formatAction(row) });
  });

  app.get('/api/v1/devices/:deviceId/activity', requireAuth, (req, res) => {
    const device = stmts.getDevice.get(req.params.deviceId);
    if (!device) return sendError(req, res, 404, 'device_not_found', 'Device not found.');
    if (!scheduleService) return res.json({ activity: [], next_cursor: null });
    try {
      return res.json(scheduleService.activity(req.params.deviceId, req.query));
    } catch (error) {
      return sendDeviceActionError(req, res, error);
    }
  });

  app.get('/api/v1/iot-devices/:deviceId', requireAuth, (req, res) => {
    const device = stmts.getDevice.get(req.params.deviceId);
    if (!device) return sendError(req, res, 404, 'device_not_found', 'Device not found.');
    return res.json({ device: formatDeviceSummary(device) });
  });

  app.put('/api/v1/iot-devices/:deviceId/name', ...requireWriteAuth, (req, res) => {
    const { name } = req.body || {};
    if (!name?.trim()) return sendError(req, res, 400, 'invalid_request', 'name is required.');
    const device = stmts.getDevice.get(req.params.deviceId);
    if (!device) return sendError(req, res, 404, 'device_not_found', 'Device not found.');
    db.prepare(
      `
      UPDATE devices SET display_name = ?, updated_at = ? WHERE id = ?
    `,
    ).run(name.trim(), clock(), req.params.deviceId);
    return res.json({
      device: {
        id: req.params.deviceId,
        name: name.trim(),
      },
    });
  });

  app.get('/api/v1/devices', requireAuth, (_req, res) => {
    return res.json({ devices: stmts.getAllDevices.all().map(formatDeviceSummary) });
  });

  app.get('/api/v1/devices/:deviceId', requireAuth, (req, res) => {
    const device = stmts.getDevice.get(req.params.deviceId);
    if (!device) return sendError(req, res, 404, 'device_not_found', 'Device not found.');
    return res.json({ device: formatDeviceSummary(device) });
  });

  app.get('/api/v1/devices/:deviceId/outlets', requireAuth, (req, res) => {
    const device = stmts.getDevice.get(req.params.deviceId);
    if (!device) return sendError(req, res, 404, 'device_not_found', 'Device not found.');
    const formatted = formatDeviceSummary(device);
    return res.json({ outlets: formatted.outlets });
  });

  // ── Alarms ────────────────────────────────────────────────────────────────────

  app.get('/api/v1/alarms/user/:userId', requireAuth, (_req, res) => {
    return res.json({
      alerts: stmts.getAllAlarms.all().map((alert) => ({
        id: alert.id,
        device_id: alert.device_id,
        type: alert.type,
        message: alert.message,
        severity: alert.severity,
        acknowledged: alert.read === 1,
        created_at: new Date(alert.created_at).toISOString(),
      })),
    });
  });

  app.put('/api/v1/alarms/user/:userId', ...requireWriteAuth, (_req, res) => {
    const result = stmts.markAllAlarmsRead.run();
    return res.json({ alerts: { acknowledged_count: result.changes } });
  });

  // ── Schedule templates, preflight, and drift ─────────────────────────────────

  app.get('/api/v1/schedule-templates', requireAuth, (_req, res) => {
    return res.json({ templates: scheduleService?.listTemplates?.() ?? [] });
  });

  app.post('/api/v1/schedule-templates', ...requireWriteAuth, (req, res) => {
    try {
      return res.status(201).json({ template: scheduleService.createTemplate(req.body) });
    } catch (error) {
      return sendDeviceActionError(req, res, error);
    }
  });

  app.get('/api/v1/schedule-templates/:id', requireAuth, (req, res) => {
    try {
      return res.json({ template: scheduleService.getTemplate(req.params.id) });
    } catch (error) {
      return sendDeviceActionError(req, res, error);
    }
  });

  app.put('/api/v1/schedule-templates/:id', ...requireWriteAuth, (req, res) => {
    try {
      return res.json({ template: scheduleService.updateTemplate(req.params.id, req.body) });
    } catch (error) {
      return sendDeviceActionError(req, res, error);
    }
  });

  app.delete('/api/v1/schedule-templates/:id', ...requireWriteAuth, (req, res) => {
    try {
      return res.json({ template: scheduleService.deleteTemplate(req.params.id) });
    } catch (error) {
      return sendDeviceActionError(req, res, error);
    }
  });

  app.get('/api/v1/schedule-templates/:id/revisions', requireAuth, (req, res) => {
    try {
      return res.json({ revisions: scheduleService.listRevisions(req.params.id) });
    } catch (error) {
      return sendDeviceActionError(req, res, error);
    }
  });

  app.post('/api/v1/devices/:deviceId/schedule-preflight', requireAuth, (req, res) => {
    try {
      return res.json({
        preflight: scheduleService.preflight(
          req.params.deviceId,
          req.body?.template_id,
          req.body?.mappings,
        ),
      });
    } catch (error) {
      return sendDeviceActionError(req, res, error);
    }
  });

  app.get('/api/v1/devices/:deviceId/schedule-drift', requireAuth, (req, res) => {
    const device = stmts.getDevice.get(req.params.deviceId);
    if (!device) return sendError(req, res, 404, 'device_not_found', 'Device not found.');
    try {
      return res.json({ drift: scheduleService.driftDetails(req.params.deviceId) });
    } catch (error) {
      return sendDeviceActionError(req, res, error);
    }
  });

  // ── Events ────────────────────────────────────────────────────────────────────

  function formatEvent(e) {
    return {
      id: e.id,
      device_id: e.device_id,
      schedule_id: e.schedule_id,
      type: e.type,
      phase: e.phase,
      label: e.label,
      notes: e.notes,
      occurred_at: e.occurred_at,
      created_at: e.created_at,
    };
  }

  app.get('/api/v1/events', requireAuth, (req, res) => {
    const { deviceId } = req.query;
    if (!deviceId) return sendError(req, res, 400, 'invalid_request', 'deviceId is required.');
    return res.json({ events: stmts.getEvents.all(deviceId).map(formatEvent) });
  });

  app.post('/api/v1/events', ...requireWriteAuth, (req, res) => {
    const { deviceId, scheduleId, type, phase, label, notes, occurredAt } = req.body || {};
    if (!type || !label) {
      return sendError(req, res, 400, 'invalid_request', 'type and label are required.');
    }
    const now = clock();
    const info = stmts.insertEvent.run({
      device_id: deviceId ?? null,
      schedule_id: scheduleId ?? null,
      type,
      phase: phase ?? null,
      label,
      notes: notes ?? null,
      occurred_at: occurredAt ?? now,
      created_at: now,
    });
    return res.status(201).json({ event: formatEvent(stmts.getEvent.get(info.lastInsertRowid)) });
  });

  app.patch('/api/v1/events/:id', ...requireWriteAuth, (req, res) => {
    const event = stmts.getEvent.get(req.params.id);
    if (!event) return sendError(req, res, 404, 'event_not_found', 'Event not found.');
    const { label, notes, occurredAt } = req.body || {};
    stmts.updateEvent.run({
      id: event.id,
      label: label ?? event.label,
      notes: notes ?? event.notes,
      occurred_at: occurredAt ?? event.occurred_at,
    });
    return res.json({ event: formatEvent(stmts.getEvent.get(event.id)) });
  });

  app.delete('/api/v1/events/:id', ...requireWriteAuth, (req, res) => {
    const event = stmts.getEvent.get(req.params.id);
    if (!event) return sendError(req, res, 404, 'event_not_found', 'Event not found.');
    const r = stmts.deleteEvent.run(req.params.id);
    if (r.changes === 0) {
      return sendError(req, res, 403, 'event_protected', 'System events cannot be deleted.');
    }
    return res.json({ event: { id: event.id, deleted: true } });
  });

  app.get('/api/v1/events/phase/current', requireAuth, (req, res) => {
    const { deviceId } = req.query;
    if (!deviceId) return sendError(req, res, 400, 'invalid_request', 'deviceId is required.');
    const row = stmts.getCurrentPhase.get(deviceId);
    return res.json({ current_phase: { device_id: deviceId, phase: row?.phase ?? null } });
  });

  // ── Settings ──────────────────────────────────────────────────────────────────

  app.get('/api/v1/settings', requireAuth, (_req, res) => {
    const out = {};
    for (const r of stmts.getAllSettings.all()) out[r.key] = r.value;
    return res.json({ settings: out });
  });

  app.put('/api/v1/settings', ...requireWriteAuth, (req, res) => {
    for (const [k, v] of Object.entries(req.body || {})) stmts.setSetting.run(k, String(v));
    const settings = {};
    for (const row of stmts.getAllSettings.all()) settings[row.key] = row.value;
    return res.json({ settings });
  });

  // ── SPA fallback + framework errors ──────────────────────────────────────────

  app.use('/api', (req, res) =>
    sendError(req, res, 404, 'not_found', 'The requested API resource was not found.'),
  );
  app.get('*', (_req, res, next) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'), (err) => {
      if (err) next(err);
    });
  });
  app.use((req, res) =>
    sendError(req, res, 404, 'not_found', 'The requested resource was not found.'),
  );
  app.use(errorHandler(logger));

  return app;
}

// ── Runtime bootstrap ─────────────────────────────────────────────────────────

function listen(app, { host, port }) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      server.off('error', reject);
      resolve(server);
    });
    server.once('error', reject);
  });
}

function closeHttpServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function startRetentionSweep({ stmts, logger, clock, intervalMs, setIntervalFn }) {
  const handle = setIntervalFn(() => {
    try {
      const row = stmts.getSetting.get('retention_days');
      const days = row ? Number.parseInt(row.value, 10) : 365;
      if (!Number.isInteger(days) || days <= 0) return;
      const result = stmts.deleteOldMeasurements.run(clock() - days * 86_400_000);
      if (result.changes > 0) {
        logger.info('measurement_retention_completed', { deleted_count: result.changes });
      }
    } catch (error) {
      logger.error('measurement_retention_failed', { error });
    }
  }, intervalMs);
  handle.unref?.();
  return handle;
}

async function startServer({
  env = process.env,
  clock = () => Date.now(),
  uuid,
  logger: suppliedLogger,
  appDataLock: suppliedAppDataLock,
  database: suppliedDatabase,
  mqttService: suppliedMqttService,
  actionEngine: suppliedActionEngine,
  scheduleService: suppliedScheduleService,
  updateService: suppliedUpdateService,
  runtimeState: suppliedRuntimeState,
  listenFn = listen,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  acquireAppDataLockFn = acquireAppDataLock,
} = {}) {
  const config = loadConfig(env);
  const logger =
    suppliedLogger ||
    createLogger({
      level: config.logLevel,
      clock: () => new Date(clock()),
      includeErrorMessages: config.nodeEnv !== 'production',
    });
  const runtimeState = suppliedRuntimeState || createRuntimeState({ clock });

  let appDataLock = suppliedAppDataLock;
  let database = suppliedDatabase;
  let mqttService = suppliedMqttService;
  let actionEngine = suppliedActionEngine;
  let scheduleService = suppliedScheduleService;
  let updateService = suppliedUpdateService;
  let removeActionObserver;
  let removeScheduleObserver;
  let server;
  let retentionHandle;
  let authSweepHandle;

  try {
    appDataLock ||= acquireAppDataLockFn(config.appDataDir);
    database ||= openDatabase(config.dbPath, { clock });
    logger.info('database_ready', {
      schema_version: database.migrationState?.currentVersion ?? null,
      migrations_applied: database.migrationState?.appliedCount ?? null,
    });
    mqttService ||= createMqttService({
      url: config.mqttUrl,
      clientId: config.mqttClientId,
      stmts: database.stmts,
      logger,
      clock,
      setTimeoutFn,
      clearTimeoutFn,
    });
    actionEngine ||= createDeviceActionEngine({
      database,
      mqttService,
      logger,
      clock,
      uuid,
      setTimeoutFn,
      clearTimeoutFn,
    });
    scheduleService ||= createScheduleTemplateService({
      database,
      mqttService,
      actionEngine,
      logger,
      clock,
      uuid,
    });
    if (!updateService && database.migrationState) {
      updateService = createReleaseUpdateService({
        database,
        logger,
        updateRequestDir: config.updateRequestDir,
        clock,
        setIntervalFn,
        clearIntervalFn,
      });
    }
    actionEngine.recover();
    removeActionObserver = mqttService.addObserver?.(actionEngine);
    removeScheduleObserver = mqttService.addObserver?.(scheduleService);
    const app = createApp({
      config,
      runtimeState,
      database,
      mqttService,
      actionEngine,
      scheduleService,
      updateService,
      logger,
      uuid,
      clock,
    });
    server = await listenFn(app, config);
    updateService?.start?.();
    mqttService.connect();
    retentionHandle = startRetentionSweep({
      stmts: database.stmts,
      logger,
      clock,
      intervalMs: config.retentionSweepMs,
      setIntervalFn,
    });
    authSweepHandle = setIntervalFn(() => app.locals.authSystem.limiter.sweep(), SWEEP_INTERVAL_MS);
    authSweepHandle.unref?.();
    runtimeState.markReady();

    const address = server.address();
    logger.info('server_started', {
      host: config.host,
      port: typeof address === 'object' && address ? address.port : config.port,
      node_env: config.nodeEnv,
    });

    let stopPromise;
    function stop(reason = 'requested') {
      if (stopPromise) return stopPromise;
      runtimeState.beginShutdown();
      logger.info('server_shutdown_started', { reason });

      stopPromise = (async () => {
        if (retentionHandle) {
          clearIntervalFn(retentionHandle);
          retentionHandle = null;
        }
        if (authSweepHandle) {
          clearIntervalFn(authSweepHandle);
          authSweepHandle = null;
        }

        const forceHandle = setTimeoutFn(() => {
          logger.warn('server_http_drain_expired');
          server.closeAllConnections();
        }, config.shutdownDrainMs);
        forceHandle.unref?.();

        try {
          await closeHttpServer(server);
        } finally {
          clearTimeoutFn(forceHandle);
          try {
            updateService?.close?.();
          } catch (_) {}
          try {
            removeActionObserver?.();
          } catch (_) {}
          try {
            removeScheduleObserver?.();
          } catch (_) {}
          try {
            scheduleService?.close?.();
          } catch (_) {}
          try {
            actionEngine?.close?.();
          } catch (_) {}
          try {
            await mqttService.disconnect();
          } finally {
            try {
              database.close();
            } finally {
              appDataLock.release();
            }
          }
        }
        logger.info('server_shutdown_completed', { reason });
      })();
      return stopPromise;
    }

    return {
      app,
      appDataLock,
      config,
      database,
      actionEngine,
      scheduleService,
      updateService,
      logger,
      mqttService,
      runtimeState,
      server,
      stop,
    };
  } catch (error) {
    runtimeState.markFailed('startup_failed');
    logger.error('server_start_failed', { error });
    if (error && typeof error === 'object') {
      try {
        Object.defineProperty(error, 'startupFailureReported', { value: true });
      } catch (_) {}
    }
    if (server) {
      try {
        await closeHttpServer(server);
      } catch (_) {}
    }
    if (authSweepHandle) {
      try {
        clearIntervalFn(authSweepHandle);
      } catch (_) {}
    }
    if (mqttService) {
      try {
        await mqttService.disconnect();
      } catch (_) {}
    }
    try {
      updateService?.close?.();
    } catch (_) {}
    try {
      removeActionObserver?.();
    } catch (_) {}
    try {
      removeScheduleObserver?.();
    } catch (_) {}
    try {
      scheduleService?.close?.();
    } catch (_) {}
    try {
      actionEngine?.close?.();
    } catch (_) {}
    if (database) {
      try {
        database.close();
      } catch (_) {}
    }
    if (appDataLock) {
      try {
        appDataLock.release();
      } catch (_) {}
    }
    throw error;
  }
}

function installSignalHandlers(runningServer) {
  let stopping = false;

  function handle(signal) {
    if (stopping) return;
    stopping = true;
    const deadlineHandle = setTimeout(() => {
      runningServer.logger.error('server_shutdown_deadline_exceeded', { signal });
      process.exit(1);
    }, runningServer.config.shutdownDeadlineMs);
    deadlineHandle.unref?.();

    runningServer.stop(signal).then(
      () => {
        clearTimeout(deadlineHandle);
        process.exit(0);
      },
      (error) => {
        runningServer.logger.error('server_shutdown_failed', { signal, error });
        process.exit(1);
      },
    );
  }

  process.once('SIGTERM', () => handle('SIGTERM'));
  process.once('SIGINT', () => handle('SIGINT'));
}

function reportStartupFailure(error) {
  if (error?.startupFailureReported) return;
  const isConfigurationError = error instanceof ConfigurationError;
  const isExposedError = isConfigurationError || error?.expose === true;
  const record = {
    timestamp: new Date().toISOString(),
    level: 'error',
    event: 'server_start_failed',
    error: {
      code: isExposedError && error.code ? error.code : 'startup_failed',
      message: isExposedError ? error.message : 'Command Center failed to start.',
    },
  };
  if (isConfigurationError) record.error.field = error.field;
  process.stderr.write(`${JSON.stringify(record)}\n`);
}

if (require.main === module) {
  startServer()
    .then(installSignalHandlers)
    .catch((error) => {
      reportStartupFailure(error);
      process.exitCode = 1;
    });
}

module.exports = {
  createApp,
  installSignalHandlers,
  reportStartupFailure,
  startRetentionSweep,
  startServer,
};
