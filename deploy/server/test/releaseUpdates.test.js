'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { openDatabase } = require('../src/db');
const {
  ReleaseUpdateError,
  compareVersions,
  createReleaseUpdateService,
} = require('../src/releaseUpdates');

function loggerStub() {
  return Object.fromEntries(['debug', 'info', 'warn', 'error'].map((level) => [level, () => {}]));
}

function release(tag) {
  return {
    tag_name: tag,
    name: `Command Center ${tag}`,
    html_url: `https://github.com/Shrug-Lord/growhub-command-center/releases/tag/${tag}`,
    published_at: '2026-08-06T12:00:00Z',
    draft: false,
    prerelease: false,
  };
}

function createHarness(t, releases) {
  let now = 10_000;
  let index = 0;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'growhub-updates-test-'));
  const database = openDatabase(':memory:', { clock: () => now });
  const service = createReleaseUpdateService({
    database,
    logger: loggerStub(),
    updateRequestDir: directory,
    currentVersion: '0.1.0',
    clock: () => now,
    fetchFn: async () =>
      new Response(JSON.stringify(releases[Math.min(index++, releases.length - 1)]), {
        status: 200,
      }),
  });
  t.after(() => {
    service.close();
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    service,
    advance(milliseconds) {
      now += milliseconds;
    },
  };
}

test('semantic versions compare without treating main as an update channel', () => {
  assert.equal(compareVersions('0.2.0', '0.1.9'), 1);
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0);
  assert.equal(compareVersions('0.1.0', '0.2.0'), -1);
  assert.equal(compareVersions('main', '0.1.0'), null);
});

test('release prompts are dismissed per tag and return for a newer release', async (t) => {
  const { service } = createHarness(t, [release('v0.2.0'), release('v0.3.0')]);

  let status = await service.check({ force: true });
  assert.equal(status.latest_release.tag, 'v0.2.0');
  assert.equal(status.prompt_available, true);

  status = service.dismiss('v0.2.0');
  assert.equal(status.dismissed, true);
  assert.equal(status.prompt_available, false);

  status = await service.check({ force: true });
  assert.equal(status.latest_release.tag, 'v0.3.0');
  assert.equal(status.dismissed, false);
  assert.equal(status.prompt_available, true);
});

test('enabled checks never install; an explicit confirmation writes one request', async (t) => {
  const { directory, service } = createHarness(t, [release('v0.2.0')]);
  fs.writeFileSync(
    path.join(directory, 'agent.json'),
    JSON.stringify({ v: 1, installed: true, installed_at: '2026-08-06T12:00:00Z' }),
  );
  await service.check({ force: true });

  const status = await service.setChecksEnabled(true);
  assert.equal(fs.existsSync(path.join(directory, 'request.json')), false);
  assert.throws(() => service.requestInstall('v0.2.0'), /Confirm/);
  service.requestInstall('v0.2.0', true);
  assert.throws(() => service.requestInstall('v0.2.0', true), /already in progress/);
  const request = JSON.parse(fs.readFileSync(path.join(directory, 'request.json'), 'utf8'));
  assert.equal(status.checks_enabled, true);
  assert.equal(status.prompt_available, true);
  assert.equal(request.v, 1);
  assert.equal(request.tag, 'v0.2.0');
  assert.equal(request.requested_by, 'user');
});

test('install requests fail closed until the host update service is installed', async (t) => {
  const { service } = createHarness(t, [release('v0.2.0')]);
  await service.check({ force: true });

  assert.throws(
    () => service.requestInstall('v0.2.0'),
    (error) => error instanceof ReleaseUpdateError && error.code === 'update_agent_unavailable',
  );
});

test('disabled background checks do not contact GitHub; manual checks work', async (t) => {
  const { service } = createHarness(t, [release('v0.2.0')]);
  assert.equal((await service.check()).latest_release, null);
  assert.equal((await service.check({ force: true })).latest_release.tag, 'v0.2.0');
});
test('Later defers the same release for 24 hours and Skip remains per-version', async (t) => {
  const { service, advance } = createHarness(t, [release('v0.2.0')]);
  await service.check({ force: true });
  assert.equal(service.dismiss('v0.2.0', 'later').prompt_available, false);
  advance(86400001);
  assert.equal(service.status().prompt_available, true);
  service.dismiss('v0.2.0');
  advance(86400001);
  assert.equal(service.status().prompt_available, false);
});
test('prereleases and malformed metadata never become install targets', async (t) => {
  const { service } = createHarness(t, [{ ...release('v0.3.0'), prerelease: true }]);
  const status = await service.check({ force: true });
  assert.equal(status.update_available, false);
  assert.ok(status.check_error);
});

test('background timer is opt-in and enabling checks never requests installation', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'growhub-timer-test-'));
  const database = openDatabase(':memory:');
  let now = 1,
    calls = 0,
    tick;
  const service = createReleaseUpdateService({
    database,
    logger: loggerStub(),
    updateRequestDir: directory,
    clock: () => now,
    currentVersion: '0.2.0',
    setIntervalFn: (fn) => {
      tick = fn;
      return 1;
    },
    clearIntervalFn: () => {},
    fetchFn: async () => {
      calls++;
      return new Response(JSON.stringify(release('v0.3.0')));
    },
  });
  t.after(() => {
    service.close();
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  service.start();
  now += 61000;
  tick();
  await new Promise(setImmediate);
  assert.equal(calls, 0);
  await service.setChecksEnabled(true);
  now += 61000;
  tick();
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  assert.equal(fs.existsSync(path.join(directory, 'request.json')), false);
  tick();
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  await service.setChecksEnabled(false);
  now += 7 * 3600000;
  tick();
  await new Promise(setImmediate);
  assert.equal(calls, 1);
});
