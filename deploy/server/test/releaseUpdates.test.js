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

test('automatic updates write one validated host-agent request', async (t) => {
  const { directory, service } = createHarness(t, [release('v0.2.0')]);
  fs.writeFileSync(
    path.join(directory, 'agent.json'),
    JSON.stringify({ v: 1, installed: true, installed_at: '2026-08-06T12:00:00Z' }),
  );
  await service.check({ force: true });

  const status = await service.setAutoInstall(true);
  const request = JSON.parse(fs.readFileSync(path.join(directory, 'request.json'), 'utf8'));
  assert.equal(status.auto_install, true);
  assert.equal(status.prompt_available, false);
  assert.equal(request.v, 1);
  assert.equal(request.tag, 'v0.2.0');
  assert.equal(request.requested_by, 'automatic');
});

test('install requests fail closed until the host update service is installed', async (t) => {
  const { service } = createHarness(t, [release('v0.2.0')]);
  await service.check({ force: true });

  assert.throws(
    () => service.requestInstall('v0.2.0'),
    (error) => error instanceof ReleaseUpdateError && error.code === 'update_agent_unavailable',
  );
});
