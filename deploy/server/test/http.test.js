'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/index');
const { createLogger } = require('../src/logger');
const { createRuntimeState } = require('../src/runtimeState');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function loggerStub() {
  return { debug() {}, error() {}, info() {}, warn() {} };
}

function databaseStub() {
  const statement = {
    all: () => [],
    get: () => null,
    run: () => ({ changes: 0, lastInsertRowid: 1 }),
  };
  return {
    db: { prepare: () => statement },
    stmts: new Proxy(
      {},
      {
        get: (target, key) => target[key] || statement,
      },
    ),
    DEFAULT_OUTLETS: '[]',
  };
}

function authSystemStub() {
  return {
    limiter: { sweep() {} },
    setupRequired: () => true,
    requireAuth(req, _res, next) {
      req.auth = { username: 'admin' };
      next();
    },
    requireCsrf(_req, _res, next) {
      next();
    },
    async setup() {
      return { username: 'admin' };
    },
    async login() {
      throw new Error('not used');
    },
    setSessionCookie() {},
    refreshSession() {
      throw new Error('not used');
    },
    logout() {
      throw new Error('not used');
    },
    async changeUsername() {
      throw new Error('not used');
    },
    async changePassword() {
      throw new Error('not used');
    },
    clearSessionCookie() {},
  };
}

function buildApp(
  runtimeState = createRuntimeState(),
  database = databaseStub(),
  logger = loggerStub(),
) {
  return createApp({
    config: loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:' }),
    runtimeState,
    database,
    mqttService: { publish() {} },
    logger,
    authSystem: authSystemStub(),
  });
}

async function withServer(app, callback) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      }),
    );
  }
}

test('liveness is available while readiness reports startup state', async () => {
  await withServer(buildApp(), async (baseUrl) => {
    const liveResponse = await fetch(`${baseUrl}/health/live`);
    assert.equal(liveResponse.status, 200);
    assert.deepEqual(await liveResponse.json(), { status: 'ok', setup_required: true });
    assert.match(liveResponse.headers.get('x-request-id'), UUID_V4);

    const readyResponse = await fetch(`${baseUrl}/health/ready`);
    assert.equal(readyResponse.status, 503);
    assert.deepEqual(await readyResponse.json(), {
      status: 'not_ready',
      reason: 'starting',
    });
  });
});

test('readiness becomes available only after runtime initialization', async () => {
  const runtimeState = createRuntimeState();
  runtimeState.markReady();

  await withServer(buildApp(runtimeState), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health/ready`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ready' });
  });
});

test('server ignores client request IDs and returns canonical UUID v4 values', async () => {
  await withServer(buildApp(), async (baseUrl) => {
    const supplied = '11111111-1111-4111-8111-111111111111';
    const response = await fetch(`${baseUrl}/health/live`, {
      headers: { 'X-Request-ID': supplied },
    });
    const returned = response.headers.get('x-request-id');

    assert.match(returned, UUID_V4);
    assert.notEqual(returned, supplied);
  });
});

test('request logs correlate the response ID without logging query values or headers', async () => {
  const output = [];
  const errors = [];
  const logger = createLogger({
    level: 'debug',
    includeErrorMessages: false,
    write: (line) => output.push(line),
    writeError: (line) => errors.push(line),
  });

  await withServer(buildApp(createRuntimeState(), databaseStub(), logger), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health/live?password=do-not-log`, {
      headers: {
        Authorization: 'Bearer do-not-log',
        Cookie: 'session=do-not-log',
      },
    });
    const requestId = response.headers.get('x-request-id');
    await response.json();

    const records = output.map(JSON.parse);
    const completed = records.find((record) => record.event === 'http_request_completed');
    assert.equal(completed.request_id, requestId);
    assert.equal(completed.path, '/health/live');
    assert.equal(completed.status, 200);
    assert.equal(JSON.stringify(records).includes('do-not-log'), false);
    assert.deepEqual(errors, []);
  });
});

test('API requests are rejected with a typed error during shutdown', async () => {
  const runtimeState = createRuntimeState();
  runtimeState.markReady();
  runtimeState.beginShutdown();

  await withServer(buildApp(runtimeState), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/devices`);
    const requestId = response.headers.get('x-request-id');

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: {
        code: 'server_shutting_down',
        message: 'Command Center is restarting. Try again after it becomes ready.',
      },
      request_id: requestId,
    });

    const liveResponse = await fetch(`${baseUrl}/health/live`);
    assert.equal(liveResponse.status, 200);
  });
});

test('malformed JSON and unknown APIs use the typed error envelope', async () => {
  const runtimeState = createRuntimeState();
  runtimeState.markReady();

  await withServer(buildApp(runtimeState), async (baseUrl) => {
    const invalidJson = await fetch(`${baseUrl}/api/v1/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    const invalidJsonBody = await invalidJson.json();
    assert.equal(invalidJson.status, 400);
    assert.equal(invalidJsonBody.error.code, 'invalid_json');
    assert.equal(invalidJsonBody.request_id, invalidJson.headers.get('x-request-id'));

    const missing = await fetch(`${baseUrl}/api/v1/not-a-route`);
    const missingBody = await missing.json();
    assert.equal(missing.status, 404);
    assert.equal(missingBody.error.code, 'not_found');
    assert.equal(missingBody.request_id, missing.headers.get('x-request-id'));
  });
});

test('legacy health endpoint is removed', async () => {
  await withServer(buildApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'not_found');
  });
});

test('unexpected failures return generic output without implementation details', async () => {
  const runtimeState = createRuntimeState();
  runtimeState.markReady();
  const database = databaseStub();
  database.stmts.getAllDevices = {
    all() {
      throw new Error('SELECT password FROM private_table');
    },
  };

  await withServer(buildApp(runtimeState, database), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/devices`, {
      headers: { Cookie: 'growhub_session=opaque' },
    });
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.error.code, 'internal_error');
    assert.equal(body.error.message, 'An unexpected server error occurred.');
    assert.equal(JSON.stringify(body).includes('SELECT password'), false);
    assert.equal(body.request_id, response.headers.get('x-request-id'));
  });
});
