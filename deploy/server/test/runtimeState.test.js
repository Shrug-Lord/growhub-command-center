'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createRuntimeState } = require('../src/runtimeState');

test('runtime state transitions from starting to ready to shutting down', () => {
  let now = 100;
  const runtime = createRuntimeState({ clock: () => now });

  assert.deepEqual(runtime.snapshot(), {
    phase: 'starting',
    changedAt: 100,
    failureReason: null,
  });
  assert.equal(runtime.isReady(), false);

  now = 200;
  runtime.markReady();
  assert.equal(runtime.isReady(), true);
  assert.equal(runtime.snapshot().changedAt, 200);

  now = 300;
  runtime.beginShutdown();
  assert.equal(runtime.isReady(), false);
  assert.equal(runtime.isShuttingDown(), true);
  assert.equal(runtime.snapshot().changedAt, 300);
});

test('runtime state exposes a stable startup failure reason', () => {
  const runtime = createRuntimeState();
  runtime.markFailed('database_open_failed');

  assert.deepEqual(
    {
      phase: runtime.snapshot().phase,
      failureReason: runtime.snapshot().failureReason,
    },
    { phase: 'failed', failureReason: 'database_open_failed' },
  );
  assert.throws(() => runtime.markReady(), /Cannot become ready from failed/);
});
