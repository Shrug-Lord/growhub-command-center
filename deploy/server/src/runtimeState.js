'use strict';

function createRuntimeState({ clock = () => Date.now() } = {}) {
  let phase = 'starting';
  let changedAt = clock();
  let failureReason = null;

  function transition(nextPhase, reason = null) {
    phase = nextPhase;
    failureReason = reason;
    changedAt = clock();
  }

  return Object.freeze({
    markReady() {
      if (phase !== 'starting') throw new Error(`Cannot become ready from ${phase}`);
      transition('ready');
    },
    beginShutdown() {
      if (phase !== 'shutting_down') transition('shutting_down');
    },
    markFailed(reason = 'startup_failed') {
      if (phase !== 'shutting_down') transition('failed', reason);
    },
    isReady: () => phase === 'ready',
    isShuttingDown: () => phase === 'shutting_down',
    snapshot: () => Object.freeze({ phase, changedAt, failureReason }),
  });
}

module.exports = { createRuntimeState };
