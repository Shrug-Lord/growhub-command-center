'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/index');
const { CURRENT_PARAMETERS, hashPassword, parseVerifier } = require('../src/passwordAuth');
const { SESSION_SECRET_FILE } = require('../src/sessionSecret');
const { createRuntimeState } = require('../src/runtimeState');

const ORIGINAL_PASSWORD = 'correct horse battery staple';
const REPLACEMENT_PASSWORD = 'river canopy sunrise lantern';

function loggerStub() {
  return { debug() {}, error() {}, info() {}, warn() {} };
}

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'growhub-auth-api-'));
}

async function startInstance(appDataDir, clock, env = {}) {
  const dbPath = path.join(appDataDir, 'growhub.db');
  const database = openDatabase(dbPath, { clock });
  const runtimeState = createRuntimeState({ clock });
  runtimeState.markReady();
  const app = createApp({
    config: loadConfig({
      NODE_ENV: 'test',
      APP_DATA_DIR: appDataDir,
      DB_PATH: dbPath,
      ...env,
    }),
    runtimeState,
    database,
    mqttService: { publish() {} },
    logger: loggerStub(),
    clock,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    app,
    baseUrl,
    database,
    async close() {
      await new Promise((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      );
      database.close();
    },
  };
}

async function request(instance, method, pathname, { body, cookie, csrf, headers = {} } = {}) {
  const response = await fetch(`${instance.baseUrl}${pathname}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { body: await response.json(), response };
}

async function setup(instance, headers = {}) {
  return request(instance, 'POST', '/api/v1/setup', {
    headers,
    body: {
      username: 'Admin',
      password: ORIGINAL_PASSWORD,
      password_confirmation: ORIGINAL_PASSWORD,
    },
  });
}

async function login(instance, username, password, headers = {}) {
  const result = await request(instance, 'POST', '/api/v1/session', {
    body: { username, password },
    headers,
  });
  if (!result.response.ok) return result;
  return {
    ...result,
    session: {
      cookie: result.response.headers.get('set-cookie').split(';')[0],
      csrf: result.body.session.csrf_token,
    },
  };
}

test('first-run setup, cookie sessions, CSRF, restart, credential changes, and logout work end to end', async (t) => {
  const appDataDir = temporaryDirectory();
  let now = Date.parse('2026-07-13T12:00:00.000Z');
  const clock = () => now;
  let instance = await startInstance(appDataDir, clock);
  t.after(async () => {
    if (instance) await instance.close();
    fs.rmSync(appDataDir, { recursive: true, force: true });
  });

  const live = await request(instance, 'GET', '/health/live');
  assert.deepEqual(live.body, { status: 'ok', setup_required: true });
  const bootstrapBeforeSetup = await request(instance, 'GET', '/api/v1/bootstrap');
  assert.deepEqual(bootstrapBeforeSetup.body, {
    bootstrap: { session: null, setup_required: true },
  });
  const protectedBeforeSetup = await request(instance, 'GET', '/api/v1/devices');
  assert.equal(protectedBeforeSetup.response.status, 401);
  assert.equal(protectedBeforeSetup.body.error.code, 'setup_required');

  const configured = await setup(instance);
  assert.equal(configured.response.status, 201);
  assert.deepEqual(configured.body, { setup: { complete: true, username: 'admin' } });
  assert.equal(configured.response.headers.get('cache-control'), 'no-store');
  assert.equal(configured.response.headers.get('access-control-allow-origin'), null);
  assert.equal(configured.response.headers.get('x-powered-by'), null);
  const secretPath = path.join(appDataDir, SESSION_SECRET_FILE);
  assert.equal(fs.statSync(secretPath).mode & 0o777, 0o600);
  assert.equal(
    instance.database.stmts.getAdmin.get().password_verifier.includes(ORIGINAL_PASSWORD),
    false,
  );

  const repeatedSetup = await setup(instance);
  assert.equal(repeatedSetup.response.status, 409);
  assert.equal(repeatedSetup.body.error.code, 'setup_complete');

  const wrongLogin = await login(instance, 'ADMIN', 'this is not the right password');
  assert.equal(wrongLogin.response.status, 401);
  assert.deepEqual(wrongLogin.body.error, {
    code: 'authentication_failed',
    message: 'Unable to sign in.',
  });

  const firstLogin = await login(instance, 'ADMIN', ORIGINAL_PASSWORD);
  assert.equal(firstLogin.response.status, 201);
  assert.equal(firstLogin.body.session.user.username, 'admin');
  const setCookie = firstLogin.response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /Max-Age=2592000/);
  assert.doesNotMatch(setCookie, /Secure/);

  const rawSessionId = firstLogin.session.cookie.split('=')[1];
  const storedSession = instance.database.db.prepare('SELECT * FROM auth_sessions').get();
  assert.equal(storedSession.id_hash.length, 64);
  assert.notEqual(storedSession.id_hash, rawSessionId);
  assert.notEqual(storedSession.csrf_hash, firstLogin.session.csrf);

  const missingCsrf = await request(instance, 'PUT', '/api/v1/settings', {
    cookie: firstLogin.session.cookie,
    body: { retention_days: '30' },
  });
  assert.equal(missingCsrf.response.status, 403);
  assert.equal(missingCsrf.body.error.code, 'csrf_required');

  const refreshed = await request(instance, 'GET', '/api/v1/session', {
    cookie: firstLogin.session.cookie,
  });
  assert.equal(refreshed.response.status, 200);
  assert.notEqual(refreshed.body.session.csrf_token, firstLogin.session.csrf);
  const staleCsrf = await request(instance, 'PUT', '/api/v1/settings', {
    cookie: firstLogin.session.cookie,
    csrf: firstLogin.session.csrf,
    body: { retention_days: '30' },
  });
  assert.equal(staleCsrf.response.status, 403);
  assert.equal(staleCsrf.body.error.code, 'csrf_invalid');
  const currentCsrf = refreshed.body.session.csrf_token;
  const updated = await request(instance, 'PUT', '/api/v1/settings', {
    cookie: firstLogin.session.cookie,
    csrf: currentCsrf,
    body: { retention_days: '30' },
  });
  assert.equal(updated.response.status, 200);

  now += 86_400_000;
  const beforeRestart = await request(instance, 'GET', '/api/v1/session', {
    cookie: firstLogin.session.cookie,
  });
  assert.equal(beforeRestart.response.status, 200);
  assert.equal(Date.parse(beforeRestart.body.session.expires_at), now + 30 * 86_400_000);
  await instance.close();
  instance = await startInstance(appDataDir, clock);

  const afterRestart = await request(instance, 'GET', '/api/v1/session', {
    cookie: firstLogin.session.cookie,
  });
  assert.equal(afterRestart.response.status, 200);
  assert.equal(afterRestart.body.session.user.username, 'admin');

  const secondLogin = await login(instance, 'admin', ORIGINAL_PASSWORD);
  assert.equal(secondLogin.response.status, 201);
  const usernameChange = await request(instance, 'PATCH', '/api/v1/admin/username', {
    cookie: secondLogin.session.cookie,
    csrf: secondLogin.session.csrf,
    body: { username: 'Test.Admin', current_password: ORIGINAL_PASSWORD },
  });
  assert.equal(usernameChange.response.status, 200);
  assert.equal(usernameChange.body.admin.username, 'test.admin');
  assert.ok(usernameChange.body.sessions.revoked_count >= 2);

  for (const cookie of [firstLogin.session.cookie, secondLogin.session.cookie]) {
    const revoked = await request(instance, 'GET', '/api/v1/session', { cookie });
    assert.equal(revoked.response.status, 401);
    assert.equal(revoked.body.error.code, 'session_required');
  }
  assert.equal((await login(instance, 'admin', ORIGINAL_PASSWORD)).response.status, 401);

  const renamedLogin = await login(instance, 'TEST.ADMIN', ORIGINAL_PASSWORD);
  assert.equal(renamedLogin.response.status, 201);
  const passwordChange = await request(instance, 'PATCH', '/api/v1/admin/password', {
    cookie: renamedLogin.session.cookie,
    csrf: renamedLogin.session.csrf,
    body: {
      current_password: ORIGINAL_PASSWORD,
      password: REPLACEMENT_PASSWORD,
      password_confirmation: REPLACEMENT_PASSWORD,
    },
  });
  assert.equal(passwordChange.response.status, 200);
  assert.equal(
    (
      await request(instance, 'GET', '/api/v1/session', {
        cookie: renamedLogin.session.cookie,
      })
    ).response.status,
    401,
  );
  assert.equal((await login(instance, 'test.admin', ORIGINAL_PASSWORD)).response.status, 401);

  const replacementLogin = await login(instance, 'test.admin', REPLACEMENT_PASSWORD);
  assert.equal(replacementLogin.response.status, 201);
  const loggedOut = await request(instance, 'DELETE', '/api/v1/session', {
    cookie: replacementLogin.session.cookie,
    csrf: replacementLogin.session.csrf,
  });
  assert.equal(loggedOut.response.status, 200);
  assert.deepEqual(loggedOut.body, { session: { ended: true } });
  assert.equal(
    (
      await request(instance, 'GET', '/api/v1/session', {
        cookie: replacementLogin.session.cookie,
      })
    ).response.status,
    401,
  );

  const legacyLogin = await request(instance, 'POST', '/api/v1/auth', {
    body: { identifier: 'legacy@example.invalid', password: 'obsolete example password' },
  });
  assert.equal(legacyLogin.response.status, 404);
  const bearerOnly = await request(instance, 'GET', '/api/v1/devices', {
    headers: { Authorization: 'Bearer obsolete-example-token' },
  });
  assert.equal(bearerOnly.response.status, 401);

  const persisted = JSON.stringify(instance.database.stmts.getAuthSecurityEvents.all());
  for (const secret of [ORIGINAL_PASSWORD, REPLACEMENT_PASSWORD, rawSessionId, currentCsrf]) {
    assert.equal(persisted.includes(secret), false);
  }
});

test('login rate limits use generic failures and retain no submitted username', async (t) => {
  const appDataDir = temporaryDirectory();
  const clock = () => Date.parse('2026-07-13T12:00:00.000Z');
  const instance = await startInstance(appDataDir, clock);
  t.after(async () => {
    await instance.close();
    fs.rmSync(appDataDir, { recursive: true, force: true });
  });
  await setup(instance);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const failed = await login(instance, 'target-admin', 'incorrect password value');
    assert.equal(failed.response.status, 401);
    assert.equal(failed.body.error.code, 'authentication_failed');
  }
  const blocked = await login(instance, 'target-admin', 'incorrect password value');
  assert.equal(blocked.response.status, 429);
  assert.equal(blocked.body.error.code, 'rate_limited');
  assert.equal(blocked.response.headers.get('retry-after'), '300');

  const events = instance.database.stmts.getAuthSecurityEvents.all();
  assert.deepEqual(
    events
      .filter((event) => event.type === 'rate_limit_throttled')
      .map((event) => event.category)
      .sort(),
    ['login_ip', 'login_username'],
  );
  assert.equal(JSON.stringify(events).includes('target-admin'), false);
});

test('HTTPS behind an explicitly trusted proxy adds Secure to the host-only cookie', async (t) => {
  const appDataDir = temporaryDirectory();
  const instance = await startInstance(appDataDir, () => Date.parse('2026-07-13T12:00:00.000Z'), {
    TRUSTED_PROXIES: '127.0.0.1',
  });
  t.after(async () => {
    await instance.close();
    fs.rmSync(appDataDir, { recursive: true, force: true });
  });
  const proxyHeaders = {
    'X-Forwarded-For': '192.0.2.10',
    'X-Forwarded-Proto': 'https',
  };
  assert.equal((await setup(instance, proxyHeaders)).response.status, 201);
  const authenticated = await login(instance, 'admin', ORIGINAL_PASSWORD, proxyHeaders);
  assert.equal(authenticated.response.status, 201);
  assert.match(authenticated.response.headers.get('set-cookie'), /; Secure$/);
  assert.doesNotMatch(authenticated.response.headers.get('set-cookie'), /Domain=/i);
});

test('successful login upgrades supported password parameters and idle sessions expire', async (t) => {
  const appDataDir = temporaryDirectory();
  let now = Date.parse('2026-07-13T12:00:00.000Z');
  const instance = await startInstance(appDataDir, () => now);
  t.after(async () => {
    await instance.close();
    fs.rmSync(appDataDir, { recursive: true, force: true });
  });
  await setup(instance);

  const weakVerifier = await hashPassword(ORIGINAL_PASSWORD, {
    parameters: {
      version: 19,
      memory: 7_168,
      passes: 1,
      parallelism: 1,
      tagLength: 32,
      saltLength: 16,
    },
  });
  instance.database.db
    .prepare(
      `
    UPDATE admin_credentials SET password_verifier = ? WHERE id = 1
  `,
    )
    .run(weakVerifier);

  const authenticated = await login(instance, 'admin', ORIGINAL_PASSWORD);
  assert.equal(authenticated.response.status, 201);
  assert.deepEqual(
    parseVerifier(instance.database.stmts.getAdmin.get().password_verifier).parameters,
    {
      version: CURRENT_PARAMETERS.version,
      memory: CURRENT_PARAMETERS.memory,
      passes: CURRENT_PARAMETERS.passes,
      parallelism: CURRENT_PARAMETERS.parallelism,
      tagLength: CURRENT_PARAMETERS.tagLength,
    },
  );

  now += 30 * 86_400_000 + 1;
  const expired = await request(instance, 'GET', '/api/v1/session', {
    cookie: authenticated.session.cookie,
  });
  assert.equal(expired.response.status, 401);
  assert.equal(expired.body.error.code, 'session_required');
  assert.match(expired.response.headers.get('set-cookie'), /Max-Age=0/);
});
